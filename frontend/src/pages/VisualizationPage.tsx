import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Network } from 'lucide-react';
import { roles, type EdgeRow, type GraphData, type NodeRow, type Role } from '../types';
import { RoleBadge, number, percent, plural, shortId, shortMoney } from '../format';
import NetworkGraph from '../NetworkGraph';
import GraphExplorer from '../GraphExplorer';
import { evidenceGraph } from '../agent';
import { selectClusterGraph, selectNeighborhood } from '../data';

function FlowGraph({ data, node, onSelect, expandSide }: { data: GraphData; node: NodeRow; onSelect: (gid: string) => void; expandSide?: 'in' | 'out' | null }) {
  const [expandedIn, setExpandedIn] = useState(false);
  const [expandedOut, setExpandedOut] = useState(false);
  useEffect(() => { setExpandedIn(false); setExpandedOut(false); }, [node.gid]);
  useEffect(() => { if (expandSide === 'in') setExpandedIn(true); if (expandSide === 'out') setExpandedOut(true); }, [expandSide]);
  const flow = useMemo(() => {
    const incoming = data.edges.filter(edge => edge.dst === node.gid && edge.src !== node.gid).sort((a, b) => b.sum_minor - a.sum_minor);
    const outgoing = data.edges.filter(edge => edge.src === node.gid && edge.dst !== node.gid).sort((a, b) => b.sum_minor - a.sum_minor);
    const byId = new Map(data.nodes.map(item => [item.gid, item]));
    return { incoming, outgoing, byId };
  }, [data, node.gid]);
  const limit = 5;
  const renderParties = (edges: EdgeRow[], direction: 'in' | 'out') => {
    const expanded = direction === 'in' ? expandedIn : expandedOut;
    const setExpanded = direction === 'in' ? setExpandedIn : setExpandedOut;
    const visible = expanded ? edges : edges.slice(0, limit);
    const remainder = edges.slice(limit);
    const largest = Math.max(1, ...visible.map(edge => edge.sum_minor));
    return <div className={`flow-parties ${expanded ? 'expanded' : ''}`}>
      {visible.map(edge => {
        const gid = direction === 'in' ? edge.src : edge.dst;
        const party = flow.byId.get(gid);
        return <button className="flow-party" key={`${edge.src}-${edge.dst}`} onClick={() => onSelect(gid)} title={`Открыть клиента ${gid}`}>
          <span className="flow-party-main"><span className="flow-party-id">{shortId(gid)}</span><strong>{shortMoney(edge.sum_kzt)}</strong></span>
          <span className="flow-party-meta">{party ? roles[party.role].label : 'Клиент'}<span>{edge.n_tx} {plural(edge.n_tx, 'перевод', 'перевода', 'переводов')}</span></span>
          <span className="flow-party-bar"><i style={{ width: `${edge.sum_minor / largest * 100}%` }} /></span>
        </button>;
      })}
      {remainder.length > 0 && <button className="flow-remainder" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><span>{expanded ? 'Свернуть список' : `Ещё ${remainder.length} ${plural(remainder.length, 'клиент', 'клиента', 'клиентов')}`}</span><strong>{expanded ? 'Скрыть' : shortMoney(remainder.reduce((sum, edge) => sum + edge.sum_kzt, 0))}</strong></button>}
      {edges.length === 0 && <div className="flow-no-parties">Связей в этом направлении не наблюдается.</div>}
    </div>;
  };
  return <div className="flow-view">
    <div className="flow-view-intro"><p>Пять крупнейших связей по сумме с каждой стороны. Выберите контрагента, чтобы открыть его профиль.</p></div>
    <div className="flow-columns">
      <section className="flow-column"><div className="flow-column-heading"><ArrowDownLeft size={17} /><div><h4>Поступления</h4><span>{flow.incoming.length} {plural(flow.incoming.length, 'отправитель', 'отправителя', 'отправителей')} · {shortMoney(node.in_kzt)}</span></div></div>{renderParties(flow.incoming, 'in')}</section>
      <div className="flow-center"><span className="flow-center-label">Выбранный клиент</span><div className="flow-center-glyph"><Network size={25} /></div><strong title={node.gid}>{shortId(node.gid)}</strong><RoleBadge role={node.role} /><span className="flow-center-note">Суммы по сторонам — наблюдаемые переводы, а не баланс клиента.</span></div>
      <section className="flow-column"><div className="flow-column-heading"><ArrowUpRight size={17} /><div><h4>Отправления</h4><span>{flow.outgoing.length} {plural(flow.outgoing.length, 'получатель', 'получателя', 'получателей')} · {shortMoney(node.out_kzt)}</span></div></div>{renderParties(flow.outgoing, 'out')}</section>
    </div>
    <p className="flow-footnote">Эти связи не показывают, что конкретное поступление стало конкретным исходящим переводом.</p>
  </div>;
}

