import { describe, expect, it } from 'vitest';
import { validateDataset } from './data';
import { analyze } from './model';
import type { Dataset } from './types';

const a = '100000000343175100';
const b = '100000000456947100';
const c = '100000000580561100';
const d = '100000000712340100';
const e = '100000000823450100';
const f = '100000000934560100';
const isolated = '100000001045670100';

function fixture(): Dataset {
  const pairs = [[a, b], [a, c], [c, d], [d, e], [e, f]];
  return {
    nodes: [
      { gid: a, depth: 0, is_seed: true },
      { gid: b, depth: 1, is_seed: false },
      { gid: c, depth: 1, is_seed: false },
      { gid: d, depth: 2, is_seed: false },
      { gid: e, depth: 3, is_seed: false },
      { gid: f, depth: 4, is_seed: false },
      { gid: isolated, depth: 0, is_seed: true },
    ],
    edges: pairs.map(([src, dst], index) => ({ src, dst, sum_kzt: 10_000, n_tx: 1, depth: Math.min(index + 1, 4) })),
    transactions: pairs.map(([src, dst], index) => ({ src, dst, date: `2026-07-${String(index + 1).padStart(2, '0')}`, sum_kzt: 10_000 })),
  };
}

describe('money graph analysis', () => {
  it('keeps exact 18-digit IDs, isolated seeds and the fourth-hop boundary', () => {
    const dataset = fixture();
    validateDataset(dataset);
    const result = analyze(dataset);
    expect(result.nodes).toHaveLength(dataset.nodes.length);
    expect(result.nodes.find((node) => node.gid === b)?.role).toBe('terminal');
    expect(result.nodes.find((node) => node.gid === f)?.role).not.toBe('terminal');
    expect(result.nodes.find((node) => node.gid === f)?.flags).toContain('Граница обхода: исходящие переводы неизвестны');
    expect(result.nodes.find((node) => node.gid === isolated)?.cluster_id).toBeGreaterThan(0);
    expect(result.clusters.reduce((sum, cluster) => sum + cluster.n_nodes, 0)).toBe(dataset.nodes.length);
    expect(JSON.stringify(result)).toContain(`"gid":"${a}"`);
  });

  it('returns the same communities, roles and ranks on repeated runs', () => {
    const dataset = fixture();
    expect(analyze(dataset)).toEqual(analyze(dataset));
  });

  it('rejects an edge when its transaction total is inconsistent', () => {
    const dataset = fixture();
    dataset.edges[0].sum_kzt += 1;
    expect(() => validateDataset(dataset)).toThrow('Edge and transactions differ');
  });
});
