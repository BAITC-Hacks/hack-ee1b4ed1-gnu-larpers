import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';

type NodeRow = {
  gid: string;
  depth: number;
  is_seed: boolean;
  role: string;
  role_score: number;
  cluster_id: number;
  priority_score: number;
  evidence: string;
  in_deg: number;
  out_deg: number;
  in_kzt: number;
  out_kzt: number;
  in_tx: number;
  out_tx: number;
  seed_sources: number;
  quick_out_share: number | null;
  flags?: string[];
};

type EdgeRow = {
  src: string;
  dst: string;
  sum_kzt: number;
  n_tx: number;
  depth: number;
};

type ClusterRow = {
  cluster_id: number;
  n_nodes: number;
  n_seed: number;
  sum_kzt_internal: number;
  top_gids: string;
  hypothesis: string;
};

type TopRow = {
  rank: number;
  gid: string;
  role: string;
  priority_score: number;
  why: string;
};

type GraphData = {
  nodes: NodeRow[];
  edges: EdgeRow[];
  clusters: ClusterRow[];
  top_nodes: TopRow[];
};

type Scope = 1 | 2 | 'all';

const roleLabels: Record<string, string> = {
  consolidator: 'Сборщик',
  distributor: 'Распределитель',
  transit: 'Транзит',
  terminal: 'Конечный узел',
  coordinator: 'Координатор',
  peripheral: 'Периферия',
};

const roleColors: Record<string, string> = {
  consolidator: '#f6b45e',
  distributor: '#a98af7',
  transit: '#54c7d1',
  terminal: '#ef7d83',
  coordinator: '#88d888',
  peripheral: '#748293',
};

const clusterColors = ['#53c9c4', '#eea968', '#a994ee', '#e37f92', '#a7cc70', '#77a8ed', '#e5c779', '#c788ce'];

function colorFor(node: NodeRow, colorMode: 'role' | 'cluster') {
  if (colorMode === 'role') return roleColors[node.role] ?? '#8ca2b2';
  return clusterColors[Math.abs(node.cluster_id) % clusterColors.length];
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value || 0);
}

function formatScore(value: number) {
  return new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value || 0);
}