type MapParty = { gid?: string; label: string; role?: Role; amount: number; transfers: number; count?: number };

type GroupRoute = { src: number; dst: number; sumMinor: number; links: number; transfers: number };

function NetworkOverview({ data, selectedGid, onSelectClient, onOpenCluster }: { data: GraphData; selectedGid: string; onSelectClient: (gid: string) => void; onOpenCluster: (id: number) => void }) {
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);
  const [showAllRoutes, setShowAllRoutes] = useState(false);
  const [showAllGroups, setShowAllGroups] = useState(false);
  const [groupQuery, setGroupQuery] = useState('');
  const overview = useMemo(() => {
    const groupByGid = new Map(data.nodes.map(node => [node.gid, node.cluster_id]));
    const routes = new Map<string, GroupRoute>();
    let internalMinor = 0;
    let externalMinor = 0;
    for (const edge of data.edges) {
      const src = groupByGid.get(edge.src);
      const dst = groupByGid.get(edge.dst);
      if (src === undefined || dst === undefined) continue;
      if (src === dst) { internalMinor += edge.sum_minor; continue; }
      externalMinor += edge.sum_minor;
      const key = `${src}:${dst}`;
      const route = routes.get(key) ?? { src, dst, sumMinor: 0, links: 0, transfers: 0 };
      route.sumMinor += edge.sum_minor;
      route.links += 1;
      route.transfers += edge.n_tx;
      routes.set(key, route);
    }
    const sortedRoutes = [...routes.values()].sort((a, b) => b.sumMinor - a.sumMinor);
    const groups = [...data.clusters].sort((a, b) => b.n_nodes - a.n_nodes || a.cluster_id - b.cluster_id);
    const externalByGroup = new Map<number, { incoming: number; outgoing: number }>();
    for (const route of sortedRoutes) {
      const source = externalByGroup.get(route.src) ?? { incoming: 0, outgoing: 0 };
      source.outgoing += route.sumMinor;
      externalByGroup.set(route.src, source);
      const target = externalByGroup.get(route.dst) ?? { incoming: 0, outgoing: 0 };
      target.incoming += route.sumMinor;
      externalByGroup.set(route.dst, target);
    }
    return { internalMinor, externalMinor, routes: sortedRoutes, groups, externalByGroup };
  }, [data]);
  const activeGroup = data.clusters.find(group => group.cluster_id === selectedGroup);
  const routes = selectedGroup === null ? overview.routes : overview.routes.filter(route => route.src === selectedGroup || route.dst === selectedGroup);
  const shownRoutes = showAllRoutes ? routes : routes.slice(0, 8);
  const filteredGroups = overview.groups.filter(group => !groupQuery.trim() || String(group.cluster_id + 1).includes(groupQuery.trim()));
  const shownGroups = showAllGroups || groupQuery ? filteredGroups : filteredGroups.slice(0, 12);
  const totalMinor = overview.internalMinor + overview.externalMinor;
  const routeMinor = routes.reduce((sum, route) => sum + route.sumMinor, 0);
  const visibleRouteMinor = shownRoutes.reduce((sum, route) => sum + route.sumMinor, 0);
  const maxRoute = Math.max(1, ...shownRoutes.map(route => route.sumMinor));
  const maxGroup = Math.max(1, ...overview.groups.map(group => group.n_nodes));
  const groupName = (id: number) => `Группа ${id + 1}`;
  return <div className="network-overview">
    <section className="overview-summary" aria-label="Вся сеть в цифрах">
      <div className="overview-summary-title"><span className="eyebrow">Вся наблюдаемая сеть</span><h2>{number.format(data.metadata.n_nodes)} {plural(data.metadata.n_nodes, 'клиент', 'клиента', 'клиентов')} в {data.metadata.n_clusters} группах</h2><p>{number.format(data.metadata.n_edges)} направленных связей · {number.format(data.metadata.n_transactions)} переводов. Каждый клиент и каждый перевод включены в обзор.</p></div>
      <div className="overview-share"><div className="overview-share-label"><span>Внутри групп <strong>{shortMoney(overview.internalMinor / 100)}</strong></span><span>{percent(overview.internalMinor / totalMinor)}</span></div><div className="overview-share-track"><span style={{ width: percent(overview.internalMinor / totalMinor) }} /></div><div className="overview-share-label"><span>Между группами <strong>{shortMoney(overview.externalMinor / 100)}</strong></span><span>{percent(overview.externalMinor / totalMinor)}</span></div></div>
    </section>
    <GraphExplorer data={data} selectedGroup={selectedGroup} onSelectGroup={id => { setSelectedGroup(id); setShowAllRoutes(false); }} onOpenClient={onSelectClient} onOpenGroup={onOpenCluster} />
    <div className="overview-layout">
      <section className="overview-routes-panel" aria-label="Граф переводов между группами">
        <div className="overview-panel-heading"><div><span className="eyebrow">Граф всей выборки</span><h3>{selectedGroup === null ? 'Основные маршруты между группами' : `Связи группы ${selectedGroup + 1}`}</h3><p>{routes.length} {plural(routes.length, 'направленный маршрут', 'направленных маршрута', 'направленных маршрутов')}{selectedGroup === null ? ' между группами' : ' с этой группой'}. Сейчас показано {shownRoutes.length} — {routeMinor ? percent(visibleRouteMinor / routeMinor) : '0%'} объёма этих маршрутов.</p></div>{selectedGroup !== null && <button className="overview-clear" onClick={() => { setSelectedGroup(null); setShowAllRoutes(false); }}>Вся сеть</button>}</div>
        <div className="overview-route-caption"><span>Отправитель</span><span>Направление</span><span>Получатель</span><span>Объём</span></div>
        <div className={`overview-route-list ${showAllRoutes ? 'expanded' : ''}`}>{shownRoutes.map(route => <article className="overview-route" key={`${route.src}-${route.dst}`}><button className={selectedGroup === route.src ? 'active' : ''} onClick={() => { setSelectedGroup(route.src); setShowAllRoutes(false); }}>{groupName(route.src)}</button><span className="overview-route-arrow" aria-label="перевод в"><i /></span><button className={selectedGroup === route.dst ? 'active' : ''} onClick={() => { setSelectedGroup(route.dst); setShowAllRoutes(false); }}>{groupName(route.dst)}</button><strong>{shortMoney(route.sumMinor / 100)}</strong><div className="overview-route-bar"><i style={{ width: `${route.sumMinor / maxRoute * 100}%` }} /></div><small>{route.links} {plural(route.links, 'связь', 'связи', 'связей')} · {route.transfers} {plural(route.transfers, 'перевод', 'перевода', 'переводов')}</small></article>)}{!routes.length && <p className="overview-empty">У этой группы нет наблюдаемых переводов с другими группами.</p>}</div>
        {routes.length > 8 && <button className="overview-more" onClick={() => setShowAllRoutes(value => !value)}>{showAllRoutes ? 'Свернуть маршруты' : `Показать все ${routes.length} ${plural(routes.length, 'маршрут', 'маршрута', 'маршрутов')}`}</button>}
        <p className="overview-footnote">Маршрут объединяет все прямые переводы между двумя группами. Это не доказательство движения одних и тех же денег по цепочке.</p>
      </section>
      <aside className="overview-groups-panel" aria-label="Группы всей сети">
        <div className="overview-panel-heading"><div><span className="eyebrow">Масштаб сети</span><h3>Все группы</h3><p>По числу клиентов · {overview.groups.length} групп</p></div></div>
        {activeGroup && <div className="overview-selected-group"><div><strong>{groupName(activeGroup.cluster_id)}</strong><button onClick={() => setSelectedGroup(null)}>Сбросить</button></div><p>{activeGroup.n_nodes} {plural(activeGroup.n_nodes, 'клиент', 'клиента', 'клиентов')} · {activeGroup.n_seed} {plural(activeGroup.n_seed, 'исходный', 'исходных', 'исходных')}</p><dl><div><dt>Внутри группы</dt><dd>{shortMoney(activeGroup.sum_kzt_internal)}</dd></div><div><dt>Из других групп</dt><dd>{shortMoney((overview.externalByGroup.get(activeGroup.cluster_id)?.incoming ?? 0) / 100)}</dd></div><div><dt>В другие группы</dt><dd>{shortMoney((overview.externalByGroup.get(activeGroup.cluster_id)?.outgoing ?? 0) / 100)}</dd></div></dl><div className="overview-group-actions"><button className="overview-client-link" onClick={() => onSelectClient(activeGroup.top_gids[0])}>Ключевой клиент</button><button className="overview-client-link" onClick={() => onOpenCluster(activeGroup.cluster_id)}>Открыть граф группы</button></div></div>}
        <label className="overview-group-search"><span>Найти группу</span><input value={groupQuery} onChange={event => setGroupQuery(event.target.value)} inputMode="numeric" placeholder="Номер группы" /></label>
        <div className={`overview-group-list ${showAllGroups || groupQuery ? 'expanded' : ''}`}>{shownGroups.map(group => <button key={group.cluster_id} className={`overview-group-row ${selectedGroup === group.cluster_id ? 'active' : ''}`} aria-label={`Открыть граф группы ${group.cluster_id + 1}`} onClick={() => onOpenCluster(group.cluster_id)}><span><strong>{groupName(group.cluster_id)}</strong><small>{group.n_nodes} {plural(group.n_nodes, 'клиент', 'клиента', 'клиентов')} · {shortMoney(group.sum_kzt_internal)} внутри</small></span><i><b style={{ width: `${group.n_nodes / maxGroup * 100}%` }} /></i></button>)}{!filteredGroups.length && <div className="overview-empty">Группа не найдена.</div>}</div>
        {!groupQuery && overview.groups.length > 12 && <button className="overview-more" onClick={() => setShowAllGroups(value => !value)}>{showAllGroups ? 'Свернуть группы' : `Показать все ${overview.groups.length} групп`}</button>}
      </aside>
    </div>
  </div>;
}

