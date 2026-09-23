import { describe, expect, it } from 'vitest';
import { clientGraph, graphNeighborhood, groupGraph } from './network-model';
import type { EdgeRow, GraphData, NodeRow } from './types';

function node(gid: string, clusterId = 0): NodeRow {
  return {
    gid, cluster_id: clusterId, depth: 0, is_seed: false, role: 'peripheral',
    role_score: 0, priority_score: 0, evidence: '', role_status: '', flags: [],
    in_deg: 0, out_deg: 0, in_kzt: 0, out_kzt: 0, in_tx: 0, out_tx: 0,
    in_minor: 0, out_minor: 0, seed_sources: 0, active_days: 0,
    same_day_activity_days: 0, following_days_out_share: null,
    following_days_matched_minor: 0, window_days: 3, truncated_by_depth: false,
    cycle_component_size: 1, neighbor_clusters: 0, pass_through: null,
  };
}

function edge(src: string, dst: string, sumMinor: number, transfers = 1): EdgeRow {
  return { src, dst, sum_minor: sumMinor, sum_kzt: sumMinor / 100, n_tx: transfers, depth: 0 };
}

function graph(nodes: NodeRow[], edges: EdgeRow[], clusterIds: number[]): GraphData {
  return {
    metadata: {
      schema_version: 1, n_nodes: nodes.length, n_edges: edges.length,
      n_transactions: edges.reduce((sum, item) => sum + item.n_tx, 0),
      n_clusters: clusterIds.length, n_seed: 0, n_boundary: 0, n_isolated: 0,
      sum_minor: edges.reduce((sum, item) => sum + item.sum_minor, 0),
      date_from: null, date_to: null,
      parameters: { window_days: 3, resolution: 1, random_seed: 42 },
    },
    nodes, edges,
    clusters: clusterIds.map(cluster_id => ({
      cluster_id, n_nodes: nodes.filter(item => item.cluster_id === cluster_id).length,
      n_seed: 0, sum_kzt_internal: 0, top_gids: [], hypothesis: '',
    })),
    top_nodes: [], transactions: [], daily_flows: [],
  };
}

describe('network models', () => {
  it('retains every group and exactly aggregates directed external routes', () => {
    const data = graph(
      [node('a', 0), node('b', 0), node('c', 1), node('d', 2)],
      [edge('a', 'c', 101, 2), edge('b', 'c', 202, 3), edge('c', 'a', 407, 4), edge('a', 'b', 509), edge('a', 'a', 601)],
      [0, 1, 2, 3],
    );
    const model = groupGraph(data);

    expect(model.nodes.map(item => item.id)).toEqual(['group:0', 'group:1', 'group:2', 'group:3']);
    expect(model.edges).toEqual([
      { id: 'g:["group:0","group:1"]', source: 'group:0', target: 'group:1', sumMinor: 303, transfers: 5, links: 2 },
      { id: 'g:["group:1","group:0"]', source: 'group:1', target: 'group:0', sumMinor: 407, transfers: 4, links: 1 },
    ]);
    expect(model.edges.reduce((sum, item) => sum + item.sumMinor, 0)).toBe(710);
    expect(model.edges.reduce((sum, item) => sum + item.transfers, 0)).toBe(9);
  });

  it('keeps adjacent int64 client identifiers distinct, including reciprocal and self edges', () => {
    const first = '9223372036854775806';
    const second = '9223372036854775807';
    const model = clientGraph(
      [node(first), node(second), node('isolated')],
      [edge(first, second, 101), edge(second, first, 203), edge(first, first, 307)],
    );

    expect(model.nodes.map(item => item.id)).toEqual([`node:${first}`, `node:${second}`, 'node:isolated']);
    expect(model.nodes.map(item => item.label)).toEqual(['…54775806', '…54775807', 'isolated']);
    expect(new Set(model.edges.map(item => item.id)).size).toBe(3);
    expect(model.edges.map(item => [item.source, item.target])).toEqual([
      [`node:${first}`, `node:${second}`], [`node:${second}`, `node:${first}`], [`node:${first}`, `node:${first}`],
    ]);
    expect(model.edges.reduce((sum, item) => sum + item.sumMinor, 0)).toBe(611);
  });

  it('uses unambiguous edge IDs when identifiers contain separators', () => {
    const model = clientGraph(
      [node('a:b'), node('c'), node('a'), node('b:c')],
      [edge('a:b', 'c', 1), edge('a', 'b:c', 2)],
    );
    expect(new Set(model.edges.map(item => item.id)).size).toBe(2);
  });

  it('excludes routes and client edges with endpoints outside the model', () => {
    const nodes = [node('a', 0), node('b', 1), node('c', 7)];
    const edges = [edge('a', 'b', 101), edge('missing', 'a', 202), edge('a', 'missing', 303), edge('a', 'c', 404)];

    expect(clientGraph(nodes.slice(0, 2), edges).edges).toHaveLength(1);
    expect(groupGraph(graph(nodes, edges, [0, 1])).edges).toHaveLength(1);
  });

  it('finds only direct neighbors in either direction and supports isolates', () => {
    const model = clientGraph(
      ['a', 'b', 'c', 'd', 'e'].map(gid => node(gid)),
      [edge('a', 'b', 1), edge('c', 'a', 2), edge('b', 'c', 3), edge('b', 'd', 4), edge('a', 'a', 5)],
    );

    expect(graphNeighborhood(model, 'node:a')).toEqual(new Set(['node:a', 'node:b', 'node:c']));
    expect(graphNeighborhood(model, 'node:e')).toEqual(new Set(['node:e']));
    expect(graphNeighborhood(model, 'missing')).toEqual(new Set());
  });

  it('preserves source data and boundary metadata when creating network views', () => {
    const nodes = [node('c'), node('a'), node('b')];
    nodes[0].in_deg = 10;
    nodes[0].is_seed = true;
    nodes[0].truncated_by_depth = true;
    const data = graph(nodes, [edge('a', 'b', 101), edge('b', 'c', 10000)], [0]);
    const original = structuredClone(data);
    const model = clientGraph(data.nodes, data.edges);
    const originalModel = structuredClone(model);

    groupGraph(data);
    graphNeighborhood(model, 'node:a');
    expect(model.nodes.find(item => item.id === 'node:c')).toMatchObject({ seed: true, boundary: true, kind: 'client' });
    expect(model.nodes[0].size).toBeGreaterThan(model.nodes[1].size);
    expect(data).toEqual(original);
    expect(model).toEqual(originalModel);
  });
});
