import { describe, expect, it } from 'vitest';
import { createSigmaGraph } from './sigma-model';
import type { GraphEdge, GraphModel, GraphNode } from './network-model';

function node(id: string, clusterId = 0): GraphNode {
  return { id, gid: id, clusterId, label: id.slice(-8), color: '#e5b879', size: 20, kind: 'client' };
}

function edge(id: string, source: string, target: string, sumMinor = 101): GraphEdge {
  return { id, source, target, sumMinor, transfers: 2, links: 1 };
}

describe('Sigma graph model', () => {
  it('preserves string identifiers, directions, reciprocal edges, parallel edges and self-transfers', () => {
    const a = 'node:9223372036854775806';
    const b = 'node:9223372036854775807';
    const model: GraphModel = {
      nodes: [node(a), node(b), node('isolated', 8)],
      edges: [edge('ab', a, b, 101), edge('ba', b, a, 203), edge('aa', a, a, 307), edge('ab-second', a, b, 409)],
    };
    const graph = createSigmaGraph(model);

    expect(graph.type).toBe('directed');
    expect(graph.multi).toBe(true);
    expect(graph.order).toBe(3);
    expect(graph.size).toBe(4);
    expect(graph.nodes().sort()).toEqual(model.nodes.map(item => item.id).sort());
    expect(graph.edges()).toEqual(['ab', 'ba', 'aa', 'ab-second']);
    for (const item of model.edges) {
      expect(graph.extremities(item.id)).toEqual([item.source, item.target]);
      expect(graph.getEdgeAttributes(item.id)).toMatchObject({ sumMinor: item.sumMinor, transfers: 2, links: 1 });
    }
    expect(graph.reduceEdges((sum, _id, attrs) => sum + attrs.sumMinor, 0)).toBe(1020);
    expect(graph.degree('isolated')).toBe(0);
    expect(graph.getNodeAttribute('isolated', 'size')).toBe(2.5);
  });

  it('filters only dangling edges and computes size from the retained graph', () => {
    const graph = createSigmaGraph({
      nodes: [node('a'), node('b')],
      edges: [edge('ab', 'a', 'b'), edge('ax', 'a', 'missing'), edge('xb', 'missing', 'b')],
    });

    expect(graph.edges()).toEqual(['ab']);
    expect(graph.getNodeAttribute('a', 'size')).toBe(3.15);
    expect(graph.getNodeAttribute('b', 'size')).toBe(3.15);
  });

  it('preserves presentation metadata without changing source objects', () => {
    const model: GraphModel = {
      nodes: [{ ...node('a', 7), label: '…client-a', seed: true, boundary: true }, node('b', 4)],
      edges: [edge('ab', 'a', 'b')],
    };
    const original = structuredClone(model);
    const graph = createSigmaGraph(model);

    expect(graph.getNodeAttributes('a')).toMatchObject({
      label: '…client-a', gid: 'a', clusterId: 7, kind: 'client',
      seed: true, boundary: true, roleColor: '#e5b879', color: '#9e99a8',
    });
    expect(graph.getEdgeAttributes('ab')).toMatchObject({ color: '#3a3742', size: 0.5, type: 'line' });
    graph.setNodeAttribute('a', 'x', 900);
    graph.setEdgeAttribute('ab', 'sumMinor', 0);
    expect(model).toEqual(original);
  });

  it('starts with deterministic finite positions independent of input order', () => {
    const nodes = Array.from({ length: 300 }, (_, index) => node(`node:${9007199254740993n + BigInt(index)}`, index % 5));
    const edges = nodes.slice(1).map((item, index) => edge(`e${index}`, nodes[0].id, item.id));
    const first = createSigmaGraph({ nodes, edges });
    const second = createSigmaGraph({
      nodes: [...nodes].reverse(),
      edges: [...edges].reverse(),
    });
    const positions = first.mapNodes((_id, attrs) => [attrs.x, attrs.y]);

    expect(positions.every(point => point.every(Number.isFinite))).toBe(true);
    expect(new Set(positions.map(point => JSON.stringify(point))).size).toBe(nodes.length);
    for (const item of nodes) {
      expect(second.getNodeAttribute(item.id, 'x')).toBe(first.getNodeAttribute(item.id, 'x'));
      expect(second.getNodeAttribute(item.id, 'y')).toBe(first.getNodeAttribute(item.id, 'y'));
    }
    expect(second.getNodeAttribute(nodes[0].id, 'size')).toBe(7);
  });

  it('starts known communities apart while keeping their nodes free for force layout', () => {
    const nodes = Array.from({ length: 300 }, (_, index) => node(`client:${index}`, index % 5));
    const graph = createSigmaGraph({ nodes, edges: [] });
    const centers = Array.from({ length: 5 }, (_, clusterId) => {
      const points = graph.filterNodes((_id, attrs) => attrs.clusterId === clusterId).map(id => graph.getNodeAttributes(id));
      return {
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
      };
    });

    graph.forEachNode((_id, attrs) => {
      const own = centers[attrs.clusterId];
      const ownDistance = Math.hypot(attrs.x - own.x, attrs.y - own.y);
      const otherDistance = Math.min(...centers.filter((_center, index) => index !== attrs.clusterId).map(center => Math.hypot(attrs.x - center.x, attrs.y - center.y)));
      expect(ownDistance).toBeLessThan(otherDistance);
      expect(attrs).not.toHaveProperty('fixed');
    });
    expect(graph.order).toBe(300);
    expect(graph.size).toBe(0);
  });

  it('accepts an empty graph', () => {
    const graph = createSigmaGraph({ nodes: [], edges: [] });
    expect(graph.order).toBe(0);
    expect(graph.size).toBe(0);
  });
});
