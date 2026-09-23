import { describe, expect, it } from 'vitest';
import { priorityComponentsForNode } from './priority';
import type { NodeRow } from './types';

const legacyNode = {
  priority_score: 0.5,
  betweenness_percentile: 0.4,
  turnover_percentile: 0.5,
  tx_percentile: 0.8,
  seed_sources: 2,
  role_score: 0.6,
  following_days_out_share: 0.3,
  is_seed: false,
  in_deg: 1,
  out_deg: 1,
} as NodeRow;

describe('priority breakdown', () => {
  it('uses the authoritative exported contributions when present', () => {
    const exported = { betweenness: 0.1, turnover: 0.4 };
    expect(priorityComponentsForNode({ ...legacyNode, priority_components: exported })).toBe(exported);
  });

  it('reconstructs weighted contributions from a legacy graph only when they match the score', () => {
    const result = priorityComponentsForNode(legacyNode);
    expect(result).not.toBeNull();
    expect(result?.betweenness).toBeCloseTo(0.1);
    expect(result?.turnover).toBeCloseTo(0.1);
    expect(result?.transactions).toBeCloseTo(0.12);
    expect(result?.seed_sources).toBeCloseTo(0.06);
    expect(result?.role_support).toBeCloseTo(0.09);
    expect(result?.temporal).toBeCloseTo(0.03);
    expect(Object.values(result ?? {}).reduce((sum, value) => sum + value, 0)).toBeCloseTo(legacyNode.priority_score);
    expect(priorityComponentsForNode({ ...legacyNode, priority_score: 0.51 })).toBeNull();
  });

  it('removes the temporal contribution for seed clients and all contributions for isolated clients', () => {
    expect(priorityComponentsForNode({ ...legacyNode, is_seed: true, priority_score: 0.47 })?.temporal).toBe(0);
    const isolated = priorityComponentsForNode({ ...legacyNode, in_deg: 0, out_deg: 0, priority_score: 0 });
    expect(isolated && Object.values(isolated).every(value => value === 0)).toBe(true);
  });
});
