import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Download, Network, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import SidebarNav from './SidebarNav';
import { filterNodes } from './data';
import { AppLoading } from './AppLoading';
import { graphQueryOptions } from './queries/graph';
import { roles, type GraphData, type Role } from './types';
import { dateLabel, number, plural } from './format';
import ReportPage from './pages/ReportPage';
import VisualizationPage from './pages/VisualizationPage';
import InvestigationPage from './pages/InvestigationPage';
import GroupsPage from './pages/GroupsPage';
import MethodologyPage from './pages/MethodologyPage';

function Workspace({ data }: { data: GraphData }) {
  const [selectedGid, setSelectedGid] = useState(data.top_nodes[0]?.gid ?? data.nodes[0].gid);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<Role | 'all'>('all');
  const [clusterId, setClusterId] = useState<number | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth <= 800);
  const [mobileNavigation, setMobileNavigation] = useState(() => window.innerWidth <= 800);
  const [view, setView] = useState<'report' | 'visualization' | 'explore' | 'clusters' | 'method'>('report');
  const [visualizationMode, setVisualizationMode] = useState<'overview' | 'client'>('overview');
  const [exportsOpen, setExportsOpen] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [listLimit, setListLimit] = useState(50);
  const directorySearchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 800px)');
    const update = () => { setMobileNavigation(media.matches); setSidebarCollapsed(media.matches); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [view]);
  useEffect(() => { if (directoryOpen) directorySearchRef.current?.focus(); }, [directoryOpen]);
  useEffect(() => {
    if (!directoryOpen && !(mobileNavigation && !sidebarCollapsed)) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [directoryOpen, mobileNavigation, sidebarCollapsed]);
  const nodeById = useMemo(() => new Map(data.nodes.map(node => [node.gid, node])), [data]);
  const selected = nodeById.get(selectedGid)!;
  const filtered = useMemo(() => filterNodes(data, query, role, clusterId), [data, query, role, clusterId]);
  useEffect(() => { setListLimit(50); }, [query, role, clusterId]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setExportsOpen(false); setDirectoryOpen(false); if (window.innerWidth <= 800) setSidebarCollapsed(true); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  const selectNode = (gid: string, destination: 'visualization' | 'explore' = 'visualization') => {
    const node = nodeById.get(gid);
    if (!node) return;
    setSelectedGid(gid);
    if (destination === 'visualization') setVisualizationMode('client');
    setView(destination);
    setDirectoryOpen(false);
    window.scrollTo(0, 0);
    if (clusterId !== null && clusterId !== node.cluster_id) setClusterId(null);
    if (role !== 'all' && role !== node.role) setRole('all');
    if (query && !gid.includes(query.trim())) setQuery('');
  };
  const reset = () => { setQuery(''); setRole('all'); setClusterId(null); };
  const openCluster = (id: number, gid: string) => { setSelectedGid(gid); setClusterId(id); setRole('all'); setQuery(''); setVisualizationMode('client'); setView('visualization'); };
  return <div className="app-shell">
    <SidebarNav view={view} onNavigate={next => { setView(next); if (next === 'visualization') setVisualizationMode('overview'); if (window.innerWidth <= 800) setSidebarCollapsed(true); }} data={data} selectedGid={selectedGid} onPickClient={gid => { selectNode(gid); if (window.innerWidth <= 800) setSidebarCollapsed(true); }} onBrowseClients={() => { setDirectoryOpen(true); if (window.innerWidth <= 800) setSidebarCollapsed(true); }} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(value => !value)} />
    {!sidebarCollapsed && <button className="sidebar-scrim" aria-label="Закрыть боковую панель" onClick={() => setSidebarCollapsed(true)} />}
    {directoryOpen && <div className="directory-layer" role="presentation">
      <button className="directory-backdrop" aria-label="Закрыть каталог клиентов" onClick={() => setDirectoryOpen(false)} />
      <section className="directory-panel" role="dialog" aria-modal="true" aria-label="Каталог клиентов">
        <div className="directory-heading"><div><h2>Выбрать клиента</h2><p>Поиск по всей выборке · {number.format(data.metadata.n_nodes)} клиентов</p></div><button className="directory-close" onClick={() => setDirectoryOpen(false)} aria-label="Закрыть каталог"><X size={18} /></button></div>
        <div className="directory-controls"><input ref={directorySearchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="Полный ID или его часть" aria-label="Поиск клиента по ID" /><select aria-label="Фильтр по роли" value={role} onChange={event => setRole(event.target.value as Role | 'all')}><option value="all">Все роли</option>{Object.entries(roles).map(([key, item]) => <option value={key} key={key}>{item.label}</option>)}</select><select aria-label="Фильтр по группе" value={clusterId ?? 'all'} onChange={event => setClusterId(event.target.value === 'all' ? null : Number(event.target.value))}><option value="all">Все группы</option>{data.clusters.map(cluster => <option key={cluster.cluster_id} value={cluster.cluster_id}>Группа {cluster.cluster_id + 1} · {cluster.n_nodes}</option>)}</select></div>
        <div className="directory-count"><span>{number.format(filtered.length)} {plural(filtered.length, 'клиент', 'клиента', 'клиентов')} · по приоритету</span>{(query || role !== 'all' || clusterId !== null) && <button onClick={reset}>Сбросить фильтры</button>}</div>
        <div className="directory-list">{filtered.slice(0, listLimit).map(node => <button className={`directory-row ${selectedGid === node.gid ? 'selected' : ''}`} key={node.gid} onClick={() => selectNode(node.gid, view === 'explore' ? 'explore' : 'visualization')}><span className="directory-row-main"><strong>{node.gid}</strong><small>{roles[node.role].label}{node.is_seed ? ' · исходный клиент' : ''}</small></span><span className="directory-group">Группа {node.cluster_id + 1}</span><span className="directory-priority">{node.priority_score.toFixed(3)}</span></button>)}{!filtered.length && <div className="directory-empty">Клиентов не найдено. Измените ID или сбросьте фильтры.</div>}{filtered.length > listLimit && <button className="directory-more" onClick={() => setListLimit(limit => limit + 50)}>Показать ещё 50</button>}</div>
      </section>
    </div>}
    <div className={`page-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <main>
        <div className="page-heading"><div><div className="eyebrow">Внутрибанковские переводы / {data.metadata.date_from?.slice(0, 4) ?? ''}</div><h1>{view === 'report' ? 'Аналитический отчёт' : view === 'visualization' ? 'Визуализация' : view === 'explore' ? 'Исследование клиента' : view === 'clusters' ? 'Группы клиентов' : 'Как устроен анализ'}</h1><p>Период: {dateLabel(data.metadata.date_from)} — {dateLabel(data.metadata.date_to)} {data.metadata.date_to?.slice(0, 4)}</p></div><div className="export-container"><button className="export-button" onClick={() => setExportsOpen(open => !open)} aria-expanded={exportsOpen}><Download size={16} />Скачать данные<ChevronDown size={14} /></button>{exportsOpen && <><button className="menu-backdrop" aria-label="Закрыть меню экспорта" onClick={() => setExportsOpen(false)} /><div className="export-menu">{[['nodes_roles.csv', 'Роли всех клиентов · CSV'], ['clusters.csv', 'Группы клиентов · CSV'], ['top_nodes.csv', 'Приоритетные клиенты · CSV'], ['graph.json', 'Полный граф · JSON']].map(([file, label]) => <a key={file} href={`/generated/${file}`} download onClick={() => setExportsOpen(false)}><Download size={14} />{label}</a>)}</div></>}</div></div>
        {view === 'report' && <ReportPage data={data} onSelect={selectNode} onCluster={openCluster} onMethod={() => setView('method')} />}
        {view === 'visualization' && <VisualizationPage data={data} node={selected} mode={visualizationMode} onModeChange={setVisualizationMode} onSelectClient={gid => selectNode(gid, 'visualization')} onBrowseClients={() => setDirectoryOpen(true)} onBrowseGroup={id => { setClusterId(id); setRole('all'); setQuery(''); setDirectoryOpen(true); }} onOpenProfile={() => setView('explore')} />}
        {view === 'explore' && <InvestigationPage data={data} node={selected} onSelectClient={gid => selectNode(gid, 'explore')} onBrowseClients={() => setDirectoryOpen(true)} onOpenMethod={() => setView('method')} />}
        {view === 'clusters' && <GroupsPage data={data} onOpenCluster={openCluster} />}
        {view === 'method' && <MethodologyPage data={data} />}
        <footer className="page-footer"><span><Network size={14} />Граф денег</span><span>Объяснимый анализ · Данные за июль 2026</span><span>Выводы описывают наблюдаемую выборку</span></footer>
      </main>
    </div>
  </div>;
}

export default function App() {
  const { data, error, refetch } = useQuery(graphQueryOptions);
  if (error) return <div className="app-state"><Network size={38} /><h1>Данные пока недоступны</h1><p>{error.message}</p><p>Подготовьте выгрузку командой <code>npm run data</code> в корне проекта.</p><button className="export-button" onClick={() => void refetch()}>Повторить загрузку</button></div>;
  if (!data) return <AppLoading />;
  return <Workspace data={data} />;
}
