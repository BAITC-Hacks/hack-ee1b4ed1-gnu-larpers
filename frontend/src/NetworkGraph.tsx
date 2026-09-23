import { useEffect, useRef } from 'react';
import cytoscape, { type Core, type ElementDefinition, type Position } from 'cytoscape';
import { Expand, Minus, Plus } from 'lucide-react';
import { roles, type EdgeRow, type NodeRow } from './types';

interface NetworkGraphProps {
  nodes: NodeRow[];
  edges: EdgeRow[];
  selectedGid: string;
  mode: 'focus' | 'overview';
  onSelect: (gid: string) => void;
}

const shortId = (gid: string) => gid.length > 11 ? `…${gid.slice(-8)}` : gid;
const importance = (node: NodeRow) => node.in_deg + node.out_deg + node.priority_score / 10;

function overviewPositions(nodes: NodeRow[]): Map<string, Position> {
  const clusters = new Map<number, NodeRow[]>();
  for (const node of nodes) {
    const group = clusters.get(node.cluster_id) ?? [];
    group.push(node);
    clusters.set(node.cluster_id, group);
  }
  const groups = [...clusters.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, group]) => ({
      group: group.sort((a, b) => importance(b) - importance(a) || a.gid.localeCompare(b.gid)),
      radius: Math.max(42, Math.sqrt(group.length) * 16),
    }));
  const targetWidth = Math.sqrt(groups.reduce((area, group) => area + (group.radius * 2 + 64) ** 2, 0)) * 1.25;
  const positions = new Map<string, Position>();
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const { group, radius } of groups) {
    const size = radius * 2 + 64;
    if (x > 0 && x + size > targetWidth) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    group.forEach((node, index) => {
      const distance = index === 0 ? 0 : radius * Math.sqrt(index / Math.max(1, group.length - 1));
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      positions.set(node.gid, {
        x: x + size / 2 + Math.cos(angle) * distance,
        y: y + size / 2 + Math.sin(angle) * distance,
      });
    });
    x += size;
    rowHeight = Math.max(rowHeight, size);
  }
  return positions;
}

