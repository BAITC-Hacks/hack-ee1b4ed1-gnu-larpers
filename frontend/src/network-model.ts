import { roles, type EdgeRow, type GraphData, type NodeRow } from './types';

export interface GraphNode {
  id: string;
  label: string;
  color: string;
  size: number;
  kind: 'group' | 'client';
  gid?: string;
  clusterId: number;
  seed?: boolean;
  boundary?: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sumMinor: number;
  transfers: number;
  links: number;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function groupGraph(data: GraphData): GraphModel {
  const nodes: GraphNode[] = data.clusters.map(group => ({
    id: `group:${group.cluster_id}`,
    label: `Группа ${group.cluster_id + 1}`,
    color: '#a989ff',
    size: Math.min(82, 28 + Math.sqrt(group.n_nodes) * 2.5),
    kind: 'group',
    clusterId: group.cluster_id,
    seed: group.n_seed > 0,
  }));
  const nodeIds = new Set(nodes.map(node => node.id));
  const groups = new Map(data.nodes.map(node => [node.gid, node.cluster_id]));
  const routes = new Map<string, GraphEdge>();
  for (const edge of data.edges) {
    const src = groups.get(edge.src);
    const dst = groups.get(edge.dst);
    if (src === undefined || dst === undefined || src === dst) continue;
    const source = `group:${src}`;
    const target = `group:${dst}`;
    if (!nodeIds.has(source) || !nodeIds.has(target)) continue;
    const id = `g:${JSON.stringify([source, target])}`;
    const route = routes.get(id) ?? { id, source, target, sumMinor: 0, transfers: 0, links: 0 };
    route.sumMinor += edge.sum_minor;
    route.transfers += edge.n_tx;
    route.links += 1;
    routes.set(id, route);
  }
  return { nodes, edges: [...routes.values()] };
}

export function clientGraph(nodes: NodeRow[], edges: EdgeRow[]): GraphModel {
  const graphNodes: GraphNode[] = nodes.map(node => ({
    id: `node:${node.gid}`,
    label: node.gid.length > 11 ? `…${node.gid.slice(-8)}` : node.gid,
    color: roles[node.role].color,
    size: Math.min(35, 10 + Math.log2(1 + node.in_deg + node.out_deg) * 3),
    kind: 'client',
    gid: node.gid,
    clusterId: node.cluster_id,
    seed: node.is_seed,
    boundary: node.truncated_by_depth,
  }));
  const nodeIds = new Set(nodes.map(node => node.gid));
  const graphEdges: GraphEdge[] = edges
    .filter(edge => nodeIds.has(edge.src) && nodeIds.has(edge.dst))
    .map(edge => ({
      id: `c:${JSON.stringify([edge.src, edge.dst])}`,
      source: `node:${edge.src}`,
      target: `node:${edge.dst}`,
      sumMinor: edge.sum_minor,
      transfers: edge.n_tx,
      links: 1,
    }));
  return { nodes: graphNodes, edges: graphEdges };
}

export function graphNeighborhood(model: GraphModel, selectedId: string): Set<string> {
  const ids = new Set(model.nodes.map(node => node.id));
  if (!ids.has(selectedId)) return new Set();
  const neighbors = new Set([selectedId]);
  for (const edge of model.edges) {
    if (edge.source === selectedId && ids.has(edge.target)) neighbors.add(edge.target);
    if (edge.target === selectedId && ids.has(edge.source)) neighbors.add(edge.source);
  }
  return neighbors;
}
