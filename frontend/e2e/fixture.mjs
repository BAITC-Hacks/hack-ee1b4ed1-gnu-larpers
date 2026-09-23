import { readFile } from 'node:fs/promises';

export async function loadScenarioInputs(baseURL = 'http://127.0.0.1:5173') {
  const data = JSON.parse(await readFile(new URL('../public/generated/graph.json', import.meta.url), 'utf8'));
  const cluster = [...data.clusters].sort((left, right) => right.n_nodes - left.n_nodes || left.cluster_id - right.cluster_id)[0];
  const node = data.nodes.find(item => item.gid === cluster.top_gids[0]);
  if (!node) throw new Error('The largest group needs a valid top client for browser regression checks.');
  const dates = [...new Set(data.transactions.filter(row => row.src === node.gid).map(row => row.date))].sort();
  if (!dates.length) throw new Error('The selected client needs outgoing transfers for browser regression checks.');
  const from = dates[Math.min(1, dates.length - 1)];
  const to = dates[Math.min(3, dates.length - 1)];
  const members = new Set(data.nodes.filter(item => item.cluster_id === cluster.cluster_id).map(item => item.gid));
  const external = new Set();
  for (const edge of data.edges) {
    if (members.has(edge.src) && !members.has(edge.dst)) external.add(edge.dst);
    if (members.has(edge.dst) && !members.has(edge.src)) external.add(edge.src);
  }
  const neighbors = new Set([node.gid]);
  for (let step = 0; step < 2; step += 1) {
    const previous = new Set(neighbors);
    for (const edge of data.edges) {
      if (previous.has(edge.src)) neighbors.add(edge.dst);
      if (previous.has(edge.dst)) neighbors.add(edge.src);
    }
  }
  return {
    baseURL, gid: node.gid, role: node.role, clusterId: cluster.cluster_id,
    memberCount: members.size, externalCount: external.size, neighborhoodTotal: neighbors.size,
    from, to, datasetFrom: data.metadata.date_from, datasetTo: data.metadata.date_to,
    transactionCount: data.transactions.filter(row => row.src === node.gid && row.date >= from && row.date <= to).length,
  };
}
