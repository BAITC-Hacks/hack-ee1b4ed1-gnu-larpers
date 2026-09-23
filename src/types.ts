export type Role = 'consolidator' | 'transit' | 'distributor' | 'terminal' | 'coordinator' | 'peripheral';

export interface InputNode {
  gid: string;
  depth: number;
  is_seed: boolean;
}

export interface InputEdge {
  src: string;
  dst: string;
  sum_kzt: number;
  n_tx: number;
  depth: number;
}

export interface InputTransaction {
  src: string;
  dst: string;
  date: string;
  sum_kzt: number;
}

export interface Dataset {
  nodes: InputNode[];
  edges: InputEdge[];
  transactions: InputTransaction[];
}

export interface NodeRow extends InputNode {
  role: Role;
  role_score: number;
  cluster_id: number;
  priority_score: number;
  evidence: string;
  in_deg: number;
  out_deg: number;
  in_kzt: number;
  out_kzt: number;
  in_tx: number;
  out_tx: number;
  seed_sources: number;
  betweenness: number;
  pagerank: number;
  quick_out_share: number | null;
  flags: string[];
}

export interface ClusterRow {
  cluster_id: number;
  n_nodes: number;
  n_seed: number;
  sum_kzt_internal: number;
  top_gids: string;
  hypothesis: string;
}

export interface TopRow {
  rank: number;
  gid: string;
  role: Role;
  priority_score: number;
  why: string;
}

export interface Results {
  nodes: NodeRow[];
  edges: InputEdge[];
  clusters: ClusterRow[];
  top_nodes: TopRow[];
}
