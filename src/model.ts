import { DirectedGraph, UndirectedGraph } from 'graphology';
import louvain from 'graphology-communities-louvain';
import betweennessCentrality from 'graphology-metrics/centrality/betweenness';
import pagerank from 'graphology-metrics/centrality/pagerank';
import { toMinor } from './data';
import type { ClusterRow, Dataset, NodeRow, Results, Role, TopRow } from './types';

interface Features {
  gid: string;
  depth: number;
  is_seed: boolean;
  incoming: Map<string, number>;
  outgoing: Map<string, number>;
  inMinor: number;
  outMinor: number;
  inTx: number;
  outTx: number;
  seedSources: number;
  betweenness: number;
  pagerank: number;
  quickOutShare: number | null;
  clusterId: number;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function formatMoney(minor: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(minor / 100);
}

function compareGid(a: string, b: string): number {
  const left = BigInt(a);
  const right = BigInt(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function seededRandom(): () => number {
  let state = 0x7b17c0de;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function percentile(values: number[], quantile: number): number {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (!sorted.length) return Infinity;
  return sorted[Math.floor((sorted.length - 1) * quantile)];
}

function classify(feature: Features, boundary: number, bridgeThreshold: number): { role: Role; score: number; evidence: string } {
  const inDeg = feature.incoming.size;
  const outDeg = feature.outgoing.size;
  const pass = feature.inMinor > 0 ? feature.outMinor / feature.inMinor : null;
  const prefix = `Вход: ${inDeg} пл., ${formatMoney(feature.inMinor)} KZT; выход: ${outDeg} пол., ${formatMoney(feature.outMinor)} KZT.`;

  if (feature.seedSources >= 2 && inDeg >= 2 && outDeg >= 2 && feature.betweenness > 0 && feature.betweenness >= bridgeThreshold) {
    return { role: 'coordinator', score: clamp(0.65 + 0.04 * feature.seedSources + 0.04 * Math.min(inDeg, outDeg)), evidence: `Связи от ${feature.seedSources} исходных клиентов; высокая посредническая роль. ${prefix}` };
  }
  if (outDeg >= 8 && outDeg >= Math.max(2, inDeg * 1.5)) {
    return { role: 'distributor', score: clamp(0.55 + 0.035 * outDeg + 0.1 * Math.min(1, feature.outMinor / 1_000_000_000)), evidence: `Распределяет средства ${outDeg} получателям. ${prefix}` };
  }
  if (inDeg >= 5 && inDeg >= Math.max(2, outDeg * 1.5)) {
    return { role: 'consolidator', score: clamp(0.55 + 0.04 * inDeg + 0.04 * feature.seedSources), evidence: `Получает от ${inDeg} разных плательщиков; связи от ${feature.seedSources} исходных клиентов. ${prefix}` };
  }
  if (!feature.is_seed && pass !== null && inDeg > 0 && outDeg > 0 && pass >= 0.8 && pass <= 1.2) {
    const time = feature.quickOutShare === null ? '' : ` ${Math.round(feature.quickOutShare * 100)}% исходящего объёма в дни притока или через 1–2 дня.`;
    return { role: 'transit', score: clamp(0.62 + 0.17 * (1 - Math.abs(pass - 1) / 0.2) + 0.12 * (feature.quickOutShare ?? 0)), evidence: `Наблюдаемый выход/вход ${pass.toFixed(2)}.${time} ${prefix}` };
  }
  if (!feature.is_seed && feature.depth < boundary && inDeg > 0 && outDeg === 0) {
    return { role: 'terminal', score: 0.55, evidence: `Получено ${formatMoney(feature.inMinor)} KZT от ${inDeg} плательщиков; исходящих переводов в выборке нет (колено ${feature.depth}).` };
  }
  if (feature.depth === boundary && outDeg === 0) {
    return { role: 'peripheral', score: 0.2, evidence: `Колено ${boundary}: исходящие переводы за пределом обхода неизвестны. ${prefix}` };
  }
  return { role: 'peripheral', score: feature.is_seed && inDeg + outDeg === 0 ? 0.2 : 0.35, evidence: `Выраженных признаков роли в доступной выборке нет. ${prefix}` };
}

function createFeatures(dataset: Dataset): { features: Map<string, Features>; graph: DirectedGraph; clustersGraph: UndirectedGraph } {
  const features = new Map<string, Features>();
  const graph = new DirectedGraph();
  const clustersGraph = new UndirectedGraph();
  for (const node of [...dataset.nodes].sort((a, b) => compareGid(a.gid, b.gid))) {
    const key = String(node.gid);
    graph.addNode(key);
    clustersGraph.addNode(key);
    features.set(node.gid, {
      gid: node.gid, depth: node.depth, is_seed: node.is_seed,
      incoming: new Map(), outgoing: new Map(), inMinor: 0, outMinor: 0,
      inTx: 0, outTx: 0, seedSources: 0, betweenness: 0, pagerank: 0,
      quickOutShare: null, clusterId: -1,
    });
  }
  for (const edge of [...dataset.edges].sort((a, b) => compareGid(a.src, b.src) || compareGid(a.dst, b.dst))) {
    const src = features.get(edge.src)!;
    const dst = features.get(edge.dst)!;
    const minor = toMinor(edge.sum_kzt);
    src.outgoing.set(edge.dst, minor);
    dst.incoming.set(edge.src, minor);
    src.outMinor += minor;
    dst.inMinor += minor;
    src.outTx += edge.n_tx;
    dst.inTx += edge.n_tx;
    graph.addDirectedEdge(String(edge.src), String(edge.dst), { weight: edge.sum_kzt });
    const a = String(edge.src);
    const b = String(edge.dst);
    const weight = Math.log1p(edge.sum_kzt);
    if (clustersGraph.hasEdge(a, b)) clustersGraph.updateEdgeAttribute(a, b, 'weight', (old: number) => old + weight);
    else clustersGraph.addUndirectedEdge(a, b, { weight });
  }
  return { features, graph, clustersGraph };
}

function addSeedSources(features: Map<string, Features>): void {
  const sources = new Map<string, Set<string>>([...features.keys()].map((gid) => [gid, new Set()]));
  for (const seed of [...features.values()].filter((item) => item.is_seed)) {
    const visited = new Set<string>([seed.gid]);
    let frontier = [seed.gid];
    for (let depth = 0; depth <= 4 && frontier.length; depth++) {
      const next: string[] = [];
      for (const gid of frontier) {
        sources.get(gid)!.add(seed.gid);
        for (const target of features.get(gid)!.outgoing.keys()) {
          if (!visited.has(target)) {
            visited.add(target);
            next.push(target);
          }
        }
      }
      frontier = next;
    }
  }
  for (const feature of features.values()) feature.seedSources = sources.get(feature.gid)!.size;
}

function addTemporalFeatures(features: Map<string, Features>, dataset: Dataset): void {
  const incomingDates = new Map<string, Set<number>>();
  const outgoing = new Map<string, { day: number; minor: number }[]>();
  for (const tx of dataset.transactions) {
    const day = Date.parse(`${tx.date}T00:00:00Z`) / 86_400_000;
    if (!incomingDates.has(tx.dst)) incomingDates.set(tx.dst, new Set());
    incomingDates.get(tx.dst)!.add(day);
    if (!outgoing.has(tx.src)) outgoing.set(tx.src, []);
    outgoing.get(tx.src)!.push({ day, minor: toMinor(tx.sum_kzt) });
  }
  for (const feature of features.values()) {
    if (!feature.inMinor || !feature.outMinor) continue;
    const dates = incomingDates.get(feature.gid) ?? new Set();
    const quickMinor = (outgoing.get(feature.gid) ?? []).filter(({ day }) => dates.has(day) || dates.has(day - 1) || dates.has(day - 2))
      .reduce((total, tx) => total + tx.minor, 0);
    feature.quickOutShare = quickMinor / feature.outMinor;
  }
}

function addClusters(features: Map<string, Features>, graph: UndirectedGraph): void {
  const membership = louvain(graph, { getEdgeWeight: 'weight', rng: seededRandom() });
  const groups = new Map<number, string[]>();
  for (const [key, value] of Object.entries(membership)) {
    const group = groups.get(value) ?? [];
    group.push(key);
    groups.set(value, group);
  }
  const sorted = [...groups.values()].sort((a, b) => b.length - a.length || compareGid(a.sort(compareGid)[0], b.sort(compareGid)[0]));
  sorted.forEach((group, index) => group.forEach((gid) => { features.get(gid)!.clusterId = index + 1; }));
}

function scorePriority(feature: Features, maxVolume: number, maxDegree: number, maxBridge: number, roleScore: number): number {
  const volume = Math.log1p((feature.inMinor + feature.outMinor) / 100) / Math.log1p(maxVolume);
  const degree = Math.log1p(feature.incoming.size + feature.outgoing.size) / Math.log1p(maxDegree);
  const bridge = maxBridge > 0 ? Math.log1p(feature.betweenness) / Math.log1p(maxBridge) : 0;
  const seeds = Math.min(feature.seedSources / 4, 1);
  const score = 0.26 * volume + 0.2 * degree + 0.2 * bridge + 0.24 * seeds + 0.1 * roleScore;
  return round(clamp(score * (feature.is_seed ? 0.45 : 1) * (feature.depth === 4 ? 0.8 : 1)));
}

export function analyze(dataset: Dataset): Results {
  const { features, graph, clustersGraph } = createFeatures(dataset);
  addSeedSources(features);
  addTemporalFeatures(features, dataset);
  addClusters(features, clustersGraph);
  const between = betweennessCentrality(graph, { getEdgeWeight: null });
  const ranks = pagerank(graph, { getEdgeWeight: 'weight' });
  for (const feature of features.values()) {
    feature.betweenness = between[String(feature.gid)] ?? 0;
    feature.pagerank = ranks[String(feature.gid)] ?? 0;
  }
  const all = [...features.values()];
  const maxDepth = Math.max(...all.map((item) => item.depth));
  const bridgeThreshold = percentile(all.map((item) => item.betweenness), 0.9);
  const maxVolume = Math.max(1, ...all.map((item) => (item.inMinor + item.outMinor) / 100));
  const maxDegree = Math.max(1, ...all.map((item) => item.incoming.size + item.outgoing.size));
  const maxBridge = Math.max(0, ...all.map((item) => item.betweenness));
  const nodes: NodeRow[] = all.map((feature) => {
    const { role, score, evidence } = classify(feature, maxDepth, bridgeThreshold);
    const flags: string[] = [];
    if (feature.depth === maxDepth && !feature.outgoing.size) flags.push('Граница обхода: исходящие переводы неизвестны');
    if (feature.is_seed) flags.push('Входящие переводы исходного клиента неполны');
    if (feature.outMinor > feature.inMinor) flags.push('Исходящий объём выше наблюдаемого входа: поток за пределами выборки неизвестен');
    if (!feature.incoming.size && !feature.outgoing.size) flags.push('Узел без наблюдаемых рёбер');
    return {
      gid: feature.gid, depth: feature.depth, is_seed: feature.is_seed,
      role, role_score: round(score), cluster_id: feature.clusterId,
      priority_score: scorePriority(feature, maxVolume, maxDegree, maxBridge, score),
      evidence: evidence.slice(0, 200),
      in_deg: feature.incoming.size, out_deg: feature.outgoing.size,
      in_kzt: feature.inMinor / 100, out_kzt: feature.outMinor / 100,
      in_tx: feature.inTx, out_tx: feature.outTx, seed_sources: feature.seedSources,
      betweenness: round(feature.betweenness, 8), pagerank: round(feature.pagerank, 8),
      quick_out_share: feature.quickOutShare === null ? null : round(feature.quickOutShare),
      flags,
    };
  }).sort((a, b) => compareGid(a.gid, b.gid));

  const byId = new Map(nodes.map((node) => [node.gid, node]));
  const byCluster = new Map<number, NodeRow[]>();
  for (const node of nodes) {
    const group = byCluster.get(node.cluster_id) ?? [];
    group.push(node);
    byCluster.set(node.cluster_id, group);
  }
  const clusters: ClusterRow[] = [...byCluster.entries()].sort((a, b) => a[0] - b[0]).map(([id, members]) => {
    const seedCount = members.filter((node) => node.is_seed).length;
    const sumMinor = dataset.edges.filter((edge) => byId.get(edge.src)!.cluster_id === id && byId.get(edge.dst)!.cluster_id === id)
      .reduce((total, edge) => total + toMinor(edge.sum_kzt), 0);
    const leaders = [...members].sort((a, b) => b.priority_score - a.priority_score || compareGid(a.gid, b.gid)).slice(0, 5);
    const count = (role: Role) => members.filter((member) => member.role === role).length;
    const keyRoles = [
      `${count('coordinator')} координирующих`,
      `${count('consolidator')} собирающих`,
      `${count('distributor')} распределяющих`,
      `${count('transit')} транзитных`,
    ];
    const hypothesis = members.length === 1 && members[0].in_deg + members[0].out_deg === 0
      ? 'Изолированный клиент: связей в выгрузке нет'
      : `В сообществе ${seedCount} исходных клиентов; ${keyRoles.join(', ')} узлов. Структура требует проверки.`;
    return { cluster_id: id, n_nodes: members.length, n_seed: seedCount, sum_kzt_internal: sumMinor / 100,
      top_gids: leaders.map((node) => node.gid).join(','), hypothesis };
  });
  const top_nodes: TopRow[] = [...nodes].filter((node) => !node.is_seed)
    .sort((a, b) => b.priority_score - a.priority_score || compareGid(a.gid, b.gid)).slice(0, 50)
    .map((node, index) => ({ rank: index + 1, gid: node.gid, role: node.role, priority_score: node.priority_score,
      why: `${node.evidence} Связи от ${node.seed_sources} исходных клиентов; приоритет ${node.priority_score.toFixed(3)}.` }));
  return { nodes, edges: dataset.edges, clusters, top_nodes };
}
