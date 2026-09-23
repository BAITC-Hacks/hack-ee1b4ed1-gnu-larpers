import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Download, Network } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import SidebarNav from './SidebarNav';
import { AppLoading } from './AppLoading';
import ClientCommandDialog from './ClientCommandDialog';
import { graphQueryOptions } from './queries/graph';
import type { GraphData } from './types';
import { dateLabel } from './format';
import ReportPage from './pages/ReportPage';
import VisualizationPage from './pages/VisualizationPage';
import InvestigationPage from './pages/InvestigationPage';
import GroupsPage from './pages/GroupsPage';
import MethodologyPage from './pages/MethodologyPage';
import ClientsTablePage from './pages/ClientsTablePage';

function Workspace({ data }: { data: GraphData }) {
  const [selectedGid, setSelectedGid] = useState(data.top_nodes[0]?.gid ?? data.nodes[0].gid);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth <= 800);
  const [view, setView] = useState<'report' | 'visualization' | 'explore' | 'clusters' | 'table' | 'method'>('report');
  const [visualizationMode, setVisualizationMode] = useState<'overview' | 'client'>('overview');
  const [exportsOpen, setExportsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandGroupId, setCommandGroupId] = useState<number | null>(null);
  useEffect(() => { window.scrollTo(0, 0); }, [view]);
  const nodeById = useMemo(() => new Map(data.nodes.map(node => [node.gid, node])), [data]);
  const selected = nodeById.get(selectedGid)!;
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExportsOpen(false); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  const selectNode = (gid: string, destination: 'visualization' | 'explore' = 'visualization') => {
    const node = nodeById.get(gid);
    if (!node) return;
    setSelectedGid(gid);
    if (destination === 'visualization') setVisualizationMode('client');
    setView(destination);
    setCommandOpen(false);
    window.scrollTo(0, 0);
  };
  const openClientCommand = (groupId: number | null = null) => { setCommandGroupId(groupId); setCommandOpen(true); if (window.innerWidth <= 800) setSidebarCollapsed(true); };
  const openCluster = (_id: number, gid: string) => { setSelectedGid(gid); setVisualizationMode('client'); setView('visualization'); };
  return <div className="app-shell">
    <SidebarNav view={view} onNavigate={next => { setView(next); if (next === 'visualization') setVisualizationMode('overview'); if (window.innerWidth <= 800) setSidebarCollapsed(true); }} onBrowseClients={() => openClientCommand()} commandOpen={commandOpen} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(value => !value)} />
    {!sidebarCollapsed && <button className="sidebar-scrim" aria-label="Закрыть боковую панель" onClick={() => setSidebarCollapsed(true)} />}
    <ClientCommandDialog data={data} open={commandOpen} onOpenChange={setCommandOpen} currentGid={selectedGid} initialClusterId={commandGroupId} onSelect={gid => selectNode(gid, view === 'explore' ? 'explore' : 'visualization')} />
    <div className={`page-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <main>
        <div className="page-heading"><div><div className="eyebrow">Внутрибанковские переводы / {data.metadata.date_from?.slice(0, 4) ?? ''}</div><h1>{view === 'report' ? 'Аналитический отчёт' : view === 'visualization' ? 'Визуализация' : view === 'explore' ? 'Исследование клиента' : view === 'clusters' ? 'Группы клиентов' : view === 'table' ? 'Таблица клиентов' : 'Как устроен анализ'}</h1><p>Период: {dateLabel(data.metadata.date_from)} — {dateLabel(data.metadata.date_to)} {data.metadata.date_to?.slice(0, 4)}</p></div><div className="export-container"><button className="export-button" onClick={() => setExportsOpen(open => !open)} aria-expanded={exportsOpen}><Download size={16} />Скачать данные<ChevronDown size={14} /></button>{exportsOpen && <><button className="menu-backdrop" aria-label="Закрыть меню экспорта" onClick={() => setExportsOpen(false)} /><div className="export-menu">{[['nodes_roles.csv', 'Роли всех клиентов · CSV'], ['clusters.csv', 'Группы клиентов · CSV'], ['top_nodes.csv', 'Приоритетные клиенты · CSV'], ['graph.json', 'Полный граф · JSON']].map(([file, label]) => <a key={file} href={`/generated/${file}`} download onClick={() => setExportsOpen(false)}><Download size={14} />{label}</a>)}</div></>}</div></div>
        {view === 'report' && <ReportPage data={data} onSelect={selectNode} onCluster={openCluster} onMethod={() => setView('method')} />}
        {view === 'visualization' && <VisualizationPage data={data} node={selected} mode={visualizationMode} onModeChange={setVisualizationMode} onSelectClient={gid => selectNode(gid, 'visualization')} onBrowseClients={() => openClientCommand()} onBrowseGroup={id => openClientCommand(id)} onOpenProfile={() => setView('explore')} />}
        {view === 'explore' && <InvestigationPage data={data} node={selected} onSelectClient={gid => selectNode(gid, 'explore')} onBrowseClients={() => openClientCommand()} onOpenMethod={() => setView('method')} />}
        {view === 'clusters' && <GroupsPage data={data} onOpenCluster={openCluster} />}
        {view === 'table' && <ClientsTablePage data={data} onOpenClient={gid => selectNode(gid, 'explore')} />}
        {view === 'method' && <MethodologyPage data={data} />}
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
