import { createStore } from 'zustand/vanilla';
import { roles, type GraphData, type Role } from '../types';

export type WorkspaceView = 'report' | 'visualization' | 'explore' | 'clusters' | 'table' | 'method';
export type VisualizationMode = 'overview' | 'cluster' | 'client';
export type Direction = 'all' | 'in' | 'out';

export interface WorkspaceSnapshot {
  selectedGid: string;
  query: string;
  role: Role | 'all';
  clusterId: number | null;
  hops: 1 | 2;
  view: WorkspaceView;
  visualizationMode: VisualizationMode;
  includeExternal: boolean;
  from: string;
  to: string;
  direction: Direction;
  highlightedPaths: string[][];
}

export function analysisIdentity(data: GraphData): string {
  return data.metadata.analysis_id ?? JSON.stringify([data.metadata.dataset_sha256 ?? data.metadata, data.metadata.parameters]);
}

export function normalizeWorkspace(data: GraphData, value: unknown): WorkspaceSnapshot {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const nodeIds = new Set(data.nodes.map(node => node.gid));
  const clusters = new Set(data.clusters.map(cluster => cluster.cluster_id));
  const validDate = (value: unknown, fallback: string) => {
    if (value === '') return '';
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
    const time = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? value : fallback;
  };
  const clusterId = typeof raw.clusterId === 'number' && clusters.has(raw.clusterId) ? raw.clusterId : null;
  const selectedGid = typeof raw.selectedGid === 'string' && nodeIds.has(raw.selectedGid)
    ? raw.selectedGid : data.top_nodes[0]?.gid ?? data.nodes[0].gid;
  const mode = typeof raw.visualizationMode === 'string' && ['overview', 'cluster', 'client'].includes(raw.visualizationMode) ? raw.visualizationMode as VisualizationMode : 'overview';
  const edges = new Set(data.edges.map(edge => `${edge.src}->${edge.dst}`));
  const paths = Array.isArray(raw.highlightedPaths) ? raw.highlightedPaths.slice(0, 16).filter((path): path is string[] =>
    Array.isArray(path) && path.length > 0 && path.length <= 128 && path.every((gid, i) => typeof gid === 'string' && nodeIds.has(gid) && (!i || edges.has(`${path[i - 1]}->${gid}`)))) : [];
  return {
    selectedGid,
    query: typeof raw.query === 'string' ? raw.query.slice(0, 500) : '',
    role: typeof raw.role === 'string' && Object.hasOwn(roles, raw.role) ? raw.role as Role : 'all',
    clusterId,
    hops: raw.hops === 2 ? 2 : 1,
    view: typeof raw.view === 'string' && ['report', 'visualization', 'explore', 'clusters', 'table', 'method'].includes(raw.view) ? raw.view as WorkspaceView : 'report',
    visualizationMode: mode === 'cluster' && clusterId === null ? 'overview' : mode,
    includeExternal: raw.includeExternal === true,
    from: validDate(raw.from, data.metadata.date_from ?? ''),
    to: validDate(raw.to, data.metadata.date_to ?? ''),
    direction: raw.direction === 'in' || raw.direction === 'out' ? raw.direction : 'all',
    highlightedPaths: paths,
  };
}

export function workspaceFromSearch(data: GraphData, search: string): WorkspaceSnapshot {
  const params = new URLSearchParams(search);
  if (params.has('analysis') && params.get('analysis') !== analysisIdentity(data)) return normalizeWorkspace(data, {});
  return normalizeWorkspace(data, {
    selectedGid: params.get('client'), query: params.get('q'), role: params.get('role'),
    clusterId: params.has('group') ? Number(params.get('group')) : null,
    hops: Number(params.get('hops')), view: params.get('view'), visualizationMode: params.get('mode'),
    includeExternal: params.get('external') === '1', from: params.get('from'), to: params.get('to'), direction: params.get('direction'),
  });
}

export function workspaceSearch(data: GraphData, state: WorkspaceSnapshot): Record<string, string> {
  const search: Record<string, string> = {
    analysis: analysisIdentity(data), view: state.view, client: state.selectedGid, mode: state.visualizationMode,
    hops: String(state.hops), from: state.from, to: state.to, direction: state.direction,
  };
  if (state.clusterId !== null) search.group = String(state.clusterId);
  if (state.query) search.q = state.query;
  if (state.role !== 'all') search.role = state.role;
  if (state.includeExternal) search.external = '1';
  return search;
}

