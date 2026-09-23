import { roles, type DailyRow, type EdgeRow, type GraphData, type NodeRow, type Role, type Transaction } from './types';

type Row = Record<string, unknown>;

function fail(path: string, expected: string): never {
  throw new Error(`Неподдерживаемые данные: ${path} — ${expected}.`);
}

function object(value: unknown, path: string): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'ожидается объект');
  return value as Row;
}

function rows(value: unknown, path: string): Row[] {
  if (!Array.isArray(value)) fail(path, 'ожидается массив');
  return value.map((item, index) => object(item, `${path}[${index}]`));
}

function string(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string') fail(path, 'ожидается строка');
}

function id(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) fail(path, 'ID должен быть строкой из цифр, чтобы сохранить точность');
}

function number(value: unknown, path: string, integer = false): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) {
    fail(path, integer ? 'ожидается неотрицательное безопасное целое число' : 'ожидается конечное неотрицательное число');
  }
}

function boolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== 'boolean') fail(path, 'ожидается логическое значение');
}

function role(value: unknown, path: string): asserts value is Role {
  if (typeof value !== 'string' || !Object.hasOwn(roles, value)) fail(path, 'неизвестная роль');
}

function date(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(path, 'ожидается дата YYYY-MM-DD');
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) fail(path, 'некорректная календарная дата');
}

function numericFields(row: Row, fields: string[], path: string, integer = false) {
  for (const field of fields) number(row[field], `${path}.${field}`, integer);
}

function score(value: unknown, path: string) {
  number(value, path);
  if (value > 1) fail(path, 'ожидается оценка от 0 до 1');
}

function count(actual: number, expected: number, path: string) {
  if (actual !== expected) fail(path, `заявлено ${expected}, фактически ${actual}`);
}

