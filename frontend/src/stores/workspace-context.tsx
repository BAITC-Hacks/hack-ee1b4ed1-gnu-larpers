import { createContext, useContext, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { GraphData } from '../types';
import { createWorkspaceStore, type WorkspaceStore } from './workspace';

const WorkspaceContext = createContext<WorkspaceStore | null>(null);

export function WorkspaceProvider({ data, children }: { data: GraphData; children: ReactNode }) {
  const [store] = useState(() => createWorkspaceStore(data));
  return <WorkspaceContext.Provider value={store}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceStore() {
  const store = useContext(WorkspaceContext);
  if (!store) throw new Error('WorkspaceProvider is missing.');
  return useStore(store);
}
