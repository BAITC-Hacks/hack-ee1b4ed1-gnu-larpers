import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphModel, GraphNode } from './network-model';
import { createSphereLayout } from './sphere-model';

function node(id: string, clusterId = 0): GraphNode {
  return { id, gid: id, clusterId, label: id, color: '#a989ff', size: 10, kind: 'client' };
}

function edge(id: string, source: string, target: string): GraphEdge {
  return { id, source, target, sumMinor: 123456789, transfers: 5, links: 1 };
}

function indexedPositions(model: GraphModel) {
  const { positions } = createSphereLayout(model);
  return new Map(model.nodes.map((item, index) => [item.id, [...positions.slice(index * 3, index * 3 + 3)]]));
}

describe('static sphere layout', () => {
  it('handles empty and single-node scopes', () => {
    expect(createSphereLayout({ nodes: [], edges: [] })).toEqual({ positions: new Float32Array(), radius: 0 });
    const single = createSphereLayout({ nodes: [node('only')], edges: [] });
    expect([...single.positions]).toEqual([0, 0, 0]);
    expect(single.radius).toBeGreaterThan(0);
  });

  it('occupies all three dimensions on a bounded spherical surface', () => {
    const nodes = Array.from({ length: 240 }, (_, index) => node(`client:${index}`, index % 6));
    const { positions, radius } = createSphereLayout({ nodes, edges: [] });
    expect(positions).toHaveLength(nodes.length * 3);
    expect([...positions].every(Number.isFinite)).toBe(true);
    for (let index = 0; index < nodes.length; index += 1) {
      const length = Math.hypot(...positions.slice(index * 3, index * 3 + 3));
      expect(Math.abs(length - radius)).toBeLessThan(radius * 0.000001);
    }
    for (let axis = 0; axis < 3; axis += 1) {
      const values = nodes.map((_node, index) => positions[index * 3 + axis]);
      expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(radius * 1.8);
    }
  });

  it('indexes positions by original input order while retaining adjacent int64 identities', () => {
    const first = 'node:9223372036854775806';
    const second = 'node:9223372036854775807';
    const model = { nodes: [node(first), node(second), node('isolated', 1)], edges: [edge('ab', first, second), edge('ba', second, first), edge('aa', first, first)] };
    const original = indexedPositions(model);
    const reordered = indexedPositions({ nodes: [...model.nodes].reverse(), edges: [...model.edges].reverse() });
    expect(original.get(first)).not.toEqual(original.get(second));
    expect(reordered).toEqual(original);
    expect(original.size).toBe(3);
  });

  it('keeps positions reproducible for large reordered inputs', () => {
    const nodes = Array.from({ length: 1200 }, (_, index) => node(`node:${9007199254740993n + BigInt(index)}`, index % 17));
    const edges = nodes.slice(1).map((item, index) => edge(`e${index}`, nodes[index].id, item.id));
    const first = indexedPositions({ nodes, edges });
    const second = indexedPositions({ nodes: [...nodes].reverse(), edges: [...edges].reverse() });
    expect(second).toEqual(first);
  });

  it('gives each community a spatially coherent part of the sphere', () => {
    const model = { nodes: Array.from({ length: 240 }, (_, index) => node(`client:${index}`, Math.floor(index / 60))), edges: [] };
    const { positions } = createSphereLayout(model);
    const centers = Array.from({ length: 4 }, (_, clusterId) => {
      const points = model.nodes.flatMap((item, index) => item.clusterId === clusterId ? [[...positions.slice(index * 3, index * 3 + 3)]] : []);
      return [0, 1, 2].map(axis => points.reduce((sum, point) => sum + point[axis], 0) / points.length);
    });
    let nearerOwn = 0;
    model.nodes.forEach((item, index) => {
      const point = positions.slice(index * 3, index * 3 + 3);
      const distances = centers.map(center => Math.hypot(...center.map((coordinate, axis) => point[axis] - coordinate)));
      if (distances[item.clusterId] === Math.min(...distances)) nearerOwn += 1;
    });
    expect(nearerOwn / model.nodes.length).toBeGreaterThan(0.95);
  });

  it('ignores dangling edges and never mutates source identities or values', () => {
    const model = { nodes: [node('a'), node('b'), node('isolated', 2)], edges: [edge('ab', 'a', 'b')] };
    const original = structuredClone(model);
    const expected = createSphereLayout(model);
    const dangling = createSphereLayout({ nodes: model.nodes, edges: [...model.edges, edge('ax', 'a', 'missing'), edge('xb', 'missing', 'b')] });
    expect(dangling).toEqual(expected);
    expected.positions[0] = 123;
    expect(model).toEqual(original);
  });
});
