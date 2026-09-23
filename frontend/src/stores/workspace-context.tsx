import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter, useRouterState } from '@tanstack/react-router';
import { useStore } from 'zustand';
import type { GraphData } from '../types';
import { createWorkspaceStore, workspaceFromSearch, workspaceSearch, type WorkspaceStore } from './workspace';

const WorkspaceContext = createContext<WorkspaceStore | null>(null);

export function WorkspaceProvider({ data, children }: { data: GraphData; children: ReactNode }) {
  const router = useRouter();
  const search = useRouterState({ select: state => state.location.searchStr });
  const [store] = useState(() => createWorkspaceStore(data, workspaceFromSearch(data, search)));
  useEffect(() => {
    const next = workspaceFromSearch(data, search);
    const current = workspaceSearch(data, store.getState());
    if (JSON.stringify(workspaceSearch(data, next)) !== JSON.stringify(current)) store.getState().restore(next);
  }, [data, search, store]);
  useEffect(() => store.subscribe((state, previous) => {
    const next = workspaceSearch(data, state);
    if (JSON.stringify(next) === JSON.stringify(workspaceSearch(data, previous))) return;
    if (JSON.stringify(next) === JSON.stringify(workspaceSearch(data, workspaceFromSearch(data, router.state.location.searchStr)))) return;
    const replace = state.selectedGid === previous.selectedGid && state.view === previous.view && state.visualizationMode === previous.visualizationMode && state.clusterId === previous.clusterId;
    void router.navigate({ to: '/', search: next, replace, resetScroll: false });
  }), [data, router, store]);
  return <WorkspaceContext.Provider value={store}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceStore() {
  const store = useContext(WorkspaceContext);
  if (!store) throw new Error('WorkspaceProvider is missing.');
  return useStore(store);
}
