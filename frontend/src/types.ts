export type Role = 'consolidator' | 'transit' | 'distributor' | 'terminal' | 'coordinator' | 'peripheral';

export interface NodeRow {
  gid: string;
  depth: number;
  is_seed: boolean;
  role: Role;
  role_score: number;
  role_candidates?: { role: Role; score: number }[];
  role_margin?: number | null;
  priority_components?: Record<string, number>;
  betweenness_percentile?: number;
  turnover_percentile?: number;
  tx_percentile?: number;
  cluster_id: number;
  priority_score: number;
  evidence: string;
  role_status: string;
  flags: string[];
  in_deg: number;
  out_deg: number;
  in_kzt: number;
  out_kzt: number;
  in_tx: number;
  out_tx: number;
  in_minor: number;
  out_minor: number;
  seed_sources: number;
  active_days: number;
  same_day_activity_days: number;
  following_days_out_share: number | null;
  following_days_matched_minor: number;
  window_days: number;
  truncated_by_depth: boolean;
  cycle_component_size: number;
  neighbor_clusters: number;
  pass_through: number | null;
}

export interface EdgeRow {
  src: string;
  dst: string;
  sum_kzt: number;
  sum_minor: number;
  n_tx: number;
  depth: number;
}

export interface ClusterRow {
  cluster_id: number;
  n_nodes: number;
  n_seed: number;
  sum_kzt_internal: number;
  top_gids: string[];
  hypothesis: string;
}

export interface Transaction {
  src: string;
  dst: string;
  date: string;
  sum_kzt: number;
  sum_minor: number;
}

export interface DailyRow {
  gid: string;
  date: string;
  in_minor: number;
  out_minor: number;
  in_tx: number;
  out_tx: number;
}

export interface GraphData {
  metadata: {
    analysis_id?: string;
    dataset_sha256?: string;
    schema_version: number;
    n_nodes: number;
    n_edges: number;
    n_transactions: number;
    n_clusters: number;
    n_seed: number;
    n_boundary: number;
    n_isolated: number;
    sum_minor: number;
    date_from: string | null;
    date_to: string | null;
    parameters: { window_days: number; resolution: number; random_seed: number };
  };
  nodes: NodeRow[];
  edges: EdgeRow[];
  clusters: ClusterRow[];
  top_nodes: { rank: number; gid: string; role: Role; priority_score: number; why: string }[];
  transactions: Transaction[];
  daily_flows: DailyRow[];
}

export const roles: Record<Role, { label: string; color: string; description: string }> = {
  consolidator: { label: 'Сборщик', color: '#e5b879', description: 'Концентрирует поступления от нескольких клиентов.' },
  distributor: { label: 'Распределитель', color: '#a989ff', description: 'Отправляет средства множеству получателей.' },
  transit: { label: 'Транзит', color: '#78c6ce', description: 'Объёмы и даты совместимы с передачей средств дальше.' },
  terminal: { label: 'Конечный узел', color: '#e79aa8', description: 'Дальнейших исходящих переводов в выборке не видно.' },
  coordinator: { label: 'Связующий узел', color: '#c7a4f6', description: 'Соединяет разные части наблюдаемого графа.' },
  peripheral: { label: 'Периферия', color: '#858198', description: 'Мало связей или недостаточно наблюдений для другой роли.' },
};
