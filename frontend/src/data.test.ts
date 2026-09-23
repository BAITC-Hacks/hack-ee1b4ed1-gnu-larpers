import { describe, expect, it } from 'vitest';
import { dailyForNode, filterNodes, parseGraphData, selectNeighborhood, transactionsForNode } from './data';
import type { EdgeRow, GraphData, NodeRow, Transaction } from './types';

const a = '9007199254740992';
const b = '9007199254740993';
const c = '9007199254740994';
const d = '9007199254740995';
const isolated = '9007199254740996';

function node(gid: string, patch: Partial<NodeRow> = {}): NodeRow {
  return {
    gid, depth: 1, is_seed: false, role: 'peripheral', role_score: 0.5,
    cluster_id: 0, priority_score: 0.5, evidence: 'Наблюдаемый узел', role_status: 'observed_pattern',
    flags: ['partial_observation'], in_deg: 0, out_deg: 0, in_kzt: 0, out_kzt: 0,
    in_tx: 0, out_tx: 0, in_minor: 0, out_minor: 0, seed_sources: 0, active_days: 0,
    same_day_activity_days: 0, following_days_out_share: null, following_days_matched_minor: 0,
    window_days: 3, truncated_by_depth: false, cycle_component_size: 1, neighbor_clusters: 0,
    pass_through: null, ...patch,
  };
}

function edge(src: string, dst: string): EdgeRow {
  return { src, dst, sum_kzt: 1, sum_minor: 100, n_tx: 1, depth: 1 };
}

function transaction(src: string, dst: string, date: string): Transaction {
  return { src, dst, date, sum_kzt: 1, sum_minor: 100 };
}

function fixture(): GraphData {
  return {
    metadata: {
      schema_version: 1, n_nodes: 5, n_edges: 3, n_transactions: 5, n_clusters: 1,
      n_seed: 1, n_boundary: 0, n_isolated: 1, sum_minor: 500,
      date_from: '2026-07-01', date_to: '2026-07-03', parameters: { window_days: 3, resolution: 1, random_seed: 42 },
    },
    nodes: [node(b, { priority_score: 0.9 }), node(a, { is_seed: true }), node(c), node(d), node(isolated)],
    edges: [edge(b, a), edge(b, c), edge(c, d)],
    clusters: [{ cluster_id: 0, n_nodes: 5, n_seed: 1, sum_kzt_internal: 3, top_gids: [b], hypothesis: 'Гипотеза' }],
    top_nodes: [{ rank: 1, gid: b, role: 'peripheral', priority_score: 0.9, why: 'Наблюдаемый узел' }],
    transactions: [transaction(b, a, '2026-07-01'), transaction(a, b, '2026-07-02'), transaction(a, b, '2026-07-02'), transaction(b, c, '2026-07-02'), transaction(b, a, '2026-07-03')],
    daily_flows: [
      { gid: a, date: '2026-07-03', in_minor: 100, out_minor: 0, in_tx: 1, out_tx: 0 },
      { gid: b, date: '2026-07-02', in_minor: 200, out_minor: 100, in_tx: 2, out_tx: 1 },
      { gid: a, date: '2026-07-01', in_minor: 100, out_minor: 0, in_tx: 1, out_tx: 0 },
    ],
  };
}