function RelationshipMap({ data, node, onSelect, onShowMore }: { data: GraphData; node: NodeRow; onSelect: (gid: string) => void; onShowMore: (side: 'in' | 'out') => void }) {
  const { incoming, outgoing } = useMemo(() => {
    const byId = new Map(data.nodes.map(item => [item.gid, item]));
    const summarize = (edges: EdgeRow[], direction: 'in' | 'out'): MapParty[] => {
      const sorted = edges.sort((a, b) => b.sum_minor - a.sum_minor);
      const shown: MapParty[] = sorted.slice(0, 4).map(edge => {
        const gid = direction === 'in' ? edge.src : edge.dst;
        return { gid, label: shortId(gid), role: byId.get(gid)?.role, amount: edge.sum_kzt, transfers: edge.n_tx };
      });
      const rest = sorted.slice(4);
      if (rest.length) shown.push({ label: `Другие ${rest.length}`, amount: rest.reduce((total, edge) => total + edge.sum_kzt, 0), transfers: rest.reduce((total, edge) => total + edge.n_tx, 0), count: rest.length });
      return shown;
    };
    return {
      incoming: summarize(data.edges.filter(edge => edge.dst === node.gid && edge.src !== node.gid), 'in'),
      outgoing: summarize(data.edges.filter(edge => edge.src === node.gid && edge.dst !== node.gid), 'out'),
    };
  }, [data, node.gid]);
  const position = (index: number, count: number) => 280 + (index - (count - 1) / 2) * 100;
  const renderParties = (parties: MapParty[], side: 'in' | 'out') => parties.map((party, index) => {
    const top = `${position(index, parties.length) / 560 * 100}%`;
    return <button key={party.gid ?? `${side}-other`} className={`map-party ${side} ${party.count ? 'aggregate' : ''}`} style={{ top }} onClick={() => party.gid ? onSelect(party.gid) : onShowMore(side)} title={party.gid ?? 'Перейти к остальным связям в списке ниже'}>
      <span className="map-party-heading"><strong>{party.label}</strong><span>{shortMoney(party.amount)}</span></span>
      <span className="map-party-subtitle">{party.count ? `${party.count} ${plural(party.count, 'клиент', 'клиента', 'клиентов')}` : party.role ? roles[party.role].label : 'Клиент'} · {party.transfers} {plural(party.transfers, 'перевод', 'перевода', 'переводов')}</span>
    </button>;
  });
  return <div className="relationship-map" aria-label="Схема прямых переводов выбранного клиента">
    <div className="map-direction-label in"><span>Отправители</span><strong>{incoming.length > 0 ? `${node.in_deg} ${plural(node.in_deg, 'клиент', 'клиента', 'клиентов')}` : 'Нет связей'}</strong></div>
    <div className="map-direction-label out"><span>Получатели</span><strong>{outgoing.length > 0 ? `${node.out_deg} ${plural(node.out_deg, 'клиент', 'клиента', 'клиентов')}` : 'Нет связей'}</strong></div>
    <svg className="map-connections" viewBox="0 0 1000 560" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="map-in-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8b819c" /></marker><marker id="map-out-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#aa86df" /></marker></defs>
      {incoming.map((party, index) => <path key={`in-${index}`} d={`M 250 ${position(index, incoming.length)} L 410 280`} className={party.count ? 'aggregate' : ''} markerEnd="url(#map-in-arrow)" />)}
      {outgoing.map((party, index) => <path key={`out-${index}`} d={`M 590 280 L 750 ${position(index, outgoing.length)}`} className={party.count ? 'aggregate outgoing' : 'outgoing'} markerEnd="url(#map-out-arrow)" />)}
    </svg>
    {renderParties(incoming, 'in')}
    <div className="map-focus"><span>Выбранный клиент</span><strong title={node.gid}>{shortId(node.gid)}</strong><RoleBadge role={node.role} /><small>Группа {node.cluster_id + 1}</small></div>
    {renderParties(outgoing, 'out')}
    {!incoming.length && <div className="map-empty in">Поступлений от других клиентов не видно</div>}
    {!outgoing.length && <div className="map-empty out">Отправлений другим клиентам не видно</div>}
  </div>;
}

