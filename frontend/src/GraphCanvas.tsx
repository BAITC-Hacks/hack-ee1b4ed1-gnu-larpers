import { useEffect, useRef, useState } from 'react';
import cytoscape, { type Core, type Layouts, type NodeSingular, type StylesheetStyle } from 'cytoscape';
import { Expand, LocateFixed, Minus, Plus } from 'lucide-react';
import { graphNeighborhood, layoutElements, type GraphModel } from './network-model';
import { number, shortMoney } from './format';

const style: StylesheetStyle[] = [
  { selector: 'node', style: {
    width: 'data(size)', height: 'data(size)', 'background-color': 'data(color)',
    label: 'data(label)', color: '#e7e5eb', 'font-size': 12, 'font-family': 'sans-serif',
    'text-valign': 'bottom', 'text-margin-y': 8, 'text-background-color': '#18181c',
    'text-background-opacity': 0.94, 'text-background-padding': '3px',
    'border-color': '#18181c', 'border-width': 2, 'overlay-opacity': 0,
    'min-zoomed-font-size': 9,
  } },
  { selector: 'node[kind = "group"]', style: {
    'font-size': 14, 'font-weight': 600, 'border-color': '#cfb9ee', 'border-width': 1.5,
    color: '#23162f',
    'text-wrap': 'wrap', 'text-max-width': '140px', 'min-zoomed-font-size': 0,
    'text-valign': 'center', 'text-margin-y': 0, 'text-background-opacity': 0,
  } },
  { selector: 'node[kind = "client"][?seed]', style: { 'border-color': '#f0d8a6', 'border-width': 3 } },
  { selector: 'node[?boundary]', style: { 'border-style': 'dashed' } },
  { selector: 'edge', style: {
    width: 'data(width)', 'line-color': '#82778e', 'target-arrow-color': '#82778e',
    'target-arrow-shape': 'triangle', 'arrow-scale': 0.8, 'curve-style': 'bezier',
    opacity: 0.3, 'overlay-opacity': 0,
  } },
  { selector: '.muted', style: { opacity: 0.12, 'text-opacity': 0 } },
  { selector: 'node.neighbor', style: { label: 'data(label)', 'min-zoomed-font-size': 0, 'z-index': 3 } },
  { selector: 'edge.incoming', style: { 'line-color': '#83c7cc', 'target-arrow-color': '#83c7cc', opacity: 0.95, 'z-index': 4 } },
  { selector: 'edge.outgoing', style: { 'line-color': '#c1a1ed', 'target-arrow-color': '#c1a1ed', opacity: 0.95, 'z-index': 4 } },
  { selector: 'node.chosen', style: {
    label: 'data(label)', 'border-color': '#faf4ff', 'border-width': 4,
    'font-weight': 700, 'min-zoomed-font-size': 0, 'z-index': 10,
    'underlay-color': '#b59cdb', 'underlay-opacity': 0.18, 'underlay-padding': 9,
  } },
  { selector: 'node.zoom-label-hidden', style: { label: '' } },
  { selector: '.filtered', style: { display: 'none' } },
];

function positionLargeGraph(graph: Core) {
  const groups = new Map<number, ReturnType<Core['nodes']>>();
  graph.nodes().forEach(node => {
    const id = Number(node.data('clusterId'));
    groups.set(id, (groups.get(id) ?? graph.collection()).union(node));
  });
  const ordered = [...groups.entries()].sort(([a], [b]) => a - b);
  const width = Math.sqrt(ordered.reduce((sum, [, nodes]) => sum + (Math.sqrt(nodes.length) * 70 + 140) ** 2, 0)) * 1.3;
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const [, nodes] of ordered) {
    const radius = Math.max(50, Math.sqrt(nodes.length) * 35);
    const size = radius * 2 + 140;
    if (x > 0 && x + size > width) { x = 0; y += rowHeight; rowHeight = 0; }
    nodes.sort((a, b) => b.degree() - a.degree() || a.id().localeCompare(b.id())).forEach((node, index) => {
      const distance = radius * Math.sqrt(index / Math.max(1, nodes.length - 1));
      const angle = index * Math.PI * (3 - Math.sqrt(5));
      node.position({ x: x + size / 2 + Math.cos(angle) * distance, y: y + size / 2 + Math.sin(angle) * distance });
    });
    x += size;
    rowHeight = Math.max(rowHeight, size);
  }
}

