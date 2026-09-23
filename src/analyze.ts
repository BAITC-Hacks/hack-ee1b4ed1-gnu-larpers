import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadDataset } from './data';
import { analyze } from './model';
import type { Results } from './types';

function csvCell(value: string | number | boolean): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csv(headers: string[], rows: Array<Array<string | number | boolean>>): string {
  return [headers.join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\n') + '\n';
}

async function writeResults(out: string, results: Results, deliverables: string | null): Promise<void> {
  await mkdir(out, { recursive: true });
  if (deliverables) await mkdir(deliverables, { recursive: true });
  const files = [
    ['nodes_roles.csv', csv(
      ['gid', 'role', 'role_score', 'cluster_id', 'priority_score', 'evidence'],
      results.nodes.map((node) => [node.gid, node.role, node.role_score, node.cluster_id, node.priority_score, node.evidence]),
    )],
    ['clusters.csv', csv(
      ['cluster_id', 'n_nodes', 'n_seed', 'sum_kzt_internal', 'top_gids', 'hypothesis'],
      results.clusters.map((cluster) => [cluster.cluster_id, cluster.n_nodes, cluster.n_seed, cluster.sum_kzt_internal, cluster.top_gids, cluster.hypothesis]),
    )],
    ['top_nodes.csv', csv(
      ['rank', 'gid', 'role', 'priority_score', 'why'],
      results.top_nodes.map((node) => [node.rank, node.gid, node.role, node.priority_score, node.why]),
    )],
  ];
  await Promise.all([
    ...files.map(([name, content]) => writeFile(resolve(out, name), content)),
    ...deliverables ? files.map(([name, content]) => writeFile(resolve(deliverables, name), content)) : [],
    writeFile(resolve(out, 'graph.json'), JSON.stringify(results)),
  ]);
}

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return value;
}

async function main(): Promise<void> {
  const started = performance.now();
  const data = resolve(argument('--data', 'data'));
  const out = resolve(argument('--out', 'public/generated'));
  const deliverables = process.argv.includes('--out') ? null : resolve('outputs');
  const dataset = await loadDataset(data);
  const results = analyze(dataset);
  if (results.nodes.length !== dataset.nodes.length) throw new Error('Output lost nodes');
  if (results.top_nodes.length < Math.min(20, dataset.nodes.filter((node) => !node.is_seed).length)) throw new Error('Top list too short');
  if (results.nodes.some((node) => node.cluster_id < 1 || !node.evidence || node.evidence.length > 200)) throw new Error('Incomplete role output');
  await writeResults(out, results, deliverables);
  const roles = Object.entries(results.nodes.reduce<Record<string, number>>((counts, node) => {
    counts[node.role] = (counts[node.role] ?? 0) + 1;
    return counts;
  }, {})).map(([role, count]) => `${role}: ${count}`).join(', ');
  console.log(`Analyzed ${dataset.nodes.length} nodes, ${dataset.edges.length} edges, ${dataset.transactions.length} transactions`);
  console.log(`Clusters: ${results.clusters.length}; roles: ${roles}`);
  console.log(`Output: ${out}`);
  if (deliverables) console.log(`Submission CSV: ${deliverables}`);
  console.log(`Elapsed: ${((performance.now() - started) / 1000).toFixed(2)} s`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
