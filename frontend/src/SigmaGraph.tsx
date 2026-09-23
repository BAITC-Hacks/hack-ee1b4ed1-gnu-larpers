import { useEffect, useRef, useState } from 'react';
import { Expand, LocateFixed, Minus, Plus, RotateCw } from 'lucide-react';
import type Sigma from 'sigma';
import type { NodeDisplayData, MouseCoords } from 'sigma/types';
import type { GraphModel } from './network-model';
import { createSigmaGraph, type SigmaEdgeAttributes, type SigmaNodeAttributes } from './sigma-model';
import { groupColor } from './graph-colors';
import './sigma-graph.css';

export interface SigmaGraphProps {
  model: GraphModel;
  selectedId: string;
  neighborsOnly: boolean;
  focusRequest: number;
  onSelect: (id: string) => void;
  colorMode?: 'neutral' | 'roles' | 'groups';
  labels?: boolean;
  evidence?: boolean;
}

type Renderer = Sigma<SigmaNodeAttributes, SigmaEdgeAttributes>;

function drawLabel(context: CanvasRenderingContext2D, data: Pick<NodeDisplayData, 'x' | 'y' | 'size' | 'label' | 'color'>) {
  if (!data.label) return;
  context.font = '11px Inter, system-ui, sans-serif';
  context.textAlign = 'center';
  context.lineJoin = 'round';
  context.lineWidth = 4;
  context.strokeStyle = '#17161d';
  context.strokeText(data.label, data.x, data.y + data.size + 15);
  context.fillStyle = '#c9c5d3';
  context.fillText(data.label, data.x, data.y + data.size + 15);
}