function GraphClients({ nodes, selectedGid, clusterId, onSelect }: { nodes: NodeRow[]; selectedGid: string; clusterId?: number; onSelect: (gid: string) => void }) {
  const [query, setQuery] = useState('');
  const visible = nodes.filter(node => node.gid.includes(query.trim()));
  return <details className="graph-clients">
    <summary>Клиенты на графе ({number.format(nodes.length)})</summary>
    <div className="graph-client-search"><label>Найти клиента на графе<input value={query} onChange={event => setQuery(event.target.value)} placeholder="ID клиента" inputMode="numeric" /></label><span aria-live="polite">{number.format(visible.length)} из {number.format(nodes.length)}</span></div>
    <div className="graph-client-list">{visible.map(node => <button type="button" key={node.gid} className={node.gid === selectedGid ? 'selected' : ''} onClick={() => onSelect(node.gid)} aria-label={`Открыть клиента ${node.gid}`}><strong>{node.gid}</strong><RoleBadge role={node.role} /><span>{clusterId !== undefined && node.cluster_id !== clusterId ? 'Внешний · ' : ''}Группа {node.cluster_id + 1}</span></button>)}{visible.length === 0 && <p className="overview-empty">На этом графе клиент не найден.</p>}</div>
  </details>;
}

function GraphLegend({ external = false }: { external?: boolean }) {
  return <div className="graph-legend" aria-label="Условные обозначения графа">{Object.entries(roles).map(([key, item]) => <span key={key}><i style={{ background: item.color }} />{item.label}</span>)}{external && <span><i className="external-marker" />Внешний контрагент</span>}</div>;
}