function focusPositions(nodes: NodeRow[], edges: EdgeRow[], selectedGid: string): Map<string, Position> {
  if (nodes.length === 0) return new Map();
  const center = nodes.find((node) => node.gid === selectedGid) ?? [...nodes].sort((a, b) => importance(b) - importance(a))[0];
  const adjacency = new Map(nodes.map((node) => [node.gid, new Set<string>()]));
  for (const edge of edges) {
    adjacency.get(edge.src)?.add(edge.dst);
    adjacency.get(edge.dst)?.add(edge.src);
  }
  const distances = new Map([[center.gid, 0]]);
  const queue = [center.gid];
  for (let index = 0; index < queue.length; index += 1) {
    const gid = queue[index];
    for (const neighbor of adjacency.get(gid) ?? []) {
      if (!distances.has(neighbor) && adjacency.has(neighbor)) {
        distances.set(neighbor, (distances.get(gid) ?? 0) + 1);
        queue.push(neighbor);
      }
    }
  }
  const levels = new Map<number, NodeRow[]>();
  for (const node of nodes) {
    if (node.gid === center.gid) continue;
    const level = distances.get(node.gid) ?? 3;
    const group = levels.get(level) ?? [];
    group.push(node);
    levels.set(level, group);
  }
  const positions = new Map<string, Position>([[center.gid, { x: 0, y: 0 }]]);
  let previousRadius = 0;
  for (const [level, group] of [...levels.entries()].sort(([a], [b]) => a - b)) {
    group.sort((a, b) => a.cluster_id - b.cluster_id || importance(b) - importance(a) || a.gid.localeCompare(b.gid));
    const radius = Math.max(previousRadius + 115, group.length * 29 / (Math.PI * 2));
    group.forEach((node, index) => {
      const angle = index / group.length * Math.PI * 2 - Math.PI / 2 + level * 0.13;
      positions.set(node.gid, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    });
    previousRadius = radius;
  }
  return positions;
}

export default function NetworkGraph({ nodes, edges, selectedGid, mode, onSelect }: NetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Core | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current) return;
    const graph = cytoscape({
      container: containerRef.current,
      elements: [],
      minZoom: 0.07,
      maxZoom: 4,
      wheelSensitivity: 0.22,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      hideEdgesOnViewport: true,
      boxSelectionEnabled: false,
      autoungrabify: true,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            width: 'data(size)',
            height: 'data(size)',
            label: 'data(label)',
            color: '#e7eee9',
            'font-family': 'Inter, sans-serif',
            'font-size': 10,
            'text-valign': 'bottom',
            'text-margin-y': 7,
            'text-background-color': '#142b25',
            'text-background-opacity': 0.86,
            'text-background-padding': '3px',
            'border-width': 1.5,
            'border-color': '#142b25',
            'overlay-opacity': 0,
          },
        },
        {
          selector: 'node.seed',
          style: { 'border-color': '#f5ecd1', 'border-width': 2.5 },
        },
        {
          selector: 'node.boundary',
          style: { 'border-style': 'dashed', 'border-color': '#bac9c1', 'border-width': 2 },
        },
        {
          selector: 'edge',
          style: {
            width: 'data(width)',
            'line-color': '#537a70',
            'target-arrow-color': '#537a70',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.7,
            'curve-style': 'bezier',
            opacity: 0.48,
            'overlay-opacity': 0,
          },
        },
        {
          selector: 'edge.connected',
          style: { 'line-color': '#d6c59e', 'target-arrow-color': '#d6c59e', opacity: 0.87, 'z-index': 5 },
        },
        {
          selector: 'node.chosen',
          style: {
            label: 'data(shortId)',
            'border-width': 4,
            'border-color': '#fff3cc',
            'border-style': 'solid',
            'font-size': 12,
            'font-weight': 700,
            'text-margin-y': 9,
            'z-index': 10,
            'underlay-color': '#e7cb81',
            'underlay-opacity': 0.13,
            'underlay-padding': 10,
          },
        },
      ],
    });
    graphRef.current = graph;
    graph.on('tap', 'node', (event) => onSelectRef.current(String(event.target.data('gid'))));
    const observer = new ResizeObserver(() => graph.resize());
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      graph.destroy();
      graphRef.current = null;
    };
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const positions = mode === 'overview' ? overviewPositions(nodes) : focusPositions(nodes, edges, selectedGid);
    const ids = new Set(nodes.map((node) => node.gid));
    const elements: ElementDefinition[] = nodes.map((node) => ({
      data: {
        id: `node:${node.gid}`,
        gid: node.gid,
        color: roles[node.role].color,
        shortId: shortId(node.gid),
        label: mode === 'focus' && nodes.length < 35 ? shortId(node.gid) : '',
        size: Math.min(35, 10 + Math.log2(1 + node.in_deg + node.out_deg) * 3 + node.priority_score * 0.035),
      },
      position: positions.get(node.gid),
      classes: [node.is_seed ? 'seed' : '', node.truncated_by_depth ? 'boundary' : '', node.gid === selectedGid ? 'chosen' : ''].filter(Boolean).join(' '),
    }));
    edges.forEach((edge, index) => {
      if (!ids.has(edge.src) || !ids.has(edge.dst)) return;
      elements.push({
        data: {
          id: `edge:${index}`,
          source: `node:${edge.src}`,
          target: `node:${edge.dst}`,
          width: Math.min(3, 0.55 + Math.log10(1 + Math.max(0, edge.sum_kzt)) * 0.2),
        },
        classes: edge.src === selectedGid || edge.dst === selectedGid ? 'connected' : '',
      });
    });
    graph.batch(() => {
      graph.elements().remove();
      graph.add(elements);
    });
    graph.layout({ name: 'preset', fit: true, padding: mode === 'overview' ? 35 : 55, animate: false }).run();
  }, [nodes, edges, selectedGid, mode]);

  const zoom = (factor: number) => {
    const graph = graphRef.current;
    if (graph) graph.zoom({ level: Math.min(graph.maxZoom(), Math.max(graph.minZoom(), graph.zoom() * factor)), renderedPosition: { x: graph.width() / 2, y: graph.height() / 2 } });
  };

  return (
    <div className="network-graph" style={{ position: 'relative', width: '100%', height: '100%', minHeight: 420 }}>
      <div ref={containerRef} role="img" aria-label={`Граф переводов: ${nodes.length} клиентов, ${edges.length} связей. Выберите клиента в списке или нажмите на узел.`} style={{ position: 'absolute', inset: 0 }} />
      {nodes.length === 0 && <div className="graph-empty">По этим фильтрам клиентов не найдено</div>}
      <div className="graph-controls">
        <button className="graph-control" type="button" aria-label="Увеличить граф" title="Увеличить" onClick={() => zoom(1.3)}><Plus size={17} /></button>
        <button className="graph-control" type="button" aria-label="Уменьшить граф" title="Уменьшить" onClick={() => zoom(1 / 1.3)}><Minus size={17} /></button>
        <button className="graph-control" type="button" aria-label="Показать весь граф" title="Показать весь граф" onClick={() => graphRef.current?.fit(undefined, 40)}><Expand size={16} /></button>
      </div>
      <div className="graph-hint">
        <span>● → ● направление перевода</span>
        <span>Нажмите на узел, чтобы изучить связи</span>
      </div>
    </div>
  );
}