export default function SigmaGraph({ model, selectedId, neighborsOnly, focusRequest, onSelect, colorMode = 'neutral', labels = true, evidence = false }: SigmaGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const loopsRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const focusRef = useRef<() => void>(() => {});
  const updateRef = useRef<(clearHover?: boolean) => void>(() => {});
  const optionsRef = useRef({ selectedId, neighborsOnly, colorMode, labels, evidence, onSelect });
  optionsRef.current = { selectedId, neighborsOnly, colorMode, labels, evidence, onSelect };
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(100);
  const [hovered, setHovered] = useState<SigmaNodeAttributes | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !model.nodes.length) return;
    let disposed = false;
    let renderer: Renderer | undefined;
    let observer: ResizeObserver | undefined;
    let releaseDrag: (() => void) | undefined;
    let hoverId = '';
    let activeId = '';
    let neighborhood = new Set<string>();
    let isolated = new Set<string>();
    let draggedId = '';
    let dragOrigin: { x: number; y: number } | undefined;
    let moved = false;
    let pendingFocus = false;
    const graph = createSigmaGraph(model);
    const measureNodeScale = () => graph.order > 500 ? Math.max(0.45, Math.min(1, container.clientWidth / 900)) : 1;
    let nodeScale = measureNodeScale();
    const loops = graph.filterEdges((edge, attributes, source, target) => source === target);
    setReady(false);
    setError('');
    setHovered(null);
    setZoom(100);

    const update = (clearHover = false) => {
      if (clearHover) {
        hoverId = '';
        setHovered(null);
      }
      const { selectedId: selected, neighborsOnly: only } = optionsRef.current;
      isolated = only && graph.hasNode(selected) ? new Set([selected, ...graph.neighbors(selected)]) : new Set();
      activeId = hoverId || selected;
      neighborhood = graph.hasNode(activeId) ? new Set([activeId, ...graph.neighbors(activeId)]) : new Set();
      renderer?.refresh({ schedule: true });
    };
    updateRef.current = update;

    const focus = () => {
      const id = optionsRef.current.selectedId;
      if (!graph.hasNode(id)) return;
      if (!renderer) { pendingFocus = true; return; }
      pendingFocus = false;
      renderer.refresh();
      const position = renderer.getNodeDisplayData(id);
      if (position) void renderer.getCamera().animate({ x: position.x, y: position.y, ratio: Math.min(renderer.getCamera().ratio, graph.order > 300 ? 0.22 : 0.5) }, { duration: 300 });
    };
    focusRef.current = focus;

    const drawLoops = () => {
      const canvas = loopsRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context || !renderer) return;
      const { width, height } = renderer.getDimensions();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      for (const edge of loops) {
        const id = graph.source(edge);
        if (isolated.size > 0 && id !== optionsRef.current.selectedId) continue;
        const data = renderer.getNodeDisplayData(id);
        if (!data || data.hidden) continue;
        const point = renderer.graphToViewport(graph.getNodeAttributes(id));
        const radius = Math.max(9, renderer.scaleSize(data.size) * 1.7);
        if (point.x < -radius || point.y < -radius || point.x > width + radius || point.y > height + radius) continue;
        context.strokeStyle = id === activeId ? '#bba7ef' : optionsRef.current.evidence ? '#d9bc7b' : neighborhood.size ? '#2b2933' : '#65606f';
        context.fillStyle = context.strokeStyle;
        context.lineWidth = id === activeId ? 1.5 : 1;
        context.beginPath();
        context.arc(point.x, point.y - radius, radius, 0.55, Math.PI * 2 + 0.15);
        context.stroke();
        const angle = 0.15;
        const x = point.x + Math.cos(angle) * radius;
        const y = point.y - radius + Math.sin(angle) * radius;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x - 3, y - 5);
        context.lineTo(x + 3, y - 4);
        context.closePath();
        context.fill();
      }
    };

    const initialize = async () => {
      const [{ default: SigmaRenderer }, { createEdgeCurveProgram }, { createEdgeArrowProgram }] = await Promise.all([
        import('sigma'), import('@sigma/edge-curve'), import('sigma/rendering'),
      ]);
      if (disposed) return;
      graph.forEachEdge((edge, attributes, source, target) => {
        if (source !== target && (graph.hasDirectedEdge(target, source) || graph.directedEdges(source, target).length > 1)) {
          graph.setEdgeAttribute(edge, 'type', 'curve');
        }
      });
      renderer = new SigmaRenderer<SigmaNodeAttributes, SigmaEdgeAttributes>(graph, container, {
        defaultNodeColor: '#9e99a8',
        defaultEdgeColor: '#3a3742',
        defaultEdgeType: 'line',
        edgeProgramClasses: {
          arrow: createEdgeArrowProgram<SigmaNodeAttributes, SigmaEdgeAttributes>(),
          curve: createEdgeCurveProgram<SigmaNodeAttributes, SigmaEdgeAttributes>(),
          curvedArrow: createEdgeCurveProgram<SigmaNodeAttributes, SigmaEdgeAttributes>({ arrowHead: { extremity: 'target', lengthToThicknessRatio: 7, widenessToThicknessRatio: 3 } }),
        },
        stagePadding: graph.order > 400 ? 60 : 35,
        minCameraRatio: 0.015,
        maxCameraRatio: 5,
        enableCameraRotation: true,
        zoomToSizeRatioFunction: ratio => Math.pow(ratio, 0.25),
        minEdgeThickness: 0.7,
        antiAliasingFeather: 0.5,
        hideLabelsOnMove: true,
        labelDensity: 0.6,
        labelGridCellSize: graph.order <= 250 ? 75 : 100,
        labelRenderedSizeThreshold: graph.order <= 250 ? 0 : 7,
        labelColor: { color: '#c9c5d3' },
        labelFont: 'Inter, system-ui, sans-serif',
        labelSize: 11,
        defaultDrawNodeLabel: drawLabel,
        defaultDrawNodeHover: (context, data) => {
          context.strokeStyle = '#c5b4ee';
          context.lineWidth = 1.5;
          context.beginPath();
          context.arc(data.x, data.y, data.size + 4, 0, Math.PI * 2);
          context.stroke();
          drawLabel(context, data);
        },
        zIndex: true,
        nodeReducer: (id, data) => {
          const options = optionsRef.current;
          const selected = id === options.selectedId;
          const active = id === activeId;
          const dimmed = neighborhood.size > 0 && !neighborhood.has(id);
          return {
            ...data,
            hidden: isolated.size > 0 && !isolated.has(id),
            label: options.labels || active || selected ? data.label : null,
            color: selected || active ? '#dfd1ff' : dimmed ? '#3c3945' : options.colorMode === 'groups' ? groupColor(data.clusterId) : options.colorMode === 'roles' ? data.roleColor : neighborhood.has(id) ? '#bab1ce' : data.color,
            size: (data.size + (graph.order <= 250 ? 1 : 0)) * nodeScale + (selected || active ? 2 : 0),
            highlighted: selected,
            forceLabel: selected || active,
            zIndex: selected || active ? 2 : dimmed ? 0 : 1,
          };
        },
        edgeReducer: (id, data) => {
          const source = graph.source(id);
          const target = graph.target(id);
          const connected = source === activeId || target === activeId;
          const directed = connected || optionsRef.current.evidence;
          return {
            ...data,
            hidden: source === target || (isolated.size > 0 && source !== optionsRef.current.selectedId && target !== optionsRef.current.selectedId),
            color: connected ? source === activeId ? '#bda0ed' : '#78bfb2' : optionsRef.current.evidence ? '#cfb479' : neighborhood.size ? '#24222c' : '#494451',
            size: connected || optionsRef.current.evidence ? 1.3 : 0.6,
            type: data.type === 'curve' ? directed ? 'curvedArrow' : 'curve' : directed ? 'arrow' : 'line',
            zIndex: connected ? 1 : 0,
          };
        },
      });
      rendererRef.current = renderer;
      renderer.on('afterRender', drawLoops);
      renderer.on('enterNode', ({ node }) => {
        if (draggedId) return;
        hoverId = node;
        setHovered(graph.getNodeAttributes(node));
        container.style.cursor = 'grab';
        update();
      });
      renderer.on('leaveNode', () => {
        if (draggedId) return;
        hoverId = '';
        setHovered(null);
        container.style.cursor = 'default';
        update();
      });
      renderer.on('clickNode', ({ node }) => {
        if (!moved) optionsRef.current.onSelect(node);
      });
      renderer.on('clickStage', () => {
        if (!moved) optionsRef.current.onSelect('');
      });
      renderer.getMouseCaptor().on('wheel', event => {
        if (event.original.shiftKey && renderer) {
          event.preventSigmaDefault();
          const camera = renderer.getCamera();
          camera.setState({ angle: camera.angle + event.delta * Math.PI / 18 });
        }
      });
      renderer.on('downNode', ({ node, event }) => {
        draggedId = node;
        dragOrigin = { x: event.x, y: event.y };
        moved = false;
        if (!renderer?.getCustomBBox()) renderer?.setCustomBBox(renderer.getBBox());
        renderer?.getCamera().disable();
        container.style.cursor = 'grabbing';
      });
      const drag = (event: MouseCoords) => {
        if (!draggedId || !renderer || !dragOrigin) return;
        if (Math.hypot(event.x - dragOrigin.x, event.y - dragOrigin.y) < 3 && !moved) return;
        moved = true;
        const position = renderer.viewportToGraph(event);
        graph.mergeNodeAttributes(draggedId, position);
        event.preventSigmaDefault();
        event.original.preventDefault();
        event.original.stopPropagation();
      };
      renderer.on('moveBody', ({ event }) => drag(event));
      const endDrag = () => {
        draggedId = '';
        dragOrigin = undefined;
        renderer?.getCamera().enable();
        container.style.cursor = hoverId ? 'grab' : 'default';
        requestAnimationFrame(() => { moved = false; });
      };
      releaseDrag = endDrag;
      window.addEventListener('blur', endDrag);
      window.addEventListener('pointercancel', endDrag);
      renderer.getMouseCaptor().on('mouseup', endDrag);
      renderer.getTouchCaptor().on('touchup', endDrag);
      renderer.getCamera().on('updated', ({ ratio }) => setZoom(Math.round(100 / ratio)));
      observer = new ResizeObserver(() => {
        nodeScale = measureNodeScale();
        renderer?.resize();
        renderer?.refresh({ schedule: true });
      });
      observer.observe(container);
      update();
      setReady(true);
      if (pendingFocus) focus();
    };
    void initialize().catch(reason => {
      if (disposed) return;
      setError(reason instanceof Error ? reason.message : 'Граф недоступен');
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      if (releaseDrag) {
        window.removeEventListener('blur', releaseDrag);
        window.removeEventListener('pointercancel', releaseDrag);
      }
      renderer?.kill();
      rendererRef.current = null;
      updateRef.current = () => {};
      focusRef.current = () => {};
    };
  }, [model]);

  useEffect(() => { updateRef.current(true); }, [selectedId]);
  useEffect(() => { updateRef.current(); }, [neighborsOnly, colorMode, labels, evidence]);
  useEffect(() => { if (focusRequest) focusRef.current(); }, [focusRequest]);

  const zoomBy = (factor: number) => {
    const camera = rendererRef.current?.getCamera();
    if (camera) void camera.animate({ ratio: camera.getBoundedRatio(camera.ratio / factor) }, { duration: 180 });
  };
  const fit = () => {
    rendererRef.current?.setCustomBBox(null);
    void rendererRef.current?.getCamera().animatedReset({ duration: 250 });
  };
  const rotate = () => {
    const camera = rendererRef.current?.getCamera();
    if (camera) void camera.animate({ angle: camera.angle + Math.PI / 6 }, { duration: 200 });
  };

  return (
    <div className="sigma-graph" data-graph-renderer="sigma" data-node-count={model.nodes.length} data-edge-count={model.edges.length} data-layout="static" data-ready={ready}>
      <div ref={containerRef} className="sigma-surface" role="img" aria-label={`Интерактивный граф: ${model.nodes.length} узлов, ${model.edges.length} связей. Колесо меняет масштаб, Shift и колесо поворачивают граф, перетаскивание перемещает карту или узел. Выбор также доступен в списке клиентов.`} />
      <canvas ref={loopsRef} className="sigma-loops" aria-hidden="true" />
      {!model.nodes.length && <div className="sigma-empty">По этим фильтрам связей не найдено</div>}
      {!!model.nodes.length && !ready && !error && <div className="sigma-empty">Открываем карту связей…</div>}
      {error && <div className="sigma-empty" role="alert"><strong>Не удалось открыть карту</strong><span>Для интерактивного графа нужен WebGL. Проверьте аппаратное ускорение браузера и обновите страницу.</span></div>}
      {hovered && <div className="sigma-tooltip"><strong>{hovered.gid ?? hovered.label}</strong><span>{hovered.kind === 'client' ? `Группа ${hovered.clusterId + 1} · Нажмите для деталей` : 'Нажмите для деталей группы'}</span></div>}
      {ready && !!model.nodes.length && <>
        <div className="sigma-controls" role="toolbar" aria-label="Управление графом">
          <button type="button" onClick={() => zoomBy(1.5)} aria-label="Увеличить граф" title="Увеличить"><Plus size={16} /></button>
          <output aria-label="Масштаб графа">{zoom}%</output>
          <button type="button" onClick={() => zoomBy(1 / 1.5)} aria-label="Уменьшить граф" title="Уменьшить"><Minus size={16} /></button>
          <span className="sigma-controls-divider" />
          <button type="button" onClick={fit} aria-label="Показать весь граф" title="Весь граф"><Expand size={16} /></button>
          <button type="button" onClick={() => focusRef.current()} disabled={!selectedId} aria-label="Приблизить выбранный узел" title="К выбранному узлу"><LocateFixed size={16} /></button>
          <span className="sigma-controls-divider" />
          <button type="button" onClick={rotate} aria-label="Повернуть граф" title="Повернуть · Shift + колесо"><RotateCw size={15} /></button>
        </div>
        <div className="sigma-status" aria-live="polite">{selectedId ? 'Входящие — бирюзовые · исходящие — сиреневые' : 'Колесо — масштаб · Shift + колесо — поворот'}</div>
      </>}
    </div>
  );
}