describe('parseGraphData', () => {
  it('preserves neighboring large IDs as distinct strings across a JSON round trip', () => {
    const data = parseGraphData(JSON.parse(JSON.stringify(fixture())));
    expect(data.nodes.find((item) => item.gid === a)?.is_seed).toBe(true);
    expect(data.nodes.find((item) => item.gid === b)?.is_seed).toBe(false);
    expect(new Set(data.nodes.map((item) => item.gid)).size).toBe(5);
  });

  it.each([
    ['unsupported schema', (data: any) => { data.metadata.schema_version = 2; }, /schema_version/],
    ['missing table', (data: any) => { delete data.transactions; }, /transactions/],
    ['empty nodes', (data: any) => { data.nodes = []; }, /nodes.*хотя бы один клиент/],
    ['numeric gid', (data: any) => { data.nodes[0].gid = 9007199254740992; }, /строкой/],
    ['numeric edge endpoint', (data: any) => { data.edges[0].src = 9007199254740992; }, /edges\[0\].src/],
    ['numeric transaction endpoint', (data: any) => { data.transactions[0].dst = 9007199254740992; }, /transactions\[0\].dst/],
    ['missing node field', (data: any) => { delete data.nodes[0].role_score; }, /role_score/],
    ['role support above one', (data: any) => { data.nodes[0].role_score = 1.01; }, /role_score.*от 0 до 1/],
    ['priority above one', (data: any) => { data.nodes[0].priority_score = 1.01; }, /priority_score.*от 0 до 1/],
    ['following-day share above one', (data: any) => { data.nodes[0].following_days_out_share = 1.01; }, /following_days_out_share.*от 0 до 1/],
    ['ranking priority above one', (data: any) => { data.top_nodes[0].priority_score = 1.01; }, /priority_score.*от 0 до 1/],
    ['unknown role', (data: any) => { data.nodes[0].role = 'fraud'; }, /роль/],
    ['duplicate node', (data: any) => { data.nodes[0].gid = a; }, /повторяющийся ID/],
    ['unknown endpoint', (data: any) => { data.edges[0].dst = '123'; }, /отсутствует в nodes/],
    ['unknown cluster', (data: any) => { data.nodes[0].cluster_id = 99; }, /групп/],
    ['empty cluster navigation target', (data: any) => { data.clusters[0].top_gids = []; }, /top_gids.*открытия группы/],
    ['empty group', (data: any) => { data.clusters.push({ ...data.clusters[0], cluster_id: 1, n_nodes: 0, n_seed: 0, top_gids: [] }); }, /n_nodes.*хотя бы одного клиента/],
    ['inconsistent node count', (data: any) => { data.metadata.n_nodes = 999; }, /metadata.n_nodes/],
    ['inconsistent transaction count', (data: any) => { data.metadata.n_transactions = 999; }, /metadata.n_transactions/],
    ['inconsistent cluster size', (data: any) => { data.clusters[0].n_nodes = 99; }, /n_nodes/],
    ['impossible date', (data: any) => { data.transactions[0].date = '2026-02-30'; }, /календарная дата/],
    ['non-finite amount', (data: any) => { data.edges[0].sum_kzt = Infinity; }, /sum_kzt/],
  ])('rejects %s with a useful contract error', (_, change, message) => {
    const data = fixture();
    change(data);
    expect(() => parseGraphData(data)).toThrow(message);
  });

  it.each([null, [], 'not a parsed graph', 1])('rejects a non-object root %s', (value) => {
    expect(() => parseGraphData(value)).toThrow(/Неподдерживаемые данные/);
  });

  it('accepts score boundaries, nullable shares, and pass-through ratios above one', () => {
    const data = fixture();
    data.nodes[0].role_score = 0;
    data.nodes[0].priority_score = 1;
    data.nodes[0].following_days_out_share = 1;
    data.nodes[0].pass_through = 2.5;
    data.nodes[1].following_days_out_share = 0;
    expect(parseGraphData(data)).toBe(data);
    expect(data.nodes[2].following_days_out_share).toBeNull();
  });

  it('accepts a nonempty graph without ranked clients for initial node fallback', () => {
    const data = fixture();
    data.top_nodes = [];
    expect(parseGraphData(data).nodes[0].gid).toBe(b);
  });
});