function plural(value: number, one: string, few: string, many: string) {
  const mod100 = Math.abs(value) % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = mod100 % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function formatMoney(value: number) {
  const absolute = Math.abs(value || 0);
  if (absolute >= 1_000_000_000) return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value / 1_000_000_000)} млрд ₸`;
  if (absolute >= 1_000_000) return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value / 1_000_000)} млн ₸`;
  if (absolute >= 1_000) return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value / 1_000)} тыс ₸`;
  return `${formatNumber(value)} ₸`;
}

function roleLabel(role: string) {
  return roleLabels[role] ?? role;
}

function isGraphData(value: unknown): value is GraphData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GraphData>;
  return Array.isArray(candidate.nodes) && candidate.nodes.every((node) => typeof node.gid === 'string') &&
    Array.isArray(candidate.edges) && candidate.edges.every((edge) => typeof edge.src === 'string' && typeof edge.dst === 'string') &&
    Array.isArray(candidate.clusters) && Array.isArray(candidate.top_nodes) && candidate.top_nodes.every((node) => typeof node.gid === 'string');
}

function visibleGraph(data: GraphData, selectedGid: string | null, scope: Scope, roleFilter: string, clusterFilter: string) {
  const matches = (node: NodeRow) =>
    (roleFilter === 'all' || node.role === roleFilter) &&
    (clusterFilter === 'all' || String(node.cluster_id) === clusterFilter);
  const nodeByGid = new Map(data.nodes.map((node) => [node.gid, node]));
  const allowed = new Set(data.nodes.filter(matches).map((node) => node.gid));
  if (selectedGid !== null) allowed.add(selectedGid);

  if (scope === 'all' || selectedGid === null) {
    const nodes = data.nodes.filter((node) => allowed.has(node.gid));
    const edges = data.edges.filter((edge) => allowed.has(edge.src) && allowed.has(edge.dst));
    return { nodes, edges };
  }

  const adjacency = new Map<string, Set<string>>();
  for (const edge of data.edges) {
    if (!nodeByGid.has(edge.src) || !nodeByGid.has(edge.dst)) continue;
    if (!adjacency.has(edge.src)) adjacency.set(edge.src, new Set());
    if (!adjacency.has(edge.dst)) adjacency.set(edge.dst, new Set());
    adjacency.get(edge.src)!.add(edge.dst);
    adjacency.get(edge.dst)!.add(edge.src);
  }

  const nearby = new Set([selectedGid]);
  let frontier = [selectedGid];
  for (let hop = 0; hop < scope; hop += 1) {
    const next: string[] = [];
    for (const gid of frontier) {
      for (const neighbor of adjacency.get(gid) ?? []) {
        if (nearby.has(neighbor)) continue;
        nearby.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }

  const filtered = new Set([...nearby].filter((gid) => allowed.has(gid)));
  filtered.add(selectedGid);
  return {
    nodes: data.nodes.filter((node) => filtered.has(node.gid)),
    edges: data.edges.filter((edge) => filtered.has(edge.src) && filtered.has(edge.dst)),
  };
}

function NetworkGraph({
  nodes,
  edges,
  selectedGid,
  colorMode,
  scope,
  onSelect,
}: {
  nodes: NodeRow[];
  edges: EdgeRow[];
  selectedGid: string | null;
  colorMode: 'role' | 'cluster';
  scope: Scope;
  onSelect: (gid: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Core | null>(null);
  const selectionRef = useRef(onSelect);

  function zoomBy(factor: number) {
    const graph = graphRef.current;
    if (!graph) return;
    graph.zoom({
      level: Math.max(0.15, Math.min(3.5, graph.zoom() * factor)),
      renderedPosition: { x: graph.width() / 2, y: graph.height() / 2 },
    });
  }

  useEffect(() => {
    selectionRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!containerRef.current) return;
    const elements: ElementDefinition[] = [
      ...nodes.map((node) => ({
        data: {
          id: String(node.gid),
          shortLabel: node.gid.slice(-6),
          color: colorFor(node, colorMode),
          size: node.is_seed ? 27 : Math.min(28, 13 + Math.sqrt(Math.max(0, node.in_deg + node.out_deg)) * 2.1),
          isSeed: node.is_seed,
        },
      })),
      ...edges.map((edge, index) => ({
        data: {
          id: `e-${edge.src}-${edge.dst}-${index}`,
          source: String(edge.src),
          target: String(edge.dst),
          width: Math.min(3.5, 1 + Math.log10(Math.max(1, edge.sum_kzt)) / 4),
        },
      })),
    ];

    const graph = cytoscape({
      container: containerRef.current,
      elements,
      layout: scope === 'all'
        ? { name: 'grid', fit: true, padding: 42, sort: (a, b) => a.id().localeCompare(b.id()) }
        : { name: 'cose', animate: false, fit: true, padding: 46, nodeRepulsion: () => 7000, idealEdgeLength: () => 80 },
      minZoom: 0.15,
      maxZoom: 3.5,
      wheelSensitivity: 0.18,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            'border-color': '#0c1521',
            'border-width': 2,
            width: 'data(size)',
            height: 'data(size)',
            label: scope === 1 ? 'data(shortLabel)' : '',
            color: '#dce8eb',
            'font-size': 9,
            'font-weight': 600,
            'text-valign': 'bottom',
            'text-margin-y': 9,
            'text-outline-color': '#111a26',
            'text-outline-width': 2,
          },
        },
        {
          selector: 'node[?isSeed]',
          style: { 'border-color': '#ffffff', 'border-width': 2.5 },
        },
        {
          selector: 'node:selected',
          style: { 'border-color': '#ffffff', 'border-width': 4, 'overlay-color': '#65d9cf', 'overlay-opacity': 0.18, 'overlay-padding': 12, label: 'data(shortLabel)' },
        },
        {
          selector: 'edge',
          style: {
            width: 'data(width)',
            'line-color': '#667d8c',
            'target-arrow-color': '#91b3bc',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.76,
            'curve-style': 'bezier',
            opacity: 0.48,
          },
        },
      ],
    });

    graph.on('tap', 'node', (event) => selectionRef.current(event.target.id()));
    graphRef.current = graph;
    if (selectedGid !== null) graph.getElementById(String(selectedGid)).select();

    return () => {
      graph.destroy();
      if (graphRef.current === graph) graphRef.current = null;
    };
  }, [nodes, edges, colorMode, scope]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.nodes().unselect();
    if (selectedGid !== null) {
      const selected = graph.getElementById(String(selectedGid));
      if (selected.length) selected.select();
    }
  }, [selectedGid, nodes, edges]);

  return (
    <div className="graph-stage">
      <div ref={containerRef} className="graph-canvas" role="img" aria-label="Направленный граф переводов; выберите узел для подробностей" />
      {nodes.length === 0 && <div className="graph-empty">По выбранным фильтрам узлов нет</div>}
      <div className="graph-controls">
        <button type="button" onClick={() => zoomBy(1.3)} aria-label="Приблизить граф">+</button>
        <button type="button" onClick={() => zoomBy(1 / 1.3)} aria-label="Отдалить граф">−</button>
        <button type="button" onClick={() => graphRef.current?.fit(undefined, 40)} aria-label="Вместить граф">⌗</button>
      </div>
    </div>
  );
}

function App() {
  const [data, setData] = useState<GraphData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [selectedGid, setSelectedGid] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchError, setSearchError] = useState('');
  const [scope, setScope] = useState<Scope>(1);
  const [colorMode, setColorMode] = useState<'role' | 'cluster'>('role');
  const [roleFilter, setRoleFilter] = useState('all');
  const [clusterFilter, setClusterFilter] = useState('all');
  const detailRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/generated/graph.json', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload: unknown = await response.json();
        if (!isGraphData(payload)) throw new Error('Неверный формат graph.json');
        setData(payload);
        setSelectedGid(payload.top_nodes[0]?.gid ?? payload.nodes.find((node) => node.is_seed)?.gid ?? payload.nodes[0]?.gid ?? null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : 'Не удалось загрузить данные');
      });
    return () => controller.abort();
  }, []);

  const nodeByGid = useMemo(() => new Map(data?.nodes.map((node) => [node.gid, node]) ?? []), [data]);
  const selectedNode = selectedGid === null ? null : nodeByGid.get(selectedGid) ?? null;
  const displayed = useMemo(
    () => data ? visibleGraph(data, selectedGid, scope, roleFilter, clusterFilter) : { nodes: [], edges: [] },
    [data, selectedGid, scope, roleFilter, clusterFilter],
  );
  const roles = useMemo(() => [...new Set(data?.nodes.map((node) => node.role) ?? [])].sort(), [data]);
  const clusters = useMemo(() => [...(data?.clusters ?? [])].sort((a, b) => b.n_nodes - a.n_nodes), [data]);
  const selectedCluster = selectedNode ? clusters.find((cluster) => cluster.cluster_id === selectedNode.cluster_id) : null;
  const selectedTop = selectedNode ? data?.top_nodes.find((row) => row.gid === selectedNode.gid) : null;
  const seedCount = data?.nodes.filter((node) => node.is_seed).length ?? 0;
  const isolatedCount = data?.nodes.filter((node) => node.in_deg + node.out_deg === 0).length ?? 0;

  function selectGid(gid: string, revealDetails = false) {
    setSelectedGid(gid);
    setSearchError('');
    setQuery(String(gid));
    setScope((current) => current === 'all' ? 1 : current);
    setRoleFilter('all');
    setClusterFilter('all');
    if (revealDetails && window.matchMedia('(max-width: 760px)').matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const gid = query.trim();
    if (!/^-?\d+$/.test(gid) || !nodeByGid.has(gid)) {
      setSearchError('Узел с таким gid не найден');
      return;
    }
    selectGid(gid);
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="brand"><span className="brand-mark"><i /><i /><i /></span><span><strong>TRACE</strong><small>AML NETWORK INTELLIGENCE</small></span></div>
        <div className="header-right"><span className="status-dot" /> <span>Локальный анализ</span><span className="header-divider" /><span>HackAlem AI</span></div>
      </header>

      <main>
        <section className="page-intro">
          <div><p className="eyebrow">РАБОЧЕЕ МЕСТО АНАЛИТИКА / 01</p><h1>Карта денежных связей</h1><p className="intro-copy">Исследуйте сеть переводов, находите значимые узлы и проверяйте факты за каждой гипотезой.</p></div>
          <div className="export-wrap"><span className="export-label">Выгрузить результаты</span><div className="export-links"><a href="/generated/nodes_roles.csv" download>Узлы и роли <span>↗</span></a><a href="/generated/clusters.csv" download>Кластеры <span>↗</span></a><a href="/generated/top_nodes.csv" download>Приоритеты <span>↗</span></a></div></div>
        </section>

        {loadError ? <div className="notice error"><strong>Не удалось открыть граф</strong><span>{loadError}. Сначала выполните расчёт данных и обновите страницу.</span></div> : null}
        {!data && !loadError ? <div className="notice loading"><span className="pulse" /> Загружаем граф и результаты анализа…</div> : null}

        {data && <>
          <section className="stats-row" aria-label="Сводка по данным">
            <div className="stat-card"><span>Узлов в сети</span><strong>{formatNumber(data.nodes.length)}</strong><small>включая изолированные</small></div>
            <div className="stat-card"><span>Связей</span><strong>{formatNumber(data.edges.length)}</strong><small>направленные переводы</small></div>
            <div className="stat-card"><span>Исходных клиентов</span><strong>{formatNumber(seedCount)}</strong><small>точки исследования</small></div>
            <div className="stat-card"><span>Кластеров</span><strong>{formatNumber(clusters.length)}</strong><small>{isolatedCount} {plural(isolatedCount, 'изолированный узел', 'изолированных узла', 'изолированных узлов')}</small></div>
          </section>

          <section className="workspace">
            <aside className="panel priorities-panel">
              <div className="panel-title"><div><p className="eyebrow">ОЧЕРЕДЬ ПРОВЕРКИ</p><h2>Приоритетные узлы</h2></div><span className="count-badge">{data.top_nodes.length}</span></div>
              <p className="panel-hint">Порядок для ручного анализа. Оценка показывает приоритет проверки, а не вероятность нарушения.</p>
              <div className="priority-list">
                {[...data.top_nodes].sort((a, b) => a.rank - b.rank).map((item) => (
                  <button type="button" key={`${item.rank}-${item.gid}`} className={`priority-item ${item.gid === selectedGid ? 'active' : ''}`} onClick={() => selectGid(item.gid, true)}>
                    <span className="priority-rank">{String(item.rank).padStart(2, '0')}</span>
                    <span className="priority-body"><span className="priority-line"><strong>GID {item.gid}</strong></span><span className="role-line"><i style={{ background: roleColors[item.role] ?? '#8ca2b2' }} />{roleLabel(item.role)}<b>{formatScore(item.priority_score)}</b></span><span className="priority-why">{item.why}</span></span>
                  </button>
                ))}
                {data.top_nodes.length === 0 && <div className="list-empty">Приоритетный список пока пуст.</div>}
              </div>
            </aside>

            <section className="panel graph-panel">
              <div className="graph-toolbar">
                <div><p className="eyebrow">СЕТЬ ТРАНЗАКЦИЙ</p><h2>Граф связей</h2></div>
                <form className="search-form" onSubmit={search}><label htmlFor="gid-search">Поиск по GID</label><div className="search-control"><input id="gid-search" inputMode="numeric" value={query} onChange={(event) => { setQuery(event.target.value); setSearchError(''); }} placeholder="Введите GID" /><button type="submit" aria-label="Найти узел">→</button></div>{searchError && <span className="search-error">{searchError}</span>}</form>
              </div>
              <div className="graph-options">
                <div className="segmented" aria-label="Область графа"><button type="button" className={scope === 1 ? 'selected' : ''} onClick={() => setScope(1)}>1 шаг</button><button type="button" className={scope === 2 ? 'selected' : ''} onClick={() => setScope(2)}>2 шага</button><button type="button" className={scope === 'all' ? 'selected' : ''} onClick={() => setScope('all')}>Вся сеть</button></div>
                <div className="option-group"><label>Цвет <select value={colorMode} onChange={(event) => setColorMode(event.target.value as 'role' | 'cluster')}><option value="role">По роли</option><option value="cluster">По кластеру</option></select></label><label>Роль <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="all">Все</option>{roles.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></label><label>Кластер <select value={clusterFilter} onChange={(event) => setClusterFilter(event.target.value)}><option value="all">Все</option>{clusters.map((cluster) => <option key={cluster.cluster_id} value={cluster.cluster_id}>#{cluster.cluster_id}</option>)}</select></label></div>
              </div>
              <NetworkGraph nodes={displayed.nodes} edges={displayed.edges} selectedGid={selectedGid} colorMode={colorMode} scope={scope} onSelect={selectGid} />
              <div className="graph-footer"><span><i className="legend-seed" /> Исходный клиент</span><span><i className="legend-arrow" /> Направление перевода</span><span className="graph-count">Показано {formatNumber(displayed.nodes.length)} {plural(displayed.nodes.length, 'узел', 'узла', 'узлов')} · {formatNumber(displayed.edges.length)} {plural(displayed.edges.length, 'связь', 'связи', 'связей')}</span></div>
            </section>

            <aside className="panel detail-panel" ref={detailRef}>
              <div className="panel-title"><div><p className="eyebrow">КАРТОЧКА УЗЛА</p><h2>{selectedNode ? `GID ${selectedNode.gid}` : 'Выберите узел'}</h2></div>{selectedNode?.is_seed && <span className="seed-badge">SEED</span>}</div>
              {selectedNode ? <>
                <div className="role-card"><span className="role-icon" style={{ background: colorFor(selectedNode, 'role') }} /><div><span>Предполагаемая роль</span><strong>{roleLabel(selectedNode.role)}</strong></div><span className="score-pill">{formatScore(selectedNode.role_score)}</span></div>
                <div className="detail-block"><h3>Наблюдаемый поток</h3><div className="flow-row"><div><span>Входящий</span><strong>{formatMoney(selectedNode.in_kzt)}</strong><small>{formatNumber(selectedNode.in_deg)} {plural(selectedNode.in_deg, 'контрагент', 'контрагента', 'контрагентов')} · {formatNumber(selectedNode.in_tx)} {plural(selectedNode.in_tx, 'операция', 'операции', 'операций')}</small></div><span className="flow-arrow">→</span><div><span>Исходящий</span><strong>{formatMoney(selectedNode.out_kzt)}</strong><small>{formatNumber(selectedNode.out_deg)} {plural(selectedNode.out_deg, 'контрагент', 'контрагента', 'контрагентов')} · {formatNumber(selectedNode.out_tx)} {plural(selectedNode.out_tx, 'операция', 'операции', 'операций')}</small></div></div></div>
                <div className="detail-grid"><div><span>Приоритет</span><strong>{formatScore(selectedNode.priority_score)}</strong></div><div><span>Колено</span><strong>{selectedNode.depth}</strong></div><div><span>Кластер</span><strong>#{selectedNode.cluster_id}</strong></div><div><span>Роль · оценка</span><strong>{formatScore(selectedNode.role_score)}</strong></div><div><span>Связано с исходными клиентами</span><strong>{formatNumber(selectedNode.seed_sources)}</strong></div><div><span>Быстрый исходящий поток</span><strong>{selectedNode.quick_out_share === null ? '—' : `${Math.round(selectedNode.quick_out_share * 100)}%`}</strong></div></div>
                {selectedNode.quick_out_share !== null && <div className="temporal-note">{Math.round(selectedNode.quick_out_share * 100)}% наблюдаемого исходящего объёма пришлось на день входящего перевода или следующие два дня.</div>}
                <div className="detail-block evidence-block"><h3>Почему узел интересен</h3><p>{selectedNode.evidence || selectedTop?.why || 'Для этого узла нет дополнительных подтверждающих признаков.'}</p></div>
                {selectedCluster?.hypothesis && <div className="detail-block"><h3>Контекст кластера</h3><p>{selectedCluster.hypothesis}</p><small>{selectedCluster.n_nodes} {plural(selectedCluster.n_nodes, 'узел', 'узла', 'узлов')} · {selectedCluster.n_seed} {plural(selectedCluster.n_seed, 'исходный клиент', 'исходных клиента', 'исходных клиентов')}</small></div>}
                {selectedNode.flags && selectedNode.flags.length > 0 && <div className="detail-block"><h3>Дополнительные признаки</h3><div className="flag-list">{selectedNode.flags.map((flag) => <span key={flag}>{flag}</span>)}</div></div>}
                <div className="limitations"><h3>Границы вывода</h3><p>{selectedNode.depth >= 4 ? 'Узел находится на границе четырёх колен: дальнейшие переводы могут отсутствовать в выгрузке.' : selectedNode.is_seed ? 'Для исходного клиента наблюдаемый вход и выход не отражают полный баланс счёта.' : 'Показаны только операции из предоставленной выборки. Внешние переводы могут быть не видны.'}</p><p>Совпадение дат и сумм не доказывает, что дальше переведены именно полученные средства.</p></div>
              </> : <p className="panel-hint">Нажмите на узел графа или выберите запись слева.</p>}
            </aside>
          </section>
          <footer className="page-footer"><span>TRACE · Аналитика связей по наблюдаемым данным</span><span>Гипотезы требуют проверки аналитиком</span></footer>
        </>}
      </main>
    </div>
  );
}

export default App;