export function parseGraphData(value: unknown): GraphData {
  const data = object(value, 'graph');
  const metadata = object(data.metadata, 'metadata');
  if (metadata.schema_version !== 1) fail('metadata.schema_version', 'поддерживается только версия 1');
  numericFields(metadata, ['n_nodes', 'n_edges', 'n_transactions', 'n_clusters', 'n_seed', 'n_boundary', 'n_isolated', 'sum_minor'], 'metadata', true);
  for (const field of ['date_from', 'date_to']) {
    if (metadata[field] !== null) date(metadata[field], `metadata.${field}`);
  }
  if ((metadata.date_from === null) !== (metadata.date_to === null)) fail('metadata', 'границы дат должны быть заданы вместе');
  if (typeof metadata.date_from === 'string' && typeof metadata.date_to === 'string' && metadata.date_from > metadata.date_to) fail('metadata', 'начало периода позже конца');
  const parameters = object(metadata.parameters, 'metadata.parameters');
  numericFields(parameters, ['window_days', 'random_seed'], 'metadata.parameters', true);
  number(parameters.resolution, 'metadata.parameters.resolution');

  const nodeRows = rows(data.nodes, 'nodes');
  if (nodeRows.length === 0) fail('nodes', 'нужен хотя бы один клиент для исследования');
  const edgeRows = rows(data.edges, 'edges');
  const clusterRows = rows(data.clusters, 'clusters');
  const topRows = rows(data.top_nodes, 'top_nodes');
  const transactionRows = rows(data.transactions, 'transactions');
  const dailyRows = rows(data.daily_flows, 'daily_flows');
  const nodes = new Map<string, Row>();

  nodeRows.forEach((row, index) => {
    const path = `nodes[${index}]`;
    id(row.gid, `${path}.gid`);
    if (nodes.has(row.gid)) fail(`${path}.gid`, 'повторяющийся ID клиента');
    nodes.set(row.gid, row);
    role(row.role, `${path}.role`);
    numericFields(row, ['depth', 'cluster_id', 'in_deg', 'out_deg', 'in_tx', 'out_tx', 'in_minor', 'out_minor', 'seed_sources', 'active_days', 'same_day_activity_days', 'following_days_matched_minor', 'window_days', 'cycle_component_size', 'neighbor_clusters'], path, true);
    numericFields(row, ['in_kzt', 'out_kzt'], path);
    for (const field of ['role_score', 'priority_score']) score(row[field], `${path}.${field}`);
    if (row.pass_through !== null) number(row.pass_through, `${path}.pass_through`);
    if (row.following_days_out_share !== null) score(row.following_days_out_share, `${path}.following_days_out_share`);
    for (const field of ['is_seed', 'truncated_by_depth']) boolean(row[field], `${path}.${field}`);
    for (const field of ['evidence', 'role_status']) string(row[field], `${path}.${field}`);
    if (!Array.isArray(row.flags) || row.flags.some((flag) => typeof flag !== 'string')) fail(`${path}.flags`, 'ожидается массив строк');
  });

  function endpoint(value: unknown, path: string) {
    id(value, path);
    if (!nodes.has(value)) fail(path, `клиент ${value} отсутствует в nodes`);
  }

  edgeRows.forEach((row, index) => {
    const path = `edges[${index}]`;
    endpoint(row.src, `${path}.src`);
    endpoint(row.dst, `${path}.dst`);
    numericFields(row, ['sum_minor', 'n_tx', 'depth'], path, true);
    number(row.sum_kzt, `${path}.sum_kzt`);
  });

  const clusters = new Map<number, Row>();
  clusterRows.forEach((row, index) => {
    const path = `clusters[${index}]`;
    numericFields(row, ['cluster_id', 'n_nodes', 'n_seed'], path, true);
    if (row.n_nodes === 0) fail(`${path}.n_nodes`, 'группа должна содержать хотя бы одного клиента');
    const clusterId = row.cluster_id as number;
    if (clusters.has(clusterId)) fail(`${path}.cluster_id`, 'повторяющийся ID группы');
    clusters.set(clusterId, row);
    number(row.sum_kzt_internal, `${path}.sum_kzt_internal`);
    string(row.hypothesis, `${path}.hypothesis`);
    if (!Array.isArray(row.top_gids)) fail(`${path}.top_gids`, 'ожидается массив ID');
    if (row.top_gids.length === 0) fail(`${path}.top_gids`, 'нужен хотя бы один ID для открытия группы');
    row.top_gids.forEach((gid, position) => {
      endpoint(gid, `${path}.top_gids[${position}]`);
      if (nodes.get(gid as string)?.cluster_id !== clusterId) fail(`${path}.top_gids[${position}]`, 'клиент относится к другой группе');
    });
  });
  for (const [gid, row] of nodes) {
    if (!clusters.has(row.cluster_id as number)) fail(`nodes.${gid}.cluster_id`, 'группа отсутствует в clusters');
  }
  for (const [clusterId, row] of clusters) {
    const members = nodeRows.filter((node) => node.cluster_id === clusterId);
    count(members.length, row.n_nodes as number, `clusters.${clusterId}.n_nodes`);
    count(members.filter((node) => node.is_seed).length, row.n_seed as number, `clusters.${clusterId}.n_seed`);
  }

  const rankedIds = new Set<string>();
  const ranks = new Set<number>();
  topRows.forEach((row, index) => {
    const path = `top_nodes[${index}]`;
    endpoint(row.gid, `${path}.gid`);
    number(row.rank, `${path}.rank`, true);
    if (row.rank < 1 || ranks.has(row.rank)) fail(`${path}.rank`, 'ожидается уникальное положительное место');
    if (rankedIds.has(row.gid as string)) fail(`${path}.gid`, 'повторяющийся клиент в рейтинге');
    ranks.add(row.rank);
    rankedIds.add(row.gid as string);
    role(row.role, `${path}.role`);
    score(row.priority_score, `${path}.priority_score`);
    string(row.why, `${path}.why`);
  });

  transactionRows.forEach((row, index) => {
    const path = `transactions[${index}]`;
    endpoint(row.src, `${path}.src`);
    endpoint(row.dst, `${path}.dst`);
    date(row.date, `${path}.date`);
    number(row.sum_kzt, `${path}.sum_kzt`);
    number(row.sum_minor, `${path}.sum_minor`, true);
  });

  dailyRows.forEach((row, index) => {
    const path = `daily_flows[${index}]`;
    endpoint(row.gid, `${path}.gid`);
    date(row.date, `${path}.date`);
    numericFields(row, ['in_minor', 'out_minor', 'in_tx', 'out_tx'], path, true);
  });

  count(nodeRows.length, metadata.n_nodes as number, 'metadata.n_nodes');
  count(edgeRows.length, metadata.n_edges as number, 'metadata.n_edges');
  count(transactionRows.length, metadata.n_transactions as number, 'metadata.n_transactions');
  count(clusterRows.length, metadata.n_clusters as number, 'metadata.n_clusters');
  count(nodeRows.filter((node) => node.is_seed).length, metadata.n_seed as number, 'metadata.n_seed');
  count(nodeRows.filter((node) => node.truncated_by_depth).length, metadata.n_boundary as number, 'metadata.n_boundary');
  const connectedIds = new Set(edgeRows.flatMap((edge) => [edge.src, edge.dst]));
  count(nodeRows.filter((node) => !connectedIds.has(node.gid)).length, metadata.n_isolated as number, 'metadata.n_isolated');
  return data as unknown as GraphData;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function priorityOrder(a: NodeRow, b: NodeRow): number {
  return b.priority_score - a.priority_score || compareIds(a.gid, b.gid);
}

export function filterNodes(data: GraphData, query: string, selectedRole: Role | 'all', clusterId: number | null): NodeRow[] {
  const needle = query.trim().toLocaleLowerCase('ru');
  return data.nodes.filter((node) => {
    if (selectedRole !== 'all' && node.role !== selectedRole) return false;
    if (clusterId !== null && node.cluster_id !== clusterId) return false;
    return !needle || `${node.gid} ${roles[node.role].label} ${node.evidence}`.toLocaleLowerCase('ru').includes(needle);
  }).sort(priorityOrder);
}

export function selectNeighborhood(data: GraphData, gid: string, hops: 1 | 2, maxNodes = 250): { nodes: NodeRow[]; edges: EdgeRow[]; totalNodes: number; truncated: boolean } {
  if (!Number.isFinite(maxNodes)) throw new Error('Лимит узлов должен быть конечным числом.');
  const limit = Math.max(1, Math.trunc(maxNodes));
  const byId = new Map(data.nodes.map((node) => [node.gid, node]));
  if (!byId.has(gid)) return { nodes: [], edges: [], totalNodes: 0, truncated: false };
  const adjacency = new Map<string, Set<string>>();
  for (const edge of data.edges) {
    if (!adjacency.has(edge.src)) adjacency.set(edge.src, new Set());
    if (!adjacency.has(edge.dst)) adjacency.set(edge.dst, new Set());
    adjacency.get(edge.src)!.add(edge.dst);
    adjacency.get(edge.dst)!.add(edge.src);
  }
  const distances = new Map([[gid, 0]]);
  let frontier = [gid];
  for (let distance = 1; distance <= hops; distance += 1) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!distances.has(neighbor) && byId.has(neighbor)) {
          distances.set(neighbor, distance);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  const candidates = [...distances.keys()].map((nodeId) => byId.get(nodeId)!);
  candidates.sort((a, b) => distances.get(a.gid)! - distances.get(b.gid)! || priorityOrder(a, b));
  const nodes = candidates.slice(0, limit);
  const visible = new Set(nodes.map((node) => node.gid));
  const edges = data.edges.filter((edge) => visible.has(edge.src) && visible.has(edge.dst));
  return { nodes, edges, totalNodes: candidates.length, truncated: nodes.length < candidates.length };
}

export function transactionsForNode(data: GraphData, gid: string, from: string, to: string): Transaction[] {
  return data.transactions.filter((transaction) => (transaction.src === gid || transaction.dst === gid) && (!from || transaction.date >= from) && (!to || transaction.date <= to));
}

export function dailyForNode(data: GraphData, gid: string): DailyRow[] {
  return data.daily_flows.filter((row) => row.gid === gid).sort((a, b) => compareIds(a.date, b.date));
}