describe('filterNodes', () => {
  it('searches every node, including clients outside the priority list', () => {
    const data = fixture();
    expect(data.top_nodes.some((item) => item.gid === isolated)).toBe(false);
    expect(filterNodes(data, isolated, 'all', null).map((item) => item.gid)).toEqual([isolated]);
    expect(filterNodes(data, 'нет такого клиента', 'all', null)).toEqual([]);
  });

  it('sorts by priority then exact ID without changing the input', () => {
    const data = fixture();
    data.nodes[0].priority_score = 0.5;
    const originalOrder = data.nodes.map((item) => item.gid);
    expect(filterNodes(data, '', 'all', null).map((item) => item.gid)).toEqual([a, b, c, d, isolated]);
    expect(data.nodes.map((item) => item.gid)).toEqual(originalOrder);
    data.nodes[2].priority_score = 0.99;
    expect(filterNodes(data, '', 'all', null)[0].gid).toBe(c);
  });

  it('combines role, cluster, and case-insensitive search filters', () => {
    const data = fixture();
    data.nodes[0] = node(b, { role: 'transit', cluster_id: 3, evidence: 'Передача средств' });
    data.nodes[1] = node(a, { role: 'transit', cluster_id: 2 });
    expect(filterNodes(data, ' ПЕРЕДАЧА ', 'transit', 3).map((item) => item.gid)).toEqual([b]);
    expect(filterNodes(data, 'транзит', 'transit', 2).map((item) => item.gid)).toEqual([a]);
    expect(filterNodes(data, '', 'terminal', 3)).toEqual([]);
  });
});

describe('selectNeighborhood', () => {
  it('walks incoming and outgoing links while preserving edge direction', () => {
    const data = fixture();
    const first = selectNeighborhood(data, a, 1);
    expect(first.nodes.map((item) => item.gid)).toEqual([a, b]);
    expect(first.edges).toEqual([edge(b, a)]);
    const second = selectNeighborhood(data, a, 2);
    expect(second.nodes.map((item) => item.gid)).toEqual([a, b, c]);
    expect(second.edges).toEqual([edge(b, a), edge(b, c)]);
    expect(second.totalNodes).toBe(3);
    expect(second.truncated).toBe(false);
  });

  it('keeps the selected low-priority node and reports the full neighborhood under a cap', () => {
    const data = fixture();
    data.nodes.find((item) => item.gid === a)!.priority_score = 0;
    const result = selectNeighborhood(data, a, 2, 2);
    expect(result.nodes.map((item) => item.gid)).toEqual([a, b]);
    expect(result.totalNodes).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.edges).toEqual([edge(b, a)]);
    expect(selectNeighborhood(data, a, 2, 0).nodes.map((item) => item.gid)).toEqual([a]);
  });

  it('preserves isolates and returns an empty result for an unknown ID', () => {
    const data = fixture();
    expect(selectNeighborhood(data, isolated, 2)).toEqual({ nodes: [data.nodes[4]], edges: [], totalNodes: 1, truncated: false });
    expect(selectNeighborhood(data, '1', 2)).toEqual({ nodes: [], edges: [], totalNodes: 0, truncated: false });
  });

  it('includes each node once when reciprocal edges and self-transfers exist', () => {
    const data = fixture();
    data.edges.push(edge(a, b), edge(a, a));
    const result = selectNeighborhood(data, a, 1);
    expect(result.nodes.map((item) => item.gid)).toEqual([a, b]);
    expect(result.edges).toEqual([edge(b, a), edge(a, b), edge(a, a)]);
  });
});

describe('node timelines', () => {
  it('includes both directions, both date boundaries, and repeated identical transactions', () => {
    const data = fixture();
    expect(transactionsForNode(data, a, '2026-07-01', '2026-07-03')).toHaveLength(4);
    expect(transactionsForNode(data, a, '2026-07-02', '2026-07-02')).toEqual([
      transaction(a, b, '2026-07-02'), transaction(a, b, '2026-07-02'),
    ]);
    expect(transactionsForNode(data, a, '', '')).toHaveLength(4);
    expect(transactionsForNode(data, a, '2026-07-03', '2026-07-01')).toEqual([]);
    expect(transactionsForNode(data, isolated, '', '')).toEqual([]);
  });

  it('returns one self-transfer once rather than counting both endpoints twice', () => {
    const data = fixture();
    data.transactions.push(transaction(a, a, '2026-07-02'));
    expect(transactionsForNode(data, a, '2026-07-02', '2026-07-02')).toHaveLength(3);
  });

  it('selects and chronologically orders only the requested client daily flows', () => {
    const data = fixture();
    expect(dailyForNode(data, a).map((row) => row.date)).toEqual(['2026-07-01', '2026-07-03']);
    expect(data.daily_flows[0].date).toBe('2026-07-03');
    expect(dailyForNode(data, isolated)).toEqual([]);
  });
});