export function workspaceSnapshot(state: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    selectedGid: state.selectedGid, query: state.query, role: state.role, clusterId: state.clusterId,
    hops: state.hops, view: state.view, visualizationMode: state.visualizationMode,
    includeExternal: state.includeExternal, from: state.from, to: state.to, direction: state.direction,
    highlightedPaths: state.highlightedPaths.map(path => [...path]),
  };
}

interface WorkspaceState extends WorkspaceSnapshot {
  listLimit: number;
  setQuery: (query: string) => void;
  setRole: (role: Role | 'all') => void;
  setClusterId: (clusterId: number | null) => void;
  setHops: (hops: 1 | 2) => void;
  setView: (view: WorkspaceView) => void;
  setVisualizationMode: (mode: VisualizationMode) => void;
  setIncludeExternal: (value: boolean) => void;
  setFrom: (from: string) => void;
  setTo: (to: string) => void;
  setDirection: (direction: Direction) => void;
  showMore: () => void;
  selectNode: (gid: string, destination?: 'visualization' | 'explore', preserveGroup?: boolean) => void;
  reset: () => void;
  openCluster: (id: number, gid?: string) => void;
  openTransactions: (gid: string, from: string | null, to: string | null, direction: Direction) => void;
  setHighlightedPaths: (paths: string[][]) => void;
  restore: (snapshot: WorkspaceSnapshot) => void;
}

export function createWorkspaceStore(data: GraphData, initial?: WorkspaceSnapshot) {
  const nodeById = new Map(data.nodes.map(node => [node.gid, node]));
  return createStore<WorkspaceState>()((set) => ({
    ...normalizeWorkspace(data, initial),
    listLimit: 50,
    setQuery: query => set(state => state.query === query ? state : { query, listLimit: 50 }),
    setRole: role => set(state => state.role === role ? state : { role, listLimit: 50 }),
    setClusterId: clusterId => set(state => state.clusterId === clusterId ? state : { clusterId, listLimit: 50 }),
    setHops: hops => set({ hops }),
    setView: view => set(state => ({ view, highlightedPaths: [], visualizationMode: view === 'visualization' ? 'overview' : state.visualizationMode })),
    setVisualizationMode: visualizationMode => set(state => ({ visualizationMode, highlightedPaths: [], clusterId: visualizationMode === 'cluster' ? state.clusterId ?? nodeById.get(state.selectedGid)!.cluster_id : state.clusterId })),
    setIncludeExternal: includeExternal => set({ includeExternal }),
    setFrom: from => set({ from }),
    setTo: to => set({ to }),
    setDirection: direction => set({ direction }),
    showMore: () => set(state => ({ listLimit: state.listLimit + 50 })),
    selectNode: (gid, destination = 'visualization', preserveGroup = false) => {
      const node = nodeById.get(gid);
      if (!node) return;
      set(state => {
        const clusterId = !preserveGroup && state.clusterId !== null && state.clusterId !== node.cluster_id ? null : state.clusterId;
        const role = state.role !== 'all' && state.role !== node.role ? 'all' : state.role;
        const query = state.query && !gid.includes(state.query.trim()) ? '' : state.query;
        const filtersChanged = clusterId !== state.clusterId || role !== state.role || query !== state.query;
        return { selectedGid: gid, view: destination, visualizationMode: 'client', highlightedPaths: [], clusterId, role, query, listLimit: filtersChanged ? 50 : state.listLimit };
      });
    },
    reset: () => set(state => ({ query: '', role: 'all', clusterId: null, listLimit: state.query || state.role !== 'all' || state.clusterId !== null ? 50 : state.listLimit })),
    openCluster: (id, gid) => {
      const selectedGid = gid ?? data.clusters.find(cluster => cluster.cluster_id === id)?.top_gids[0];
      if (!selectedGid || nodeById.get(selectedGid)?.cluster_id !== id) return;
      set({ selectedGid, clusterId: id, role: 'all', query: '', visualizationMode: 'cluster', view: 'visualization', listLimit: 50, highlightedPaths: [] });
    },
    openTransactions: (gid, from, to, direction) => {
      if (!nodeById.has(gid)) return;
      set({ selectedGid: gid, from: from ?? data.metadata.date_from ?? '', to: to ?? data.metadata.date_to ?? '', direction, view: 'explore', highlightedPaths: [], query: '', role: 'all', clusterId: null });
    },
    setHighlightedPaths: highlightedPaths => set({ highlightedPaths }),
    restore: snapshot => set(state => {
      const next = normalizeWorkspace(data, snapshot);
      return JSON.stringify(workspaceSnapshot(state)) === JSON.stringify(next) ? state : { ...next, listLimit: 50 };
    }),
  }));
}

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;