function ClusterGraph({ data, clusterId, selectedGid, includeExternal, onIncludeExternalChange, onSelectClient, onBrowseGroup }: { data: GraphData; clusterId: number; selectedGid: string; includeExternal: boolean; onIncludeExternalChange: (value: boolean) => void; onSelectClient: (gid: string) => void; onBrowseGroup: (id: number) => void }) {
  const graph = useMemo(() => selectClusterGraph(data, clusterId, includeExternal), [data, clusterId, includeExternal]);
  const cluster = data.clusters.find(item => item.cluster_id === clusterId);
  if (!cluster) return <p className="overview-empty">Группа отсутствует в текущей выборке. Выберите другую группу в обзоре сети.</p>;
  return <>
    <div className="workspace-heading"><div><span>Все клиенты и связи выбранной группы</span><h2>Группа {clusterId + 1}</h2></div><button className="directory-trigger" onClick={() => onBrowseGroup(clusterId)}>Список клиентов группы</button></div>
    <section className="visualization-panel scope-graph-panel" aria-label={`Граф группы ${clusterId + 1}`}>
      <div className="visualization-intro"><div><span className="eyebrow">Группа целиком</span><h3>{number.format(graph.memberCount)} {plural(graph.memberCount, 'клиент', 'клиента', 'клиентов')} · {number.format(graph.internalEdgeCount)} {plural(graph.internalEdgeCount, 'внутренняя связь', 'внутренние связи', 'внутренних связей')}</h3><p>{cluster.hypothesis}</p></div></div>
      <div className="graph-scope-controls"><label className="external-control"><input type="checkbox" checked={includeExternal} onChange={event => onIncludeExternalChange(event.target.checked)} />Внешние контрагенты <span>({number.format(graph.externalCount)})</span></label><span>{number.format(graph.externalEdgeCount)} {plural(graph.externalEdgeCount, 'связь', 'связи', 'связей')} с другими группами</span></div>
      <p className="graph-scope-count" aria-live="polite">На графе все {number.format(graph.memberCount)} {plural(graph.memberCount, 'клиент', 'клиента', 'клиентов')} группы{includeExternal ? ` и ${number.format(graph.externalCount)} внешних контрагентов` : ''} · {number.format(graph.edges.length)} {plural(graph.edges.length, 'направленная связь', 'направленные связи', 'направленных связей')}. Ограничения числа клиентов нет.</p>
      <div className="scope-network-stage"><NetworkGraph nodes={graph.nodes} edges={graph.edges} selectedGid={selectedGid} clusterId={clusterId} mode="cluster" onSelect={onSelectClient} /></div>
      <GraphLegend external={includeExternal && graph.externalCount > 0} />
      <GraphClients key={clusterId} nodes={graph.nodes} clusterId={clusterId} selectedGid={selectedGid} onSelect={onSelectClient} />
      <p className="visualization-note">Внешние контрагенты связаны напрямую хотя бы с одним участником группы. Связи внешних клиентов между собой не включены. Принадлежность к группе описывает структуру наблюдаемой сети и не устанавливает общий контроль над клиентами.</p>
    </section>
  </>;
}

