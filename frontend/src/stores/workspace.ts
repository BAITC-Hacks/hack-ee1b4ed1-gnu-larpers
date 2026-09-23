import { createStore } from 'zustand/vanilla';
import type { GraphData, Role } from '../types';

interface WorkspaceState {
  selectedGid: string;
  query: string;
  role: Role | 'all';
  clusterId: number | null;
  scope: 1 | 2 | 'all';
  view: 'explore' | 'clusters' | 'method';
  listLimit: number;
  setQuery: (query: string) => void;
  setRole: (role: Role | 'all') => void;
  setClusterId: (clusterId: number | null) => void;
  setScope: (scope: WorkspaceState['scope']) => void;
  setView: (view: WorkspaceState['view']) => void;
  showMore: () => void;
  selectNode: (gid: string) => void;
  reset: () => void;
  openCluster: (id: number, gid: string) => void;
}

export function createWorkspaceStore(data: GraphData) {
  const nodeById = new Map(data.nodes.map(node => [node.gid, node]));

  return createStore<WorkspaceState>()((set) => ({
    selectedGid: data.top_nodes[0]?.gid ?? data.nodes[0].gid,
    query: '',
    role: 'all',
    clusterId: null,
    scope: 1,
    view: 'explore',
    listLimit: 50,
    setQuery: query => set(state => state.query === query ? state : { query, listLimit: 50 }),
    setRole: role => set(state => state.role === role ? state : { role, listLimit: 50 }),
    setClusterId: clusterId => set(state => state.clusterId === clusterId ? state : { clusterId, listLimit: 50 }),
    setScope: scope => set({ scope }),
    setView: view => set({ view }),
    showMore: () => set(state => ({ listLimit: state.listLimit + 50 })),
    selectNode: gid => {
      const node = nodeById.get(gid);
      if (!node) return;
      set(state => {
        const clusterId = state.clusterId !== null && state.clusterId !== node.cluster_id ? null : state.clusterId;
        const role = state.role !== 'all' && state.role !== node.role ? 'all' : state.role;
        const query = state.query && !gid.includes(state.query.trim()) ? '' : state.query;
        const filtersChanged = clusterId !== state.clusterId || role !== state.role || query !== state.query;
        return { selectedGid: gid, view: 'explore', clusterId, role, query, listLimit: filtersChanged ? 50 : state.listLimit };
      });
    },
    reset: () => set(state => ({
      query: '', role: 'all', clusterId: null,
      listLimit: state.query || state.role !== 'all' || state.clusterId !== null ? 50 : state.listLimit,
    })),
    openCluster: (id, gid) => {
      if (nodeById.get(gid)?.cluster_id !== id) return;
      set(state => ({
        selectedGid: gid, clusterId: id, role: 'all', query: '', scope: 'all', view: 'explore',
        listLimit: state.clusterId !== id || state.role !== 'all' || state.query ? 50 : state.listLimit,
      }));
    },
  }));
}

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;
