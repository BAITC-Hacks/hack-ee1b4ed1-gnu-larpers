import { MultiDirectedGraph } from 'graphology';
import type { GraphModel } from './network-model';

export interface SigmaNodeAttributes {
  x: number;
  y: number;
  label: string;
  gid?: string;
  roleColor: string;
  color: string;
  size: number;
  clusterId: number;
  kind: 'group' | 'client';
  seed: boolean;
  boundary: boolean;
}

export interface SigmaEdgeAttributes {
  sumMinor: number;
  transfers: number;
  links: number;
  color: string;
  size: number;
  type: string;
}

function hashId(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  }
  return hash >>> 0;
}

export function createSigmaGraph(model: GraphModel): MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes> {
  const graph = new MultiDirectedGraph<SigmaNodeAttributes, SigmaEdgeAttributes>();
  const nodes = model.nodes.map(node => ({ node, hash: hashId(node.id) }))
    .sort((a, b) => a.hash - b.hash || (a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0));
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (const [index, { node, hash }] of nodes.entries()) {
    const radius = Math.sqrt(index + 0.5) * 14;
    const angle = index * goldenAngle + hash / 4294967296 * 0.15;
    graph.addNode(node.id, {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      label: node.label,
      gid: node.gid,
      roleColor: node.color,
      color: '#9e99a8',
      size: 2.5,
      clusterId: node.clusterId,
      kind: node.kind,
      seed: node.seed ?? false,
      boundary: node.boundary ?? false,
    });
  }
  for (const edge of model.edges) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
    graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, {
      sumMinor: edge.sumMinor,
      transfers: edge.transfers,
      links: edge.links,
      color: '#3a3742',
      size: 0.5,
      type: 'line',
    });
  }
  const communities = new Map<number, { id: string; hash: number; degree: number }[]>();
  graph.forEachNode((id, attributes) => {
    const degree = graph.degree(id);
    graph.setNodeAttribute(id, 'size', Math.min(7, 2.5 + Math.log2(degree + 1) * 0.65));
    if (attributes.kind !== 'client') return;
    const members = communities.get(attributes.clusterId) ?? [];
    members.push({ id, hash: hashId(id), degree });
    communities.set(attributes.clusterId, members);
  });
  if (communities.size > 1) {
    const ordered = [...communities].sort(([firstId, first], [secondId, second]) => second.length - first.length || firstId - secondId);
    let occupied = 0;
    for (const [index, [, members]] of ordered.entries()) {
      const centerRadius = Math.sqrt(occupied + members.length / 2) * 22;
      const centerAngle = index * goldenAngle;
      const centerX = Math.cos(centerAngle) * centerRadius;
      const centerY = Math.sin(centerAngle) * centerRadius;
      occupied += members.length;
      members.sort((a, b) => b.degree - a.degree || a.hash - b.hash || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      for (const [memberIndex, member] of members.entries()) {
        const radius = Math.sqrt(memberIndex) * 8;
        const angle = memberIndex * goldenAngle + member.hash / 4294967296 * 0.15;
        graph.mergeNodeAttributes(member.id, {
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius,
        });
      }
    }
  }
  return graph;
}