function NeighborhoodGraph({ data, node, hops, onHopsChange, onSelectClient }: { data: GraphData; node: NodeRow; hops: 1 | 2; onHopsChange: (hops: 1 | 2) => void; onSelectClient: (gid: string) => void }) {
  const graph = useMemo(() => selectNeighborhood(data, node.gid, hops, 250), [data, node.gid, hops]);
  return <section className="visualization-panel scope-graph-panel neighborhood-panel" aria-label="Граф окружения клиента">
    <div className="visualization-intro"><div><span className="eyebrow">Окружение клиента</span><h3>Связи на {hops === 1 ? 'один шаг' : 'два шага'}</h3><p>Окружение раскрывается по входящим и исходящим связям. Стрелки сохраняют направление наблюдаемых переводов.</p></div><div className="scope-control" role="group" aria-label="Глубина окружения">{([1, 2] as const).map(value => <button type="button" key={value} aria-pressed={hops === value} className={hops === value ? 'active' : ''} onClick={() => onHopsChange(value)}>{value} {value === 1 ? 'шаг' : 'шага'}</button>)}</div></div>
    <p className={`graph-scope-count ${graph.truncated ? 'truncated' : ''}`} aria-live="polite">Показано {number.format(graph.nodes.length)} из {number.format(graph.totalNodes)} {plural(graph.totalNodes, 'клиента', 'клиентов', 'клиентов')}, включая выбранного · {number.format(graph.edges.length)} {plural(graph.edges.length, 'связь', 'связи', 'связей')}.{graph.truncated ? ` Достигнут лимит 250 клиентов: скрыто ${number.format(graph.totalNodes - graph.nodes.length)}. Сначала включаются ближайшие клиенты, затем клиенты с более высоким приоритетом. Связи скрытых клиентов не отображаются.` : ' Все клиенты этого окружения включены.'}</p>
    <div className="scope-network-stage"><NetworkGraph nodes={graph.nodes} edges={graph.edges} selectedGid={node.gid} mode="focus" onSelect={onSelectClient} /></div>
    <GraphLegend />
    <GraphClients key={`${node.gid}:${hops}`} nodes={graph.nodes} selectedGid={node.gid} onSelect={onSelectClient} />
    <p className="visualization-note">Два шага означают связь через одного контрагента. Это не подтверждает хронологическую цепочку или передачу одних и тех же средств.</p>
  </section>;
}