function separateGroups(graph: Core) {
  for (let pass = 0; pass < 5; pass += 1) {
    const points = graph.nodes().map(node => ({ node, ...node.position(), radius: Math.max(Number(node.data('size')), 18 / graph.zoom()) / 2 }));
    const gap = 7 / graph.zoom();
    for (let iteration = 0; iteration < 35; iteration += 1) {
      let moved = false;
      for (let first = 0; first < points.length; first += 1) {
        for (let second = first + 1; second < points.length; second += 1) {
          const a = points[first];
          const b = points[second];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.hypot(dx, dy);
          const minimum = a.radius + b.radius + gap;
          if (distance >= minimum) continue;
          const shift = (minimum - distance) / 2;
          const x = distance > 0 ? dx / distance : 1;
          const y = distance > 0 ? dy / distance : 0;
          a.x -= x * shift; a.y -= y * shift;
          b.x += x * shift; b.y += y * shift;
          moved = true;
        }
      }
      if (!moved) break;
    }
    graph.batch(() => points.forEach(({ node, x, y }) => node.position({ x, y })));
    graph.fit(undefined, 45);
  }
}

export default function GraphCanvas({ model, selectedId, neighborsOnly, focusRequest, onSelect }: {
  model: GraphModel;
  selectedId: string;
  neighborsOnly: boolean;
  focusRequest: number;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Core | null>(null);
  const onSelectRef = useRef(onSelect);
  const layoutBusyRef = useRef(false);
  const pendingFocusRef = useRef(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [tooltip, setTooltip] = useState<{ title: string; detail: string } | null>(null);
  const [layingOut, setLayingOut] = useState(false);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const graph = cytoscape({
      container, elements: [], style, minZoom: 0.025, maxZoom: 4,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      boxSelectionEnabled: false, autounselectify: true,
    });
    graphRef.current = graph;
    graph.on('tap', 'node', event => onSelectRef.current(event.target.id()));
    graph.on('tap', event => { if (event.target === graph) onSelectRef.current(''); });
    graph.on('mouseover', 'node, edge', event => {
      const element = event.target;
      container.style.cursor = element.isNode() ? 'pointer' : 'default';
      setTooltip(element.isNode()
        ? { title: element.data('gid') || element.data('label'), detail: 'Нажмите, чтобы выделить прямые связи' }
        : { title: `${element.source().data('label')} → ${element.target().data('label')}`, detail: `${shortMoney(element.data('sumMinor') / 100)} · ${number.format(element.data('transfers'))} переводов` });
    });
    graph.on('mouseout', 'node, edge', () => { container.style.cursor = 'grab'; setTooltip(null); });
    graph.on('zoom', () => {
      setZoomLevel(graph.zoom());
      const hide = graph.nodes().length > 100 && graph.zoom() < 0.85;
      graph.batch(() => {
        graph.nodes('[kind = "client"]').not('.chosen, .neighbor').toggleClass('zoom-label-hidden', hide);
        graph.nodes('[kind = "client"]').style({ 'font-size': Math.max(12, 10 / graph.zoom()) });
        graph.nodes('[kind = "group"]').style({
          'font-size': Math.max(14, 10 / graph.zoom()),
          label: (node: NodeSingular) => String(Number(node.data('clusterId')) + 1),
          'text-valign': 'center', 'text-margin-y': 0,
          width: (node: NodeSingular) => Math.max(Number(node.data('size')), 18 / graph.zoom()),
          height: (node: NodeSingular) => Math.max(Number(node.data('size')), 18 / graph.zoom()),
        });
      });
    });
    let previousWidth = container.clientWidth;
    let previousHeight = container.clientHeight;
    const observer = new ResizeObserver(() => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      graph.resize();
      if (previousWidth && previousHeight) graph.panBy({ x: (width - previousWidth) / 2, y: (height - previousHeight) / 2 });
      previousWidth = width;
      previousHeight = height;
    });
    observer.observe(container);
    return () => { observer.disconnect(); graph.destroy(); graphRef.current = null; };
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    setTooltip(null);
    setLayingOut(true);
    layoutBusyRef.current = true;
    let cancelled = false;
    let layout: Layouts | undefined;
    const complete = () => {
      if (cancelled || graph.destroyed()) return;
      if (model.nodes[0]?.kind === 'group') separateGroups(graph);
      if (graph.zoom() > 1.25) graph.zoom(1.25).center();
      setZoomLevel(graph.zoom());
      layoutBusyRef.current = false;
      setLayingOut(false);
      if (pendingFocusRef.current) { focus(); pendingFocusRef.current = false; }
    };
    graph.batch(() => { graph.elements().remove(); graph.add(layoutElements(model)); });
    const frame = requestAnimationFrame(() => {
      if (model.nodes.length > 400) {
        graph.batch(() => positionLargeGraph(graph));
        graph.fit(undefined, 55);
        complete();
      } else if (model.nodes.length > 0) {
        layout = graph.layout({
          name: 'cose', animate: model.nodes.length > 120, refresh: 10, animationThreshold: 250,
          randomize: false, fit: true, padding: 55,
          nodeRepulsion: () => 16000, idealEdgeLength: () => 110,
          nodeOverlap: 20, componentSpacing: 100, numIter: 450,
          nodeDimensionsIncludeLabels: true, stop: complete,
        });
        layout.run();
      } else complete();
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); layout?.stop(); layoutBusyRef.current = false; };
  }, [model]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    const neighborhood = graphNeighborhood(model, selectedId);
    const active = neighborhood.size > 0;
    graph.batch(() => {
      graph.elements().removeClass('chosen neighbor muted incoming outgoing filtered zoom-label-hidden');
      graph.nodes().forEach(node => {
        const connected = neighborhood.has(node.id());
        node.toggleClass('chosen', node.id() === selectedId);
        node.toggleClass('neighbor', connected && node.id() !== selectedId);
        node.toggleClass('muted', active && !connected);
        node.toggleClass('filtered', active && neighborsOnly && !connected);
        node.toggleClass('zoom-label-hidden', node.data('kind') === 'client' && model.nodes.length > 100 && graph.zoom() < 0.85 && !connected);
      });
      graph.edges().forEach(edge => {
        const incoming = edge.target().id() === selectedId;
        const outgoing = edge.source().id() === selectedId;
        edge.toggleClass('incoming', incoming);
        edge.toggleClass('outgoing', outgoing);
        edge.toggleClass('muted', active && !incoming && !outgoing);
        edge.toggleClass('filtered', active && neighborsOnly && !incoming && !outgoing);
      });
    });
  }, [model, selectedId, neighborsOnly]);

  function focus() {
    const graph = graphRef.current;
    if (!graph) return;
    const elements = graph.elements().filter(element => element.hasClass('chosen') || element.hasClass('neighbor') || element.hasClass('incoming') || element.hasClass('outgoing'));
    if (!elements.length) return;
    graph.fit(elements, 70);
    if (graph.zoom() > 1.6) graph.zoom(1.6).center(elements);
  }

  useEffect(() => {
    if (!focusRequest) return;
    pendingFocusRef.current = true;
    const frame = requestAnimationFrame(() => {
      if (!layoutBusyRef.current) { focus(); pendingFocusRef.current = false; }
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);

  const zoom = (factor: number) => {
    const graph = graphRef.current;
    if (graph) graph.zoom({ level: Math.min(graph.maxZoom(), Math.max(graph.minZoom(), graph.zoom() * factor)), renderedPosition: { x: graph.width() / 2, y: graph.height() / 2 } });
  };

  return <div className="explorer-canvas">
    <div ref={containerRef} className="explorer-canvas-surface" role="img" aria-label={`Граф: ${model.nodes.length} узлов, ${model.edges.length} направленных связей. Для выбора с клавиатуры используйте поиск и список рядом.`} />
    {layingOut && <div className="explorer-layout-status" role="status">Располагаем узлы по связям…</div>}
    {!model.nodes.length && <div className="graph-empty">По этим фильтрам клиентов нет. Измените группу или роль.</div>}
    {tooltip && <div className="explorer-tooltip"><strong>{tooltip.title}</strong><span>{tooltip.detail}</span></div>}
    <div className="explorer-controls">
      <button type="button" aria-label="Увеличить граф" title="Увеличить" onClick={() => zoom(1.35)}><Plus size={17} /></button>
      <span aria-label="Масштаб графа">{Math.round(zoomLevel * 100)}%</span>
      <button type="button" aria-label="Уменьшить граф" title="Уменьшить" onClick={() => zoom(1 / 1.35)}><Minus size={17} /></button>
      <button type="button" aria-label="Вписать граф в экран" title="Вписать граф в экран" onClick={() => graphRef.current?.fit(graphRef.current.elements(':visible'), 55)}><Expand size={17} /></button>
      <button type="button" aria-label="Приблизить выбранный узел и соседей" title="Приблизить выбранный узел и соседей" disabled={!selectedId} onClick={focus}><LocateFixed size={17} /></button>
    </div>
    <div className="explorer-gesture-hint">Тяните фон для перемещения · колесо для масштаба</div>
  </div>;
}
