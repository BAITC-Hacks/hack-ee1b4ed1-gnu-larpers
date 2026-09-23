import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Maximize2, Minimize2, Search, X } from 'lucide-react';
import { roles, type GraphData, type Role } from './types';
import { number, plural, RoleBadge, shortMoney } from './format';
import { clientGraph, graphNeighborhood, groupGraph, type GraphNode } from './network-model';
import GraphCanvas from './GraphCanvas';

export default function GraphExplorer({ data, selectedGroup, onSelectGroup, onOpenClient, onOpenGroup }: {
  data: GraphData;
  selectedGroup: number | null;
  onSelectGroup: (id: number | null) => void;
  onOpenClient: (gid: string) => void;
  onOpenGroup: (id: number) => void;
}) {
  const [level, setLevel] = useState<'groups' | 'clients'>('groups');
  const [groupFilter, setGroupFilter] = useState<number | null>(null);
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all');
  const [selectedClient, setSelectedClient] = useState('');
  const [query, setQuery] = useState('');
  const [neighborsOnly, setNeighborsOnly] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [listLimit, setListLimit] = useState(40);
  const panelRef = useRef<HTMLElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const groups = useMemo(() => groupGraph(data), [data]);
  const nodeById = useMemo(() => new Map(data.nodes.map(node => [node.gid, node])), [data]);
  const clusterById = useMemo(() => new Map(data.clusters.map(group => [group.cluster_id, group])), [data]);
  const visibleClients = useMemo(() => data.nodes.filter(node => (groupFilter === null || node.cluster_id === groupFilter) && (roleFilter === 'all' || node.role === roleFilter)), [data, groupFilter, roleFilter]);
  const clients = useMemo(() => clientGraph(visibleClients, data.edges), [visibleClients, data.edges]);
  const model = level === 'groups' ? groups : clients;
  const selectedId = level === 'groups' ? selectedGroup === null ? '' : `group:${selectedGroup}` : selectedClient;
  const selected = model.nodes.find(node => node.id === selectedId);
  const selectedNode = selected?.gid ? nodeById.get(selected.gid) : undefined;
  const selectedCluster = selected?.kind === 'group' ? clusterById.get(selected.clusterId) : undefined;
  const neighborhood = useMemo(() => graphNeighborhood(model, selectedId), [model, selectedId]);
  const incidentEdges = useMemo(() => model.edges.filter(edge => edge.source === selectedId || edge.target === selectedId), [model, selectedId]);
  const neighbors = model.nodes.filter(node => node.id !== selectedId && neighborhood.has(node.id));
  const normalizedQuery = query.trim().toLocaleLowerCase('ru');
  const matches = useMemo(() => {
    if (!normalizedQuery) return [];
    const matchingGroups = groups.nodes.filter(node => node.label.toLocaleLowerCase('ru').includes(normalizedQuery));
    const matchingClients = normalizedQuery.length >= 3 ? data.nodes.filter(node => node.gid.includes(normalizedQuery)).map(node => ({ id: `node:${node.gid}`, gid: node.gid, label: node.gid, clusterId: node.cluster_id, kind: 'client' as const, size: 0, color: roles[node.role].color })) : [];
    return [...matchingGroups, ...matchingClients];
  }, [groups, data, normalizedQuery]);
  const browseNodes = useMemo(() => level === 'groups'
    ? [...model.nodes].sort((a, b) => (clusterById.get(b.clusterId)?.n_nodes ?? 0) - (clusterById.get(a.clusterId)?.n_nodes ?? 0))
    : [...model.nodes].sort((a, b) => {
      const first = nodeById.get(a.gid ?? '');
      const second = nodeById.get(b.gid ?? '');
      return ((second?.in_deg ?? 0) + (second?.out_deg ?? 0)) - ((first?.in_deg ?? 0) + (first?.out_deg ?? 0)) || a.id.localeCompare(b.id);
    }), [model, nodeById, clusterById, level]);

  useEffect(() => { setListLimit(40); }, [level, groupFilter, roleFilter]);
  useEffect(() => {
    if (!expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    expandRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setExpanded(false); expandRef.current?.focus(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]') ?? []).filter(element => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', handleKey); };
  }, [expanded]);

  const select = (id: string) => {
    if (level === 'groups') onSelectGroup(model.nodes.find(node => node.id === id)?.clusterId ?? null);
    else setSelectedClient(id);
  };
  const drillIntoGroup = (id: number) => {
    setLevel('clients'); setGroupFilter(id); setRoleFilter('all'); setSelectedClient(''); setNeighborsOnly(false); setQuery('');
  };
  const pickResult = (result: GraphNode) => {
    setQuery(''); setNeighborsOnly(false);
    if (result.kind === 'group') { setLevel('groups'); onSelectGroup(result.clusterId); }
    else { setLevel('clients'); setGroupFilter(result.clusterId); setRoleFilter('all'); setSelectedClient(result.id); }
    setFocusRequest(value => value + 1);
  };
  const changeLevel = (next: 'groups' | 'clients') => {
    setLevel(next); setNeighborsOnly(false); setQuery('');
    if (next === 'clients') { setGroupFilter(null); setRoleFilter('all'); setSelectedClient(''); }
  };
  const incoming = incidentEdges.filter(edge => edge.target === selectedId).reduce((sum, edge) => sum + edge.sumMinor, 0);
  const outgoing = incidentEdges.filter(edge => edge.source === selectedId).reduce((sum, edge) => sum + edge.sumMinor, 0);
  const shownCount = selected && neighborsOnly ? neighborhood.size : model.nodes.length;
  const edgeCount = selected && neighborsOnly ? incidentEdges.length : model.edges.length;

  return <section ref={panelRef} className={`graph-explorer ${expanded ? 'is-expanded' : ''}`} aria-label="Общий граф переводов" role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined}>
    <header className="explorer-heading">
      <div><span className="eyebrow">Карта связей</span><h3>{level === 'groups' ? 'Сначала группы, затем детали' : groupFilter === null ? 'Все клиенты сети' : `Клиенты группы ${groupFilter + 1}`}</h3><p>{level === 'groups' ? 'Выберите группу, чтобы выделить её связи, затем раскройте клиентов внутри.' : 'Выберите клиента, чтобы выделить входящие и исходящие связи. Масштаб и положение карты сохраняются.'}</p></div>
      <button ref={expandRef} className="explorer-expand" onClick={() => setExpanded(value => !value)} aria-label={expanded ? 'Свернуть граф' : 'Развернуть граф'} title={expanded ? 'Свернуть граф · Esc' : 'Развернуть граф'}>{expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
    </header>
    <div className="explorer-toolbar">
      <div className="explorer-level" role="group" aria-label="Детализация общего графа"><button aria-pressed={level === 'groups'} onClick={() => changeLevel('groups')}>Группы <span>{data.clusters.length}</span></button><button aria-pressed={level === 'clients'} onClick={() => changeLevel('clients')}>Клиенты <span>{number.format(data.nodes.length)}</span></button></div>
      <div className="explorer-search"><Search size={15} /><input aria-label="Поиск на графе" placeholder="Группа или ID клиента" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setQuery(''); event.stopPropagation(); } if (event.key === 'Enter' && matches[0]) pickResult(matches[0]); }} />{query && <button aria-label="Очистить поиск на графе" onClick={() => setQuery('')}><X size={14} /></button>}
        {normalizedQuery && <div className="explorer-search-results" aria-label="Результаты поиска на графе"><span>{matches.length ? `Найдено: ${number.format(matches.length)}${matches.length > 20 ? ' · первые 20' : ''}` : 'Ничего не найдено'}{normalizedQuery.length < 3 ? ' · для ID введите от 3 цифр' : ''}</span>{matches.slice(0, 20).map(result => <button key={result.id} onClick={() => pickResult(result)}><strong>{result.label}</strong><small>{result.kind === 'group' ? 'Выделить группу' : `Клиент · группа ${result.clusterId + 1}`}</small></button>)}</div>}
      </div>
    </div>
    {level === 'clients' && <div className="explorer-filters"><button className="explorer-back" onClick={() => changeLevel('groups')}><ArrowLeft size={14} />К группам</button><label>Группа<select aria-label="Группа на графе" value={groupFilter ?? 'all'} onChange={event => { setGroupFilter(event.target.value === 'all' ? null : Number(event.target.value)); setSelectedClient(''); setNeighborsOnly(false); }}><option value="all">Все группы</option>{data.clusters.map(group => <option key={group.cluster_id} value={group.cluster_id}>Группа {group.cluster_id + 1} · {group.n_nodes}</option>)}</select></label><label>Роль<select aria-label="Роль на графе" value={roleFilter} onChange={event => { setRoleFilter(event.target.value as Role | 'all'); setSelectedClient(''); setNeighborsOnly(false); }}><option value="all">Все роли</option>{Object.entries(roles).map(([role, item]) => <option key={role} value={role}>{item.label}</option>)}</select></label></div>}
    <div className="explorer-workspace">
      <div className="explorer-map"><div className="explorer-map-status" role="status">{number.format(shownCount)} {level === 'groups' ? 'групп' : 'клиентов'} <span>·</span> {number.format(edgeCount)} связей{selected && neighborsOnly && <span>· прямое окружение</span>}</div><GraphCanvas model={model} selectedId={selected?.id ?? ''} neighborsOnly={neighborsOnly} focusRequest={focusRequest} onSelect={select} /></div>
      <aside className="explorer-inspector" aria-label="Выбор и связи узла">
        {selected ? <>
          <div className="explorer-selection-heading"><span>{selected.kind === 'group' ? 'Выбрана группа' : 'Выбран клиент'}</span><button aria-label="Снять выделение на графе" onClick={() => { select(''); setNeighborsOnly(false); }}><X size={16} /></button></div>
          <h4>{selected.gid ?? selected.label}</h4>
          {selectedNode && <RoleBadge role={selectedNode.role} />}
          {selectedCluster && <p>{number.format(selectedCluster.n_nodes)} {plural(selectedCluster.n_nodes, 'клиент', 'клиента', 'клиентов')} · {selectedCluster.n_seed} {plural(selectedCluster.n_seed, 'исходный', 'исходных', 'исходных')}</p>}
          <dl className="explorer-flows"><div><dt>Входящие</dt><dd>{shortMoney(incoming / 100)}</dd></div><div><dt>Исходящие</dt><dd>{shortMoney(outgoing / 100)}</dd></div>{selectedCluster && <div><dt>Внутри группы</dt><dd>{shortMoney(selectedCluster.sum_kzt_internal)}</dd></div>}</dl>
          <p className="explorer-scope-note">{selectedCluster ? 'Входящие и исходящие — только между группами.' : 'Суммы по связям в текущем фильтре графа.'}</p>
          <label className="explorer-neighbors"><input type="checkbox" checked={neighborsOnly} onChange={event => setNeighborsOnly(event.target.checked)} />Только прямые связи</label>
          <button className="explorer-primary" onClick={() => selectedCluster ? drillIntoGroup(selectedCluster.cluster_id) : selected.gid && onOpenClient(selected.gid)}>{selectedCluster ? 'Раскрыть клиентов' : 'Открыть связи клиента'}<ArrowRight size={15} /></button>
          {selectedCluster && <button className="explorer-secondary" onClick={() => onOpenGroup(selectedCluster.cluster_id)}>Исследовать группу</button>}
          <div className="explorer-list-heading">Прямые соседи <span>{neighbors.length}</span></div>
          {!neighbors.length && <p className="explorer-no-connections">{selectedCluster ? 'Связей с другими группами нет. Клиенты и внутренние переводы доступны при раскрытии.' : 'В текущем фильтре связей с другими клиентами нет.'}</p>}
          <div className="explorer-node-list">{neighbors.map(neighbor => <button key={neighbor.id} onClick={() => select(neighbor.id)} title={neighbor.gid}><i style={{ background: neighbor.color }} /><span>{neighbor.label}</span><ArrowRight size={13} /></button>)}</div>
        </> : <>
          <span className="eyebrow">Начните с узла</span><h4>{level === 'groups' ? 'Как связаны группы' : 'Выберите клиента'}</h4><p>{level === 'groups' ? 'В круге — номер группы, размер — число клиентов. Стрелка показывает направление переводов.' : 'Цвет — роль клиента. Золотой контур — исходный клиент, пунктир — граница выборки.'}</p><p>Нажатие выделит соседей. Перетащите узел, чтобы раздвинуть связи.</p>
          <div className="explorer-list-heading">{level === 'groups' ? 'Группы по размеру' : 'Клиенты по числу связей'} <span>{model.nodes.length}</span></div>
          <div className="explorer-node-list">{browseNodes.slice(0, listLimit).map(item => <button key={item.id} onClick={() => select(item.id)} title={item.gid}><i style={{ background: item.color }} /><span>{item.label}</span><small>{item.kind === 'group' ? clusterById.get(item.clusterId)?.n_nodes : `гр. ${item.clusterId + 1}`}</small></button>)}{browseNodes.length > listLimit && <button className="explorer-load-more" onClick={() => setListLimit(value => value + 40)}>Показать ещё</button>}</div>
        </>}
      </aside>
    </div>
    <footer className="explorer-footer"><div className="explorer-legend">{level === 'groups' ? <span><i className="group-dot" />В круге — номер группы; размер — число клиентов</span> : Object.entries(roles).map(([key, role]) => <span key={key}><i style={{ background: role.color }} />{role.label}</span>)}<span><b className="incoming-line" />Входящие</span><span><b className="outgoing-line" />Исходящие</span></div><p>{level === 'groups' ? 'Каждая группа включает всех своих клиентов. Внутренние переводы видны после раскрытия группы; группы без внешних связей также сохранены.' : groupFilter !== null ? 'Показаны связи между клиентами выбранной группы и роли. Внешние контрагенты доступны в исследовании группы.' : roleFilter !== 'all' ? 'Показаны все клиенты выбранной роли и связи между ними.' : 'Все клиенты и направленные связи без ограничения количества. Приближайте карту для подписей или найдите клиента по ID.'}</p></footer>
  </section>;
}