interface VisualizationPageProps {
  data: GraphData;
  node: NodeRow;
  mode: 'overview' | 'cluster' | 'client';
  clusterId: number | null;
  hops: 1 | 2;
  includeExternal: boolean;
  onModeChange: (mode: 'overview' | 'cluster' | 'client') => void;
  onHopsChange: (hops: 1 | 2) => void;
  onIncludeExternalChange: (value: boolean) => void;
  onOpenCluster: (id: number) => void;
  onSelectClient: (gid: string) => void;
  onBrowseClients: () => void;
  onBrowseGroup: (id: number) => void;
  onOpenProfile: () => void;
  evidencePaths: string[][];
  onClearPaths: () => void;
}

export default function VisualizationPage({ data, node, mode, clusterId, hops, includeExternal, onModeChange, onHopsChange, onIncludeExternalChange, onOpenCluster, onSelectClient, onBrowseClients, onBrowseGroup, onOpenProfile, evidencePaths, onClearPaths }: VisualizationPageProps) {
  const [expandedSide, setExpandedSide] = useState<'in' | 'out' | null>(null);
  const pathGraph = useMemo(() => evidenceGraph(data, evidencePaths), [data, evidencePaths]);
  useEffect(() => { setExpandedSide(null); }, [node.gid]);
  return <>
    <div className="visualization-switch" role="tablist" aria-label="Масштаб визуализации"><button role="tab" aria-selected={mode === 'overview'} className={mode === 'overview' ? 'active' : ''} onClick={() => onModeChange('overview')}>Вся сеть</button><button role="tab" aria-selected={mode === 'cluster'} className={mode === 'cluster' ? 'active' : ''} onClick={() => onOpenCluster(clusterId ?? node.cluster_id)}>Группа</button><button role="tab" aria-selected={mode === 'client'} className={mode === 'client' ? 'active' : ''} onClick={() => onModeChange('client')}>Один клиент</button></div>
    {mode !== 'overview' && <nav className="graph-breadcrumbs" aria-label="Путь исследования"><button onClick={() => onModeChange('overview')}>Вся сеть</button><span aria-hidden="true">/</span>{mode === 'cluster' ? <strong aria-current="page">Группа {(clusterId ?? node.cluster_id) + 1}</strong> : <><button onClick={() => onOpenCluster(clusterId ?? node.cluster_id)}>Группа {(clusterId ?? node.cluster_id) + 1}</button><span aria-hidden="true">/</span><strong aria-current="page">Клиент {shortId(node.gid)}</strong>{clusterId !== null && clusterId !== node.cluster_id && <button onClick={() => onOpenCluster(node.cluster_id)}>Его группа {node.cluster_id + 1}</button>}</>}</nav>}
    {evidencePaths.length > 0 ? <section className="visualization-panel" aria-label="Пути из ответа агента">
      <div className="visualization-intro"><div><span className="eyebrow">Основания ответа</span><h3>Наблюдаемые пути от исходных клиентов</h3><p>{evidencePaths.length} {plural(evidencePaths.length, 'путь', 'пути', 'путей')} · {pathGraph.nodes.length} {plural(pathGraph.nodes.length, 'клиент', 'клиента', 'клиентов')} · только связи из выбранного основания.</p></div><button className="method-link" onClick={onClearPaths}>Вернуться к связям клиента</button></div>
      <NetworkGraph nodes={pathGraph.nodes} edges={pathGraph.edges} selectedGid={node.gid} mode="paths" onSelect={onSelectClient} />
      <p className="visualization-note">Направленные пути подтверждены графом. Они не доказывают движение одних и тех же денег или порядок переводов внутри дня.</p>
    </section> : mode === 'overview' ? <NetworkOverview data={data} selectedGid={node.gid} onSelectClient={onSelectClient} onOpenCluster={onOpenCluster} /> : mode === 'cluster' ? <ClusterGraph data={data} clusterId={clusterId ?? node.cluster_id} selectedGid={node.gid} includeExternal={includeExternal} onIncludeExternalChange={onIncludeExternalChange} onSelectClient={onSelectClient} onBrowseGroup={onBrowseGroup} /> : <>
      <div className="workspace-heading"><div><span>Связи выбранного клиента</span><h2 title={node.gid}>{node.gid}</h2></div><div className="workspace-actions"><button className="directory-trigger" onClick={onBrowseClients}>Выбрать клиента</button><button className="method-link" onClick={onOpenProfile}>Профиль и переводы</button></div></div>
      <section className="visualization-panel relationship-map-panel" aria-label="Граф прямых переводов">
        <div className="visualization-intro"><div><span className="eyebrow">Прямые переводы</span><h3>Кто отправлял и кому ушли средства</h3><p>Показаны до четырёх крупнейших связей по сумме с каждой стороны. Остальные объединены в одну группу.</p></div><div className="visualization-key"><span><i />Поступления</span><span><i />Отправления</span></div></div>
        <RelationshipMap data={data} node={node} onSelect={onSelectClient} onShowMore={side => { setExpandedSide(side); document.getElementById('relationship-list')?.scrollIntoView({ behavior: 'smooth' }); }} />
        <p className="visualization-note">Стрелки показывают направление прямого перевода. Входящие и исходящие суммы не образуют баланс и не доказывают дальнейший путь конкретных денег.</p>
      </section>
      <section className="relationship-list-panel" id="relationship-list"><div className="relationship-list-heading"><div><h3>Прямые связи клиента</h3><p>Пять крупнейших контрагентов по сумме с каждой стороны. Остальных можно раскрыть. Выберите клиента, чтобы перестроить схему.</p></div><span>{node.in_deg + node.out_deg} {plural(node.in_deg + node.out_deg, 'связь', 'связи', 'связей')}</span></div><FlowGraph data={data} node={node} onSelect={onSelectClient} expandSide={expandedSide} /></section>
      <NeighborhoodGraph data={data} node={node} hops={hops} onHopsChange={onHopsChange} onSelectClient={onSelectClient} />
    </>}
  </>;
}
