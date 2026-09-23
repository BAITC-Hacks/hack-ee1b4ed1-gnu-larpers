import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Download, Network } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import SidebarNav from './SidebarNav';
import AgentPanel from './AgentPanel';
import type { EvidenceAction, EvidenceCard } from './agent';
import CaseNotebook from './CaseNotebook';
import { WorkspaceProvider, useWorkspaceStore } from './stores/workspace-context';
import { analysisIdentity } from './stores/workspace';
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
  const workspace = useWorkspaceStore();
  const { selectedGid, role, clusterId, view, visualizationMode, from, to, direction,
    highlightedPaths, hops, includeExternal, setView, setVisualizationMode,
    setFrom, setTo, setDirection, setHighlightedPaths, openCluster, setHops, setIncludeExternal } = workspace;
  const [pendingEvidence, setPendingEvidence] = useState<EvidenceCard | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.innerWidth <= 800);
  const [mobileNavigation, setMobileNavigation] = useState(() => window.innerWidth <= 800);
  const [exportsOpen, setExportsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandGroupId, setCommandGroupId] = useState<number | null>(null);
  const [transactionFocus, setTransactionFocus] = useState(0);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 800px)');
    const update = () => { setMobileNavigation(media.matches); setSidebarCollapsed(media.matches); };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [view]);
  useEffect(() => { if (transactionFocus) document.getElementById('client-transactions')?.scrollIntoView({ behavior: 'smooth' }); }, [transactionFocus]);
  useEffect(() => {
    if (!(mobileNavigation && !sidebarCollapsed)) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [mobileNavigation, sidebarCollapsed]);
  const nodeById = useMemo(() => new Map(data.nodes.map(node => [node.gid, node])), [data]);
  const selected = nodeById.get(selectedGid)!;
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setExportsOpen(false); if (window.innerWidth <= 800) setSidebarCollapsed(true); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  const selectNode = (gid: string, destination: 'visualization' | 'explore' = 'visualization', preserveGroup = false) => {
    workspace.selectNode(gid, destination, preserveGroup);
    setCommandOpen(false);
    window.scrollTo(0, 0);
  };
  const openClientCommand = (groupId: number | null = null) => {
    setCommandGroupId(groupId);
    setCommandOpen(true);
    if (window.innerWidth <= 800) setSidebarCollapsed(true);
  };
  const applyAgentAction = (action: EvidenceAction) => {
    if (action.type === 'node') selectNode(action.gid);
    if (action.type === 'cluster') {
      const cluster = data.clusters.find(item => item.cluster_id === action.clusterId);
      if (!cluster?.top_gids.length) return;
      openCluster(cluster.cluster_id, cluster.top_gids[0]);
    }
    if (action.type === 'paths') {
      const gid = action.paths[0]?.at(-1);
      if (!gid) return;
      selectNode(gid);
      setHighlightedPaths(action.paths);
    }
    if (action.type === 'transactions') {
      workspace.openTransactions(action.gid, action.from, action.to, action.direction);
      setCommandOpen(false);
      setTransactionFocus(value => value + 1);
    }
  };
  return <div className="app-shell">
    <AgentPanel key={data.metadata.analysis_id} data={data} selectedGid={selectedGid} clusterId={clusterId} role={role} direction={direction} from={from} to={to} onAction={applyAgentAction} onSaveEvidence={setPendingEvidence} />
    <SidebarNav view={view} onNavigate={next => { setView(next); if (window.innerWidth <= 800) setSidebarCollapsed(true); }} onBrowseClients={() => openClientCommand()} commandOpen={commandOpen} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(value => !value)} />
    {!sidebarCollapsed && <button className="sidebar-scrim" aria-label="Закрыть боковую панель" onClick={() => setSidebarCollapsed(true)} />}
    <ClientCommandDialog data={data} open={commandOpen} onOpenChange={setCommandOpen} currentGid={selectedGid} initialClusterId={commandGroupId} onSelect={gid => selectNode(gid, view === 'explore' ? 'explore' : 'visualization')} />
    <div className={`page-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <main>
        <div className="page-heading"><div><div className="eyebrow">Внутрибанковские переводы / {data.metadata.date_from?.slice(0, 4) ?? ''}</div><h1>{view === 'report' ? 'Аналитический отчёт' : view === 'visualization' ? 'Визуализация' : view === 'explore' ? 'Исследование клиента' : view === 'clusters' ? 'Группы клиентов' : view === 'table' ? 'Таблица клиентов' : 'Как устроен анализ'}</h1><p>Период: {dateLabel(data.metadata.date_from)} — {dateLabel(data.metadata.date_to)} {data.metadata.date_to?.slice(0, 4)}</p></div><div className="export-container"><button className="export-button" onClick={() => setExportsOpen(open => !open)} aria-expanded={exportsOpen}><Download size={16} />Скачать данные<ChevronDown size={14} /></button>{exportsOpen && <><button className="menu-backdrop" aria-label="Закрыть меню экспорта" onClick={() => setExportsOpen(false)} /><div className="export-menu">{[['nodes_roles.csv', 'Роли всех клиентов · CSV'], ['clusters.csv', 'Группы клиентов · CSV'], ['top_nodes.csv', 'Приоритетные клиенты · CSV'], ['graph.json', 'Полный граф · JSON']].map(([file, label]) => <a key={file} href={`/generated/${file}`} download onClick={() => setExportsOpen(false)}><Download size={14} />{label}</a>)}</div></>}</div></div>
        <CaseNotebook data={data} snapshot={workspace} pendingEvidence={pendingEvidence} onEvidenceSaved={() => setPendingEvidence(null)} onRestore={workspace.restore} onAction={applyAgentAction} />
        {view === 'report' && <ReportPage data={data} onSelect={selectNode} onCluster={openCluster} onMethod={() => setView('method')} />}
        {view === 'visualization' && <VisualizationPage data={data} node={selected} mode={visualizationMode} clusterId={clusterId} hops={hops} includeExternal={includeExternal} onHopsChange={setHops} onIncludeExternalChange={setIncludeExternal} onOpenCluster={id => openCluster(id)} onModeChange={mode => { setHighlightedPaths([]); setVisualizationMode(mode); }} onSelectClient={gid => selectNode(gid, 'visualization', true)} onBrowseClients={() => openClientCommand()} onBrowseGroup={id => openClientCommand(id)} onOpenProfile={() => setView('explore')} evidencePaths={highlightedPaths} onClearPaths={() => setHighlightedPaths([])} />}
        {view === 'explore' && <InvestigationPage data={data} node={selected} onSelectClient={gid => selectNode(gid, 'explore')} onBrowseClients={() => openClientCommand()} onOpenMethod={() => setView('method')} from={from} to={to} direction={direction} setFrom={setFrom} setTo={setTo} setDirection={setDirection} />}
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
  return <WorkspaceProvider key={analysisIdentity(data)} data={data}><Workspace data={data} /></WorkspaceProvider>;
}
