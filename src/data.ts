import { asyncBufferFromFile, parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { join } from 'node:path';
import type { Dataset, InputEdge, InputNode, InputTransaction } from './types';

type RecordRow = Record<string, unknown>;

function number(value: unknown, field: string): number {
  const result = typeof value === 'bigint' ? Number(value) : value;
  if (typeof result !== 'number' || !Number.isFinite(result)) throw new Error(`Invalid ${field}: ${String(value)}`);
  return result;
}

function integer(value: unknown, field: string): number {
  const result = number(value, field);
  if (!Number.isSafeInteger(result)) throw new Error(`Unsafe integer ${field}: ${String(value)}`);
  return result;
}

function identifier(value: unknown, field: string): string {
  const result = String(value);
  if (!/^\d+$/.test(result) || BigInt(result) <= 0n) throw new Error(`Invalid ${field}: ${result}`);
  return result;
}

export function toMinor(value: number): number {
  const minor = Math.round(value * 100);
  if (!Number.isSafeInteger(minor) || Math.abs(value * 100 - minor) > 0.00001 || value < 0) {
    throw new Error(`Invalid KZT amount: ${value}`);
  }
  return minor;
}

function date(value: unknown): string {
  const parsed = value instanceof Date ? value : typeof value === 'number' || typeof value === 'bigint'
    ? new Date(Number(value) * 86_400_000)
    : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid transaction date: ${String(value)}`);
  return parsed.toISOString().slice(0, 10);
}

async function rows(path: string): Promise<RecordRow[]> {
  const result = await parquetReadObjects({ file: await asyncBufferFromFile(path), compressors });
  return result as RecordRow[];
}

export async function loadDataset(directory: string): Promise<Dataset> {
  const [rawNodes, rawEdges, rawTransactions] = await Promise.all([
    rows(join(directory, 'nodes.parquet')),
    rows(join(directory, 'edges.parquet')),
    rows(join(directory, 'transactions.parquet')),
  ]);

  const nodes: InputNode[] = rawNodes.map((row) => ({
    gid: identifier(row.gid, 'gid'),
    depth: integer(row.depth, 'node depth'),
    is_seed: row.is_seed === true,
  }));
  const edges: InputEdge[] = rawEdges.map((row) => ({
    src: identifier(row.src, 'edge src'),
    dst: identifier(row.dst, 'edge dst'),
    sum_kzt: number(row.sum_kzt, 'edge sum_kzt'),
    n_tx: integer(row.n_tx, 'edge n_tx'),
    depth: integer(row.depth, 'edge depth'),
  }));
  const transactions: InputTransaction[] = rawTransactions.map((row) => ({
    src: identifier(row.src, 'transaction src'),
    dst: identifier(row.dst, 'transaction dst'),
    date: date(row.date),
    sum_kzt: number(row.sum_kzt, 'transaction sum_kzt'),
  }));
  const dataset = { nodes, edges, transactions };
  validateDataset(dataset);
  return dataset;
}

export function validateDataset({ nodes, edges, transactions }: Dataset): void {
  if (!nodes.length || !edges.length || !transactions.length) throw new Error('Dataset must contain nodes, edges and transactions');
  const ids = new Set<string>();
  for (const node of nodes) {
    if (ids.has(node.gid)) throw new Error(`Duplicate gid: ${node.gid}`);
    if (node.depth < 0 || node.is_seed !== (node.depth === 0)) throw new Error(`Invalid depth/seed for ${node.gid}`);
    ids.add(node.gid);
  }
  const aggregate = new Map<string, { minor: number; count: number }>();
  for (const tx of transactions) {
    if (!ids.has(tx.src) || !ids.has(tx.dst)) throw new Error(`Unknown transaction endpoint: ${tx.src}→${tx.dst}`);
    const key = `${tx.src}:${tx.dst}`;
    const current = aggregate.get(key) ?? { minor: 0, count: 0 };
    current.minor += toMinor(tx.sum_kzt);
    current.count++;
    aggregate.set(key, current);
  }
  const pairs = new Set<string>();
  for (const edge of edges) {
    if (!ids.has(edge.src) || !ids.has(edge.dst)) throw new Error(`Unknown edge endpoint: ${edge.src}→${edge.dst}`);
    if (edge.src === edge.dst) throw new Error(`Self transfer edge: ${edge.src}`);
    const key = `${edge.src}:${edge.dst}`;
    if (pairs.has(key)) throw new Error(`Duplicate edge pair: ${key}`);
    pairs.add(key);
    const actual = aggregate.get(key);
    if (!actual || actual.minor !== toMinor(edge.sum_kzt) || actual.count !== edge.n_tx) {
      throw new Error(`Edge and transactions differ for ${key}`);
    }
  }
  if (pairs.size !== aggregate.size) throw new Error('Transactions contain pairs absent from edges');
}
