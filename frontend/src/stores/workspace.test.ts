import { describe, expect, it, vi } from 'vitest';
import type { GraphData, NodeRow } from '../types';
import {
  analysisIdentity,
  createWorkspaceStore,
  normalizeWorkspace,
  workspaceFromSearch,
  workspaceSearch,
  workspaceSnapshot,
} from './workspace';

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

function fixture(gids: [string, string, string] = ['101', '102', '203']): GraphData {
  return {
    metadata: {
      analysis_id: 'analysis-current', dataset_sha256: 'dataset-current',
      schema_version: 1, n_nodes: 3, n_edges: 2, n_transactions: 2, n_clusters: 2,
      n_seed: 0, n_boundary: 0, n_isolated: 0, sum_minor: 20000,
      date_from: '2026-07-01', date_to: '2026-07-31', parameters: { window_days: 3, resolution: 1, random_seed: 42 },
    },
    nodes: [node(gids[0], 0, 'transit'), node(gids[1], 0, 'transit'), node(gids[2], 1, 'terminal')],
    edges: [
      { src: gids[0], dst: gids[1], sum_kzt: 100, sum_minor: 10000, n_tx: 1, depth: 1 },
      { src: gids[1], dst: gids[2], sum_kzt: 100, sum_minor: 10000, n_tx: 1, depth: 2 },
    ],
    clusters: [
      { cluster_id: 0, n_nodes: 2, n_seed: 0, sum_kzt_internal: 100, top_gids: [gids[1]], hypothesis: '' },
      { cluster_id: 1, n_nodes: 1, n_seed: 0, sum_kzt_internal: 0, top_gids: [gids[2]], hypothesis: '' },
    ],
    top_nodes: [{ rank: 1, gid: gids[1], role: 'transit', priority_score: 0.5, why: '' }],
    transactions: [
      { src: gids[0], dst: gids[1], date: '2026-07-05', sum_kzt: 100, sum_minor: 10000 },
      { src: gids[1], dst: gids[2], date: '2026-07-06', sum_kzt: 100, sum_minor: 10000 },
    ],
    daily_flows: [],
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
      selectedGid: '101', query: ' 10 ', role: 'transit', clusterId: 0, listLimit: 100,
      view: 'visualization', visualizationMode: 'client',
    });
  });

  it('clears incompatible filters atomically when navigating to a counterparty', () => {
    const store = createWorkspaceStore(fixture());
    const actions = store.getState();
    actions.setQuery('102');
    actions.setRole('transit');
    actions.setClusterId(0);
    actions.showMore();
    actions.setHops(2);
    actions.setHighlightedPaths([['101', '102', '203']]);
    const listener = vi.fn();
    store.subscribe(listener);
    actions.selectNode('203');
    expect(store.getState()).toMatchObject({
      selectedGid: '203', query: '', role: 'all', clusterId: null, listLimit: 50, hops: 2,
      view: 'visualization', visualizationMode: 'client', highlightedPaths: [],
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('never selects missing clients or a client outside the requested cluster', () => {
    const store = createWorkspaceStore(fixture());
    const initial = store.getState();
    initial.selectNode('404');
    initial.openCluster(0, '404');
    initial.openCluster(0, '203');
    initial.openCluster(999);
    initial.openTransactions('404', null, null, 'all');
    expect(store.getState()).toBe(initial);
  });

  it('resets pagination only when filters change and leaves graph selection and hops intact', () => {
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
    actions.setHops(2);
    actions.reset();
    expect(store.getState()).toMatchObject({
      selectedGid: '102', query: '', role: 'all', clusterId: null, listLimit: 50, hops: 2,
    });
  });

  it('opens a cluster atomically in visualization with its top client and cleared list filters', () => {
    const store = createWorkspaceStore(fixture());
    const actions = store.getState();
    actions.setQuery('101');
    actions.setRole('transit');
    actions.showMore();
    actions.setView('clusters');
    actions.setHighlightedPaths([['101', '102']]);
    const listener = vi.fn();
    store.subscribe(listener);
    actions.openCluster(1);
    expect(store.getState()).toMatchObject({
      selectedGid: '203', clusterId: 1, query: '', role: 'all', visualizationMode: 'cluster',
      view: 'visualization', listLimit: 50, highlightedPaths: [],
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('navigates group to client to dated operations and restores the group context', () => {
    const store = createWorkspaceStore(fixture());
    const actions = store.getState();
    actions.openCluster(0);
    actions.setIncludeExternal(true);
    actions.setHops(2);
    actions.selectNode('101');
    const clientContext = workspaceSnapshot(store.getState());
    expect(clientContext).toMatchObject({
      selectedGid: '101', clusterId: 0, view: 'visualization', visualizationMode: 'client',
    });
    const listener = vi.fn();
    store.subscribe(listener);
    actions.openTransactions('101', '2026-07-04', '2026-07-06', 'out');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({
      selectedGid: '101', view: 'explore', from: '2026-07-04', to: '2026-07-06', direction: 'out',
      query: '', role: 'all', clusterId: null, includeExternal: true, hops: 2,
    });
    actions.restore(clientContext);
    expect(workspaceSnapshot(store.getState())).toEqual(clientContext);
    actions.setVisualizationMode('cluster');
    expect(store.getState()).toMatchObject({
      clusterId: 0, visualizationMode: 'cluster', selectedGid: '101', view: 'visualization',
    });
  });

  it('can inspect an external counterparty while retaining the source group for returning', () => {
    const store = createWorkspaceStore(fixture());
    const actions = store.getState();
    actions.openCluster(0);
    actions.setIncludeExternal(true);
    actions.selectNode('203', 'visualization', true);
    expect(store.getState()).toMatchObject({
      selectedGid: '203', clusterId: 0, visualizationMode: 'client', includeExternal: true,
    });
    actions.setVisualizationMode('cluster');
    expect(store.getState()).toMatchObject({ clusterId: 0, visualizationMode: 'cluster' });
  });

  it('supports direct client exploration and defaults transaction dates to the dataset period', () => {
    const store = createWorkspaceStore(fixture());
    const actions = store.getState();
    actions.selectNode('203', 'explore');
    expect(store.getState()).toMatchObject({ selectedGid: '203', view: 'explore', visualizationMode: 'client' });
    actions.setFrom('2026-07-10');
    actions.setTo('2026-07-20');
    actions.setDirection('in');
    expect(store.getState()).toMatchObject({ from: '2026-07-10', to: '2026-07-20', direction: 'in' });
    actions.openTransactions('102', null, null, 'all');
    expect(store.getState()).toMatchObject({
      selectedGid: '102', from: '2026-07-01', to: '2026-07-31', direction: 'all', view: 'explore',
    });
  });

  it('takes independent serializable snapshots and restores all state in one notification', () => {
    const data = fixture();
    const source = createWorkspaceStore(data);
    source.getState().openCluster(0);
    source.getState().setHighlightedPaths([['101', '102', '203']]);
    const saved = workspaceSnapshot(source.getState());
    expect(Object.values(saved).some(value => typeof value === 'function')).toBe(false);
    expect(saved).not.toHaveProperty('listLimit');
    saved.highlightedPaths[0].pop();
    expect(source.getState().highlightedPaths).toEqual([['101', '102', '203']]);
    const destination = createWorkspaceStore(data);
    destination.getState().showMore();
    const listener = vi.fn();
    destination.subscribe(listener);
    destination.getState().restore(JSON.parse(JSON.stringify(saved)));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(workspaceSnapshot(destination.getState())).toEqual(saved);
    expect(destination.getState().listLimit).toBe(50);
    destination.getState().restore(saved);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('workspace URL and saved state', () => {
  it('round-trips adjacent large string identifiers and all URL filters without rounding', () => {
    const gids: [string, string, string] = [
      '100000000000000001', '100000000000000002', '100000000000000003',
    ];
    const data = fixture(gids);
    const state = normalizeWorkspace(data, {
      selectedGid: gids[0], query: 'сбор & перевод+100', role: 'transit', clusterId: 0,
      hops: 2, view: 'explore', visualizationMode: 'client', includeExternal: true,
      from: '2026-07-04', to: '2026-07-06', direction: 'out',
    });
    const search = workspaceSearch(data, state);
    expect(search.client).toBe(gids[0]);
    expect(Object.values(search).every(value => typeof value === 'string')).toBe(true);
    expect(workspaceFromSearch(data, `?${new URLSearchParams(search)}`)).toEqual(state);
    for (const gid of gids) {
      const restored = workspaceFromSearch(data, `?client=${gid}`);
      expect(restored.selectedGid).toBe(gid);
    }
  });

  it('ignores a complete URL workspace from another analysis even if its clients still exist', () => {
    const data = fixture();
    const saved = normalizeWorkspace(data, {
      selectedGid: '203', clusterId: 1, role: 'terminal', view: 'explore',
      from: '2026-07-20', to: '', direction: 'in', hops: 2, includeExternal: true,
    });
    const search = new URLSearchParams(workspaceSearch(data, saved));
    search.set('analysis', 'analysis-old');
    expect(workspaceFromSearch(data, search.toString())).toEqual(normalizeWorkspace(data, {}));
  });

  it('uses analysis identity and changes the legacy fallback when data or parameters change', () => {
    const data = fixture();
    expect(analysisIdentity(data)).toBe('analysis-current');
    const legacy = { ...data, metadata: { ...data.metadata, analysis_id: undefined } };
    const same = JSON.parse(JSON.stringify(legacy)) as GraphData;
    expect(analysisIdentity(legacy)).toBe(analysisIdentity(same));
    expect(analysisIdentity({ ...legacy, metadata: { ...legacy.metadata, dataset_sha256: 'different' } }))
      .not.toBe(analysisIdentity(legacy));
    const changedParameters = {
      ...legacy,
      metadata: { ...legacy.metadata, parameters: { ...legacy.metadata.parameters, resolution: 2 } },
    };
    expect(analysisIdentity(changedParameters)).not.toBe(analysisIdentity(legacy));
    const search = new URLSearchParams(workspaceSearch(legacy, normalizeWorkspace(legacy, { selectedGid: '203' })));
    expect(workspaceFromSearch(changedParameters, search.toString()).selectedGid).toBe('102');
  });

  it.each([undefined, null, false, 42, 'invalid'])('uses safe defaults for malformed saved state %s', raw => {
    const data = fixture();
    expect(normalizeWorkspace(data, raw)).toEqual(normalizeWorkspace(data, {}));
  });

  it('rejects unknown IDs, unsupported filters and invalid dates without inventing groups', () => {
    const data = fixture();
    const invalid = {
      selectedGid: '404', query: 123, role: 'constructor', clusterId: 999, hops: 3,
      view: 'admin', visualizationMode: 'cluster', includeExternal: 'true',
      from: '2026-02-30', to: '2026-07-01T12:00:00Z', direction: 'both', highlightedPaths: '101,102',
    };
    expect(normalizeWorkspace(data, invalid)).toEqual(normalizeWorkspace(data, {}));
    const search = '?client=404&group=NaN&hops=-2&view=admin&mode=cluster&role=constructor&external=true&from=invalid&to=2026-02-30&direction=both';
    expect(workspaceFromSearch(data, search)).toEqual(normalizeWorkspace(data, {}));
  });

  it('rejects arrays masquerading as valid navigation values in saved state', () => {
    const data = fixture();
    expect(normalizeWorkspace(data, { view: ['explore'], visualizationMode: ['client'] }))
      .toEqual(normalizeWorkspace(data, {}));
  });

  it('preserves valid calendar dates, open date bounds and bounded search text', () => {
    const data = fixture();
    const state = normalizeWorkspace(data, {
      from: '2024-02-29', to: '', query: 'я'.repeat(501),
    });
    expect(state).toMatchObject({ from: '2024-02-29', to: '', query: 'я'.repeat(500) });
    expect(workspaceFromSearch(data, new URLSearchParams(workspaceSearch(data, state)).toString()))
      .toEqual(state);
    expect(normalizeWorkspace(data, { from: '2026-02-29', to: '2026-13-01' }))
      .toMatchObject({ from: '2026-07-01', to: '2026-07-31' });
  });

  it('restores only directed paths with known string IDs and bounded lengths', () => {
    const data = fixture();
    const saved = normalizeWorkspace(data, {
      highlightedPaths: [
        ['101', '102', '203'], ['102'], ['203', '102'], ['101', '203'],
        ['404'], [101, '102'], [], null, '101', Array(129).fill('101'),
      ],
    });
    expect(saved.highlightedPaths).toEqual([['101', '102', '203'], ['102']]);
    expect(normalizeWorkspace(data, { highlightedPaths: Array.from({ length: 17 }, () => ['101']) })
      .highlightedPaths).toHaveLength(16);
    expect(createWorkspaceStore(data, saved).getState().highlightedPaths).toEqual(saved.highlightedPaths);
  });
});
