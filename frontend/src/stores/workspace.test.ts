import { describe, expect, it, vi } from 'vitest';
import type { GraphData, NodeRow } from '../types';
import { createWorkspaceStore } from './workspace';

function node(gid: string, cluster_id: number, role: NodeRow['role']): NodeRow {
  return {
    gid, cluster_id, role, depth: 1, is_seed: false, role_score: 0.5, priority_score: 0.5,
    evidence: '', role_status: '', flags: [], in_deg: 0, out_deg: 0, in_kzt: 0, out_kzt: 0,
    in_tx: 0, out_tx: 0, in_minor: 0, out_minor: 0, seed_sources: 0, active_days: 0,
    same_day_activity_days: 0, following_days_out_share: null, following_days_matched_minor: 0,
    window_days: 3, truncated_by_depth: false, cycle_component_size: 1, neighbor_clusters: 0,
    pass_through: null,
  };
}

function fixture(): GraphData {
  return {
    metadata: {
      schema_version: 1, n_nodes: 3, n_edges: 0, n_transactions: 0, n_clusters: 2,
      n_seed: 0, n_boundary: 0, n_isolated: 3, sum_minor: 0,
      date_from: null, date_to: null, parameters: { window_days: 3, resolution: 1, random_seed: 42 },
    },
    nodes: [node('101', 0, 'transit'), node('102', 0, 'transit'), node('203', 1, 'terminal')],
    edges: [],
    clusters: [
      { cluster_id: 0, n_nodes: 2, n_seed: 0, sum_kzt_internal: 0, top_gids: ['102'], hypothesis: '' },
      { cluster_id: 1, n_nodes: 1, n_seed: 0, sum_kzt_internal: 0, top_gids: ['203'], hypothesis: '' },
    ],
    top_nodes: [{ rank: 1, gid: '102', role: 'transit', priority_score: 0.5, why: '' }],
    transactions: [], daily_flows: [],
  };
}

describe('workspace state', () => {
  it('initializes from ranked nodes and isolates separate workspace instances', () => {
    const data = fixture();
    const first = createWorkspaceStore(data);
    const second = createWorkspaceStore(data);
    expect(first.getState().selectedGid).toBe('102');
    first.getState().selectNode('203');
    first.getState().setQuery('203');
    expect(second.getState()).toMatchObject({ selectedGid: '102', query: '' });
    expect(createWorkspaceStore({ ...data, top_nodes: [] }).getState().selectedGid).toBe('101');
  });

  it('keeps compatible filters and pagination when selecting another client', () => {
    const store = createWorkspaceStore(fixture());
    const actions = store.getState();
    actions.setQuery(' 10 ');
    actions.setRole('transit');
    actions.setClusterId(0);
    actions.showMore();
    actions.setView('clusters');
    actions.selectNode('101');
    expect(store.getState()).toMatchObject({
      selectedGid: '101', query: ' 10 ', role: 'transit', clusterId: 0, listLimit: 100, view: 'explore',
    });
  });

  it('clears incompatible filters atomically when navigating to a counterparty', () => {
    const store = createWorkspaceStore(fixture());
    const actions = store.getState();
    actions.setQuery('102');
    actions.setRole('transit');
    actions.setClusterId(0);
    actions.showMore();
    actions.setScope(2);
    const listener = vi.fn();
    store.subscribe(listener);
    actions.selectNode('203');
    expect(store.getState()).toMatchObject({
      selectedGid: '203', query: '', role: 'all', clusterId: null, listLimit: 50, scope: 2,
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('never selects missing clients or a client outside the requested cluster', () => {
    const store = createWorkspaceStore(fixture());
    const initial = store.getState();
    initial.selectNode('404');
    initial.openCluster(0, '404');
    initial.openCluster(0, '203');
    expect(store.getState()).toBe(initial);
  });

  it('resets pagination only when filters change and leaves graph selection and scope intact', () => {
    const store = createWorkspaceStore(fixture());
    const actions = store.getState();
    actions.showMore();
    actions.setQuery('');
    actions.setRole('all');
    actions.setClusterId(null);
    expect(store.getState().listLimit).toBe(100);
    actions.setQuery('10');
    expect(store.getState().listLimit).toBe(50);
    actions.showMore();
    actions.setRole('transit');
    expect(store.getState().listLimit).toBe(50);
    actions.showMore();
    actions.setClusterId(0);
    expect(store.getState().listLimit).toBe(50);
    actions.showMore();
    actions.setScope(2);
    actions.reset();
    expect(store.getState()).toMatchObject({
      selectedGid: '102', query: '', role: 'all', clusterId: null, listLimit: 50, scope: 2,
    });
  });

  it('opens a cluster in overview with its top client and cleared list filters', () => {
    const store = createWorkspaceStore(fixture());
    const actions = store.getState();
    actions.setQuery('101');
    actions.setRole('transit');
    actions.showMore();
    actions.setView('clusters');
    actions.openCluster(1, '203');
    expect(store.getState()).toMatchObject({
      selectedGid: '203', clusterId: 1, query: '', role: 'all', scope: 'all', view: 'explore', listLimit: 50,
    });
  });
});
