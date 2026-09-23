import type { NodeRow } from './types';

export const priorityFactors = [
  { key: 'betweenness', label: 'Посредничество', basis: 'Перцентиль посредничества', weight: 0.25 },
  { key: 'turnover', label: 'Оборот', basis: 'Перцентиль суммарного оборота', weight: 0.20 },
  { key: 'transactions', label: 'Число переводов', basis: 'Перцентиль числа переводов', weight: 0.15 },
  { key: 'seed_sources', label: 'Связь с исходными', basis: 'До 5 исходных источников', weight: 0.15 },
  { key: 'role_support', label: 'Поддержка роли', basis: 'Оценка роли после поправок', weight: 0.15 },
  { key: 'temporal', label: 'Продолжение по датам', basis: 'Доля сопоставленного исходящего объёма', weight: 0.10 },
] as const;

type FactorKey = (typeof priorityFactors)[number]['key'];
type Components = Record<FactorKey, number>;

export function priorityComponentsForNode(node: NodeRow): Record<string, number> | null {
  if (node.priority_components && Object.keys(node.priority_components).length) return node.priority_components;

  const { betweenness_percentile, turnover_percentile, tx_percentile } = node;
  if ([betweenness_percentile, turnover_percentile, tx_percentile].some(value =>
    typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) return null;

  const components: Components = {
    betweenness: 0.25 * betweenness_percentile!,
    turnover: 0.20 * turnover_percentile!,
    transactions: 0.15 * tx_percentile!,
    seed_sources: 0.15 * Math.min(1, node.seed_sources / 5),
    role_support: 0.15 * node.role_score,
    temporal: node.is_seed ? 0 : 0.10 * (node.following_days_out_share ?? 0),
  };
  if (node.in_deg + node.out_deg === 0) {
    for (const factor of priorityFactors) components[factor.key] = 0;
  }
  const total = Object.values(components).reduce((sum, value) => sum + value, 0);
  return Math.abs(total - node.priority_score) <= 0.00001 ? components : null;
}
