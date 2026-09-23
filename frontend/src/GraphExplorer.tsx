import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, List, Maximize2, Minimize2, Search, SlidersHorizontal, X } from 'lucide-react';
import { roles, type GraphData, type Role } from './types';
import { number, plural, RoleBadge, shortMoney } from './format';
import { clientGraph, graphNeighborhood, groupGraph, type GraphNode } from './network-model';
import GraphView from './GraphView';
import { groupColor } from './graph-colors';

type GraphLevel = 'groups' | 'clients';
type OpenPanel = 'filters' | 'catalog' | null;

export default function GraphExplorer({ data, selectedGroup, onSelectGroup, onOpenClient, onOpenGroup }: {
  data: GraphData;
  selectedGroup: number | null;
  onSelectGroup: (id: number | null) => void;
  onOpenClient: (gid: string) => void;
  onOpenGroup: (id: number) => void;
}) {
  const [level, setLevel] = useState<GraphLevel>('clients');
  const [groupFilter, setGroupFilter] = useState<number | null>(null);
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all');
  const [selectedClient, setSelectedClient] = useState('');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeResult, setActiveResult] = useState(0);
  const [neighborsOnly, setNeighborsOnly] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [panel, setPanel] = useState<OpenPanel>(null);
  const [colorMode, setColorMode] = useState<'neutral' | 'roles' | 'groups'>('groups');
  const [labels, setLabels] = useState(true);
  const [focusRequest, setFocusRequest] = useState(0);
  const [listLimit, setListLimit] = useState(40);
  const panelRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const filtersRef = useRef<HTMLButtonElement>(null);
  const catalogRef = useRef<HTMLButtonElement>(null);
  const inspectorActionRef = useRef<HTMLButtonElement>(null);
  const focusInspectorRef = useRef(false);
  const searchId = useId();
  const groups = useMemo(() => groupGraph(data), [data]);
  const nodeById = useMemo(() => new Map(data.nodes.map(node => [node.gid, node])), [data]);
  const clusterById = useMemo(() => new Map(data.clusters.map(group => [group.cluster_id, group])), [data]);
  const visibleClients = useMemo(() => data.nodes.filter(node =>
    (groupFilter === null || node.cluster_id === groupFilter) && (roleFilter === 'all' || node.role === roleFilter)),
  [data, groupFilter, roleFilter]);
  const clients = useMemo(() => clientGraph(visibleClients, data.edges), [visibleClients, data.edges]);
  const model = level === 'groups' ? groups : clients;
  const modelById = useMemo(() => new Map(model.nodes.map(node => [node.id, node])), [model]);
  const selectedId = level === 'groups' ? selectedGroup === null ? '' : `group:${selectedGroup}` : selectedClient;
  const selected = modelById.get(selectedId);
  const selectedNode = selected?.gid ? nodeById.get(selected.gid) : undefined;
  const selectedCluster = selected?.kind === 'group' ? clusterById.get(selected.clusterId) : undefined;
  const neighborhood = useMemo(() => graphNeighborhood(model, selectedId), [model, selectedId]);
  const incidentEdges = useMemo(() => model.edges.filter(edge => edge.source === selectedId || edge.target === selectedId), [model, selectedId]);
  const neighbors = useMemo(() => model.nodes.filter(node => node.id !== selectedId && neighborhood.has(node.id)), [model, selectedId, neighborhood]);
  const normalizedQuery = query.trim().toLocaleLowerCase('ru');
  const matches = useMemo(() => {
    if (!normalizedQuery) return [];
    const matchingGroups = groups.nodes.filter(node => node.label.toLocaleLowerCase('ru').includes(normalizedQuery));
    const matchingClients: GraphNode[] = data.nodes
      .filter(node => node.gid.toLocaleLowerCase('ru').includes(normalizedQuery))
      .map(node => ({ id: `node:${node.gid}`, gid: node.gid, label: node.gid, clusterId: node.cluster_id, kind: 'client', size: 0, color: roles[node.role].color }));
    return [...matchingGroups, ...matchingClients];
  }, [groups, data, normalizedQuery]);
  const searchResults = matches.slice(0, 20);
  const showResults = searchOpen && normalizedQuery.length > 0;
  const browseNodes = useMemo(() => level === 'groups'
    ? [...model.nodes].sort((a, b) => (clusterById.get(b.clusterId)?.n_nodes ?? 0) - (clusterById.get(a.clusterId)?.n_nodes ?? 0))
    : [...model.nodes].sort((a, b) => {
      const first = nodeById.get(a.gid ?? '');
      const second = nodeById.get(b.gid ?? '');
      return ((second?.in_deg ?? 0) + (second?.out_deg ?? 0)) - ((first?.in_deg ?? 0) + (first?.out_deg ?? 0)) || a.id.localeCompare(b.id);
    }), [model, nodeById, clusterById, level]);

  useEffect(() => { setListLimit(40); }, [level, groupFilter, roleFilter, selectedId, panel]);
  useEffect(() => { setActiveResult(0); }, [normalizedQuery]);
  useEffect(() => {
    if (!focusInspectorRef.current || panel !== null) return;
    focusInspectorRef.current = false;
    inspectorActionRef.current?.focus({ preventScroll: true });
  }, [selectedId, panel]);
  useEffect(() => {
    if (!showResults) return;
    document.getElementById(`${searchId}-${activeResult}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeResult, searchId, showResults]);
  useEffect(() => {
    if (!searchOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !searchRef.current?.contains(event.target)) setSearchOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [searchOpen]);
  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    expandRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), input, select, [tabindex="0"]') ?? [])
        .filter(element => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (!panelRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKey);
    };
  }, [expanded]);

  const select = useCallback((id: string) => {
    if (level === 'groups') onSelectGroup(modelById.get(id)?.clusterId ?? null);
    else setSelectedClient(id);
    setPanel(null);
    if (!id) {
      setNeighborsOnly(false);
      if (panelRef.current?.querySelector('.explorer-inspector')?.contains(document.activeElement)) catalogRef.current?.focus({ preventScroll: true });
    }
  }, [level, modelById, onSelectGroup]);
  const locate = (id: string) => {
    focusInspectorRef.current = true;
    select(id);
    setFocusRequest(value => value + 1);
  };
  const resetFilters = () => {
    setGroupFilter(null);
    setRoleFilter('all');
    setSelectedClient('');
    setNeighborsOnly(false);
  };
  const drillIntoGroup = (id: number) => {
    filtersRef.current?.focus({ preventScroll: true });
    setLevel('clients');
    setGroupFilter(id);
    setRoleFilter('all');
    setSelectedClient('');
    setNeighborsOnly(false);
    setQuery('');
    setPanel(null);
  };
  const pickResult = (result: GraphNode) => {
    setQuery('');
    setSearchOpen(false);
    setNeighborsOnly(false);
    setPanel(null);
    if (result.kind === 'group') {
      setLevel('groups');
      if (colorMode === 'roles') setColorMode('groups');
      onSelectGroup(result.clusterId);
    } else {
      setLevel('clients');
      if (groupFilter !== null && groupFilter !== result.clusterId) setGroupFilter(null);
      const resultRole = result.gid ? nodeById.get(result.gid)?.role : undefined;
      if (roleFilter !== 'all' && roleFilter !== resultRole) setRoleFilter('all');
      setSelectedClient(result.id);
    }
    setFocusRequest(value => value + 1);
  };
  const changeLevel = (next: GraphLevel) => {
    setLevel(next);
    setNeighborsOnly(false);
    setQuery('');
    setPanel(null);
    if (next === 'clients') resetFilters();
    if (next === 'groups' && colorMode === 'roles') setColorMode('groups');
  };
  const closePanel = () => {
    if (panel === 'filters') filtersRef.current?.focus();
    if (panel === 'catalog') catalogRef.current?.focus();
    setPanel(null);
  };
  const incoming = incidentEdges.filter(edge => edge.target === selectedId).reduce((sum, edge) => sum + edge.sumMinor, 0);
  const outgoing = incidentEdges.filter(edge => edge.source === selectedId).reduce((sum, edge) => sum + edge.sumMinor, 0);
  const shownCount = selected && neighborsOnly ? neighborhood.size : model.nodes.length;
  const edgeCount = selected && neighborsOnly ? incidentEdges.length : model.edges.length;
  const filterCount = level === 'clients' ? Number(groupFilter !== null) + Number(roleFilter !== 'all') : 0;

  return <section
    ref={panelRef}
    className={`graph-explorer ${expanded ? 'is-expanded' : ''}`}
    aria-label="Общий граф переводов"
    role={expanded ? 'dialog' : undefined}
    aria-modal={expanded || undefined}
    onKeyDown={event => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (showResults) { setSearchOpen(false); return; }
      if (panel) { closePanel(); return; }
      if (expanded) { setExpanded(false); expandRef.current?.focus(); return; }
      select('');
    }}
  >
    <div className="explorer-map">
      {model.nodes.length > 0 && <GraphView model={model} selectedId={selected?.id ?? ''} neighborsOnly={neighborsOnly} focusRequest={focusRequest} onSelect={select} colorMode={colorMode} labels={labels} />}
    </div>

    <header className="explorer-toolbar">
      <div className="explorer-level" role="group" aria-label="Детализация общего графа">
        <button aria-pressed={level === 'clients'} onClick={() => changeLevel('clients')}>Клиенты</button>
        <button aria-pressed={level === 'groups'} onClick={() => changeLevel('groups')}>Группы</button>
      </div>
      <div ref={searchRef} className="explorer-search">
        <Search size={15} />
        <input
          aria-label="Поиск на графе"
          role="combobox"
          aria-expanded={showResults}
          aria-autocomplete="list"
          aria-controls={showResults ? searchId : undefined}
          aria-activedescendant={showResults && searchResults[activeResult] ? `${searchId}-${activeResult}` : undefined}
          placeholder="Найти клиента или группу…"
          value={query}
          onFocus={() => setSearchOpen(true)}
          onChange={event => { setQuery(event.target.value); setSearchOpen(true); }}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setSearchOpen(true);
              const direction = event.key === 'ArrowDown' ? 1 : -1;
              setActiveResult(value => Math.max(0, Math.min(searchResults.length - 1, value + direction)));
            }
            if (event.key === 'Enter' && searchResults[activeResult]) { event.preventDefault(); pickResult(searchResults[activeResult]); }
          }}
        />
        {query && <button aria-label="Очистить поиск на графе" onClick={() => { setQuery(''); searchRef.current?.querySelector('input')?.focus(); }}><X size={14} /></button>}
        {showResults && <div className="explorer-search-results">
          <span role="status">{matches.length ? `Найдено: ${number.format(matches.length)}${matches.length > 20 ? ' · первые 20' : ''}` : 'Ничего не найдено'}</span>
          <div id={searchId} role="listbox" aria-label="Результаты поиска на графе">
            {searchResults.map((result, index) => <button
              key={result.id}
              id={`${searchId}-${index}`}
              role="option"
              aria-selected={index === activeResult}
              tabIndex={-1}
              onPointerDown={event => event.preventDefault()}
              onClick={() => pickResult(result)}
            ><strong>{result.label}</strong><small>{result.kind === 'group' ? 'Группа клиентов' : `Клиент · группа ${result.clusterId + 1}`}</small></button>)}
          </div>
        </div>}
      </div>
      <div className="explorer-toolbar-actions">
        <button ref={catalogRef} aria-label="Список узлов" aria-expanded={panel === 'catalog'} title="Список узлов" onClick={() => setPanel(value => value === 'catalog' ? null : 'catalog')}><List size={17} /></button>
        <button ref={filtersRef} aria-label="Фильтры и вид графа" aria-expanded={panel === 'filters'} title="Фильтры и вид графа" onClick={() => setPanel(value => value === 'filters' ? null : 'filters')}><SlidersHorizontal size={16} />{filterCount > 0 && <span className="explorer-filter-count">{filterCount}</span>}</button>
        <button ref={expandRef} aria-label={expanded ? 'Свернуть граф' : 'Развернуть граф'} title={expanded ? 'Свернуть граф · Esc' : 'Развернуть граф'} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
      </div>
    </header>

    {panel === 'filters' && <aside className="explorer-panel explorer-filters" aria-label="Фильтры и вид графа">
      <div className="explorer-selection-heading"><h4>Фильтры и вид</h4><button aria-label="Закрыть фильтры" onClick={closePanel}><X size={16} /></button></div>
      {level === 'clients' && <>
        <label className="explorer-field">Группа<select aria-label="Группа на графе" value={groupFilter ?? 'all'} onChange={event => { setGroupFilter(event.target.value === 'all' ? null : Number(event.target.value)); setSelectedClient(''); setNeighborsOnly(false); }}><option value="all">Все группы</option>{data.clusters.map(group => <option key={group.cluster_id} value={group.cluster_id}>Группа {group.cluster_id + 1} · {number.format(group.n_nodes)}</option>)}</select></label>
        <label className="explorer-field">Роль<select aria-label="Роль на графе" value={roleFilter} onChange={event => { setRoleFilter(event.target.value as Role | 'all'); setSelectedClient(''); setNeighborsOnly(false); }}><option value="all">Все роли</option>{Object.entries(roles).map(([role, item]) => <option key={role} value={role}>{item.label}</option>)}</select></label>
      </>}
      <label className="explorer-field">Цвет узлов<select aria-label="Цвет узлов" value={colorMode} onChange={event => setColorMode(event.target.value as 'neutral' | 'roles' | 'groups')}><option value="groups">По группам</option>{level === 'clients' && <option value="roles">По ролям</option>}<option value="neutral">Однотонные</option></select></label>
      <div className="explorer-display-options">
        <label><input type="checkbox" checked={labels} onChange={event => setLabels(event.target.checked)} />Подписи узлов</label>
      </div>
      {filterCount > 0 && <button className="explorer-secondary" onClick={resetFilters}>Сбросить фильтры</button>}
    </aside>}

    {panel === 'catalog' && <aside className="explorer-panel explorer-catalog" aria-label="Список узлов графа">
      <div className="explorer-selection-heading"><h4>{level === 'groups' ? 'Группы' : 'Клиенты'} <span>{number.format(model.nodes.length)}</span></h4><button aria-label="Закрыть список узлов" onClick={closePanel}><X size={16} /></button></div>
      <p className="explorer-catalog-sort">{level === 'groups' ? 'По числу клиентов' : 'По числу связей'}</p>
      <div className="explorer-node-list">{browseNodes.slice(0, listLimit).map(item => <button key={item.id} onClick={() => locate(item.id)} title={item.gid}>
        <i style={{ background: colorMode === 'groups' ? groupColor(item.clusterId) : colorMode === 'roles' ? item.color : '#aaa7b2' }} /><span>{item.gid ?? item.label}</span><small>{item.kind === 'group' ? number.format(clusterById.get(item.clusterId)?.n_nodes ?? 0) : `гр. ${item.clusterId + 1}`}</small>
      </button>)}{browseNodes.length > listLimit && <button className="explorer-load-more" onClick={() => setListLimit(value => value + 40)}>Показать ещё</button>}</div>
      {browseNodes.length === 0 && <p className="explorer-no-connections">По этим фильтрам узлов нет.</p>}
    </aside>}

    {selected && panel === null && <aside className="explorer-panel explorer-inspector" aria-label="Выбор и связи узла">
      <div className="explorer-selection-heading"><span>{selected.kind === 'group' ? 'Группа клиентов' : `Клиент · группа ${selected.clusterId + 1}`}</span><button ref={inspectorActionRef} aria-label="Снять выделение на графе" onClick={() => select('')}><X size={16} /></button></div>
      <h4>{selected.gid ?? selected.label}</h4>
      {selectedNode && <RoleBadge role={selectedNode.role} />}
      {selectedCluster && <p>{number.format(selectedCluster.n_nodes)} {plural(selectedCluster.n_nodes, 'клиент', 'клиента', 'клиентов')} · {number.format(selectedCluster.n_seed)} исходных</p>}
      <dl className="explorer-flows"><div><dt>Входящие</dt><dd>{shortMoney(incoming / 100)}</dd></div><div><dt>Исходящие</dt><dd>{shortMoney(outgoing / 100)}</dd></div>{selectedCluster && <div><dt>Внутри группы</dt><dd>{shortMoney(selectedCluster.sum_kzt_internal)}</dd></div>}</dl>
      <p className="explorer-scope-note">{selectedCluster ? 'Переводы между группами' : 'Переводы в текущем фильтре'}</p>
      <label className="explorer-neighbors"><input type="checkbox" checked={neighborsOnly} onChange={event => setNeighborsOnly(event.target.checked)} />Только прямые связи</label>
      <button className="explorer-primary" onClick={() => selectedCluster ? drillIntoGroup(selectedCluster.cluster_id) : selected.gid && onOpenClient(selected.gid)}>{selectedCluster ? 'Раскрыть клиентов' : 'Открыть связи клиента'}<ArrowRight size={15} /></button>
      {selectedCluster && <button className="explorer-secondary" onClick={() => onOpenGroup(selectedCluster.cluster_id)}>Исследовать группу</button>}
      <div className="explorer-list-heading">Прямые соседи <span>{number.format(neighbors.length)}</span></div>
      {!neighbors.length && <p className="explorer-no-connections">{selectedCluster ? 'Внешних связей нет. Раскройте клиентов, чтобы увидеть переводы внутри группы.' : 'В текущем фильтре связей с другими клиентами нет.'}</p>}
      <div className="explorer-node-list">{neighbors.slice(0, listLimit).map(neighbor => <button key={neighbor.id} onClick={() => locate(neighbor.id)} title={neighbor.gid}><i style={{ background: colorMode === 'groups' ? groupColor(neighbor.clusterId) : colorMode === 'roles' ? neighbor.color : '#aaa7b2' }} /><span>{neighbor.gid ?? neighbor.label}</span><ArrowRight size={13} /></button>)}{neighbors.length > listLimit && <button className="explorer-load-more" onClick={() => setListLimit(value => value + 40)}>Показать ещё</button>}</div>
    </aside>}

    {model.nodes.length === 0 && <div className="explorer-empty" role="status"><strong>{filterCount ? 'По этим фильтрам клиентов нет' : 'Граф пока пуст'}</strong>{filterCount > 0 && <button onClick={resetFilters}>Показать всех клиентов</button>}</div>}

    <footer className="explorer-map-status" role="status">
      {level === 'clients' && groupFilter !== null && <button aria-label="Сбросить фильтр группы" onClick={() => { setGroupFilter(null); setSelectedClient(''); setNeighborsOnly(false); }}>Группа {groupFilter + 1}<X size={11} /></button>}
      {level === 'clients' && roleFilter !== 'all' && <button aria-label="Сбросить фильтр роли" onClick={() => { setRoleFilter('all'); setSelectedClient(''); setNeighborsOnly(false); }}>{roles[roleFilter].label}<X size={11} /></button>}
      <span>{number.format(shownCount)} {level === 'groups' ? plural(shownCount, 'группа', 'группы', 'групп') : plural(shownCount, 'клиент', 'клиента', 'клиентов')} <b>·</b> {number.format(edgeCount)} {plural(edgeCount, 'связь', 'связи', 'связей')}{selected && neighborsOnly && ' · прямые связи'}</span>
    </footer>
    {level === 'clients' && colorMode === 'roles' && !selected && panel === null && <div className="explorer-legend" aria-label="Цвета ролей">{Object.entries(roles).map(([key, role]) => <span key={key}><i style={{ background: role.color }} />{role.label}</span>)}</div>}
    {colorMode === 'groups' && !selected && panel === null && <div className="explorer-legend" aria-label="Цвета групп">Цвет — группа</div>}
  </section>;
}
