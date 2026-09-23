import { describe, expect, it } from 'vitest';
import { selectClusterGraph, selectNeighborhood } from './data';
import type { EdgeRow, GraphData, NodeRow } from './types';

function node(gid: string, clusterId = 0, priority = 0.5): NodeRow {
  return {
    gid, cluster_id: clusterId, priority_score: priority, depth: 1, is_seed: false,
    role: 'peripheral', role_score: 0.5, evidence: '', role_status: 'observed_pattern',
    flags: [], in_deg: 0, out_deg: 0, in_kzt: 0, out_kzt: 0, in_tx: 0, out_tx: 0,
    in_minor: 0, out_minor: 0, seed_sources: 0, active_days: 0, same_day_activity_days: 0,
    following_days_out_share: null, following_days_matched_minor: 0, window_days: 3,
    truncated_by_depth: false, cycle_component_size: 1, neighbor_clusters: 0, pass_through: null,
  };
}

function edge(src: string, dst: string): EdgeRow {
  return { src, dst, sum_kzt: 1, sum_minor: 100, n_tx: 1, depth: 1 };
}

function graph(nodes: NodeRow[], edges: EdgeRow[]): GraphData {
  return {
    nodes, edges, transactions: [], daily_flows: [], top_nodes: [], clusters: [],
    metadata: {
      schema_version: 1, n_nodes: nodes.length, n_edges: edges.length, n_transactions: 0,
      n_clusters: 0, n_seed: 0, n_boundary: 0, n_isolated: 0, sum_minor: 0,
      date_from: null, date_to: null, parameters: { window_days: 3, resolution: 1, random_seed: 42 },
    },
  };
}

describe('group exploration', () => {
  const data = graph(
    [node('1'), node('2'), node('3'), node('4', 1), node('5', 2), node('6', 1)],
    [edge('1', '2'), edge('2', '1'), edge('2', '2'), edge('1', '4'), edge('5', '2'), edge('4', '5'), edge('4', '6')],
  );

  it('includes every member, including an isolate, and all internal directed links', () => {
    const selected = selectClusterGraph(data, 0, false);
    expect(selected.nodes.map(item => item.gid)).toEqual(['1', '2', '3']);
    expect(selected.edges).toEqual([edge('1', '2'), edge('2', '1'), edge('2', '2')]);
    expect(selected.memberCount).toBe(3);
    expect(selected.internalEdgeCount).toBe(3);
    expect(selected.externalCount).toBe(2);
    expect(selected.externalEdgeCount).toBe(2);
  });

  it('reveals direct external parties without adding external-to-external or second-hop links', () => {
    const selected = selectClusterGraph(data, 0, true);
    expect(selected.nodes.map(item => item.gid)).toEqual(['1', '2', '3', '4', '5']);
    expect(selected.edges).toEqual([edge('1', '2'), edge('2', '1'), edge('2', '2'), edge('1', '4'), edge('5', '2')]);
    expect(selectClusterGraph(data, 0, false).nodes.map(item => item.gid)).toEqual(['1', '2', '3']);
  });

  it('does not apply the client-neighborhood cap to complete groups', () => {
    const members = Array.from({ length: 300 }, (_, index) => node(String(index)));
    const selected = selectClusterGraph(graph(members, []), 0, false);
    expect(selected.nodes).toHaveLength(300);
    expect(selected.memberCount).toBe(300);
    expect(members[2].gid).toBe('2');
  });

  it('returns an empty scope for an unknown group', () => {
    expect(selectClusterGraph(data, 99, true)).toEqual({
      nodes: [], edges: [], memberCount: 0, externalCount: 0, internalEdgeCount: 0, externalEdgeCount: 0,
    });
  });
});

describe('bounded client exploration', () => {
  it('reveals the second hop while reporting omitted clients and retaining all nearer clients', () => {
    const center = node('1', 0, 0);
    const direct = [node('2', 0, 0), node('3', 0, 0)];
    const distant = Array.from({ length: 270 }, (_, index) => node(String(index + 4), 1, 0.9));
    const edges = [edge('2', '1'), edge('1', '3'), ...distant.map(item => edge('2', item.gid))];
    const data = graph([center, ...direct, ...distant], edges);
    const first = selectNeighborhood(data, center.gid, 1);
    expect(first.nodes.map(item => item.gid)).toEqual(['1', '2', '3']);
    expect(first.truncated).toBe(false);
    const second = selectNeighborhood(data, center.gid, 2);
    expect(second.nodes).toHaveLength(250);
    expect(second.totalNodes).toBe(273);
    expect(second.truncated).toBe(true);
    expect(second.nodes.slice(0, 3).map(item => item.gid)).toEqual(['1', '2', '3']);
    const visible = new Set(second.nodes.map(item => item.gid));
    expect(second.edges.every(item => visible.has(item.src) && visible.has(item.dst))).toBe(true);
    expect(second.edges.slice(0, 2)).toEqual([edge('2', '1'), edge('1', '3')]);
  });
});
