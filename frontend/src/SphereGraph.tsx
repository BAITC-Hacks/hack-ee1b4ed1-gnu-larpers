import { useEffect, useRef, useState } from 'react';
import { Expand, LocateFixed, Minus, Plus, RotateCw } from 'lucide-react';
import type { GraphViewProps } from './GraphView';
import type { GraphNode } from './network-model';
import { createSphereLayout } from './sphere-model';
import { groupColor } from './graph-colors';
import './sigma-graph.css';
import './sphere-graph.css';

export default function SphereGraph({ model, selectedId, neighborsOnly, focusRequest, onSelect, colorMode = 'groups', labels = true, evidence = false }: GraphViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLCanvasElement>(null);
  const optionsRef = useRef({ selectedId, neighborsOnly, onSelect, colorMode, labels, evidence });
  optionsRef.current = { selectedId, neighborsOnly, onSelect, colorMode, labels, evidence };
  const updateRef = useRef<() => void>(() => {});
  const focusRef = useRef<() => void>(() => {});
  const fitRef = useRef<() => void>(() => {});
  const zoomRef = useRef<(factor: number) => void>(() => {});
  const rotateRef = useRef<() => void>(() => {});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [hovered, setHovered] = useState<GraphNode | null>(null);

  useEffect(() => {
    const surface = surfaceRef.current;
    const root = rootRef.current;
    if (!surface || !root || !model.nodes.length) return;
    let disposed = false;
    let cleanup = () => {};
    let pendingFocus = false;
    focusRef.current = () => { pendingFocus = true; };
    setReady(false);
    setError(false);
    setHovered(null);

    const initialize = async () => {
      const [THREE, { OrbitControls }] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
      if (disposed) return;
      const layout = createSphereLayout(model);
      const radius = Math.max(layout.radius, 20);
      const positions = model.nodes.map((_, index) => new THREE.Vector3().fromArray(layout.positions, index * 3));
      const indices = new Map(model.nodes.map((node, index) => [node.id, index]));
      const adjacent = model.nodes.map(() => new Set<number>());
      const edges = model.edges.flatMap(edge => {
        const source = indices.get(edge.source);
        const target = indices.get(edge.target);
        if (source === undefined || target === undefined) return [];
        adjacent[source].add(target);
        adjacent[target].add(source);
        return [{ source, target, id: edge.id }];
      });
      const scene = new THREE.Scene();
      scene.background = new THREE.Color('#17161d');
      const camera = new THREE.PerspectiveCamera(42, 1, radius / 1000, radius * 100);
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.domElement.tabIndex = 0;
      renderer.domElement.setAttribute('aria-label', '3D-граф. Стрелки вращают, плюс и минус меняют масштаб, Home показывает весь граф.');
      surface.appendChild(renderer.domElement);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false;
      controls.autoRotate = false;
      controls.rotateSpeed = 0.6;
      controls.zoomSpeed = 0.8;
      controls.minDistance = radius * 0.08;
      controls.maxDistance = radius * 15;
      const nodeGeometry = new THREE.SphereGeometry(1, 10, 8);
      const nodeMaterial = new THREE.MeshBasicMaterial();
      const nodes = new THREE.InstancedMesh(nodeGeometry, nodeMaterial, model.nodes.length);
      nodes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      nodes.frustumCulled = false;
      scene.add(nodes);
      const segments = 12;
      const linePositions = new Float32Array(edges.length * segments * 6);
      const lineColors = new Float32Array(linePositions.length);
      const edgeGeometry = new THREE.BufferGeometry();
      edgeGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3).setUsage(THREE.DynamicDrawUsage));
      edgeGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3).setUsage(THREE.DynamicDrawUsage));
      const edgeMaterial = new THREE.LineBasicMaterial({ vertexColors: true });
      const lines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
      lines.frustumCulled = false;
      scene.add(lines);
      const arrowGeometry = new THREE.ConeGeometry(0.55, 1.8, 6);
      const arrowMaterial = new THREE.MeshBasicMaterial();
      const arrows = new THREE.InstancedMesh(arrowGeometry, arrowMaterial, Math.max(1, edges.length));
      arrows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      arrows.frustumCulled = false;
      scene.add(arrows);
      const transform = new THREE.Object3D();
      const color = new THREE.Color();
      const upward = new THREE.Vector3(0, 1, 0);
      const scratch = new THREE.Vector3();
      const direction = new THREE.Vector3();
      const midpoint = new THREE.Vector3();
      const perpendicular = new THREE.Vector3();
      const nodeSizes = model.nodes.map((_, index) => radius * (model.nodes.length > 400 ? 0.008 : 0.015) * (1 + Math.min(1.3, Math.log2(1 + adjacent[index].size) * 0.2)));
      const screen = model.nodes.map(() => ({ x: 0, y: 0, depth: 0, size: 0, visible: false }));
      const visible = model.nodes.map(() => true);
      const pairCounts = new Map<string, number>();
      const edgeOffsets = edges.map(edge => {
        const key = `${edge.source}:${edge.target}`;
        const offset = pairCounts.get(key) ?? 0;
        pairCounts.set(key, offset + 1);
        return offset;
      });
      let hoverIndex = -1;
      let selectedIndex = -1;
      let activeIndex = -1;
      let frame = 0;
      let renderCount = 0;
      let width = 1;
      let height = 1;
      let fitDistance = radius * 3;
      let pointer: { id: number; x: number; y: number; node: number; moved: boolean } | undefined;
      const dragPlane = new THREE.Plane();
      const dragOffset = new THREE.Vector3();
      const dragOrigin = new THREE.Vector3();
      const raycaster = new THREE.Raycaster();
      const cursor = new THREE.Vector2();
      const point = new THREE.Vector3();

      const edgePoint = (edgeIndex: number, t: number, result: InstanceType<typeof THREE.Vector3>) => {
        const edge = edges[edgeIndex];
        const source = positions[edge.source];
        const target = positions[edge.target];
        if (edge.source === edge.target) {
          const loopRadius = nodeSizes[edge.source] * (3 + edgeOffsets[edgeIndex]);
          return result.copy(source).add(new THREE.Vector3(Math.sin(t * Math.PI * 2) * loopRadius, (1 - Math.cos(t * Math.PI * 2)) * loopRadius, 0));
        }
        result.lerpVectors(source, target, t);
        if (pairCounts.has(`${edge.target}:${edge.source}`) || (pairCounts.get(`${edge.source}:${edge.target}`) ?? 0) > 1) {
          direction.subVectors(target, source).normalize();
          perpendicular.crossVectors(direction, Math.abs(direction.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : upward).normalize();
          result.addScaledVector(perpendicular, Math.sin(t * Math.PI) * (nodeSizes[edge.source] + nodeSizes[edge.target]) * (1.4 + edgeOffsets[edgeIndex]));
        }
        return result;
      };

      const drawLabels = () => {
        const canvas = labelsRef.current;
        const context = canvas?.getContext('2d');
        if (!canvas || !context) return;
        const pixelRatio = renderer.getPixelRatio();
        if (canvas.width !== Math.round(width * pixelRatio) || canvas.height !== Math.round(height * pixelRatio)) {
          canvas.width = Math.round(width * pixelRatio);
          canvas.height = Math.round(height * pixelRatio);
        }
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.clearRect(0, 0, width, height);
        context.font = '11px Inter, system-ui, sans-serif';
        context.textAlign = 'center';
        context.lineJoin = 'round';
        context.lineWidth = 3;
        const candidates: number[] = [];
        for (let i = 0; i < positions.length; i += 1) {
          scratch.copy(positions[i]).project(camera);
          const projected = screen[i];
          projected.x = (scratch.x + 1) * width / 2;
          projected.y = (1 - scratch.y) * height / 2;
          projected.depth = scratch.z;
          const distance = positions[i].distanceTo(camera.position);
          projected.size = nodeSizes[i] * height / (2 * Math.tan(camera.fov * Math.PI / 360) * distance);
          projected.visible = visible[i] && scratch.z > -1 && scratch.z < 1 && Math.abs(scratch.x) < 1.05 && Math.abs(scratch.y) < 1.05;
          if (projected.visible && (i === selectedIndex || i === hoverIndex || optionsRef.current.labels && (model.nodes.length <= 250 || projected.size > 4))) candidates.push(i);
        }
        candidates.sort((a, b) => Number(b === selectedIndex || b === hoverIndex) - Number(a === selectedIndex || a === hoverIndex) || screen[a].depth - screen[b].depth);
        const occupied: { x: number; y: number; width: number }[] = [];
        for (const index of candidates) {
          const projected = screen[index];
          const active = index === selectedIndex || index === hoverIndex;
          if (!active && activeIndex >= 0 && !adjacent[activeIndex].has(index)) continue;
          const text = active ? model.nodes[index].gid ?? model.nodes[index].label : model.nodes[index].label;
          const textWidth = context.measureText(text).width + 10;
          const x = Math.max(textWidth / 2 + 8, Math.min(width - textWidth / 2 - 8, projected.x));
          const y = projected.y + Math.max(5, projected.size) + 16;
          if (!active && (occupied.length >= (model.nodes.length > 400 ? 24 : 55) || occupied.some(rect => Math.abs(rect.y - y) < 17 && Math.abs(rect.x - x) < (rect.width + textWidth) / 2))) continue;
          occupied.push({ x, y, width: textWidth });
          context.strokeStyle = '#17161d';
          context.strokeText(text, x, y);
          context.fillStyle = active ? '#f2eaff' : '#afa7bc';
          context.fillText(text, x, y);
        }
        if (selectedIndex >= 0 && screen[selectedIndex].visible) {
          const selected = screen[selectedIndex];
          context.beginPath();
          context.arc(selected.x, selected.y, Math.max(6, selected.size * 1.5) + 4, 0, Math.PI * 2);
          context.strokeStyle = '#e0ccff';
          context.lineWidth = 1.5;
          context.stroke();
          root.dataset.selectedPosition = `${selected.x.toFixed(1)},${selected.y.toFixed(1)}`;
        } else delete root.dataset.selectedPosition;
      };

      const render = () => {
        frame = 0;
        if (disposed) return;
        scene.fog = new THREE.Fog('#17161d', Math.max(0, camera.position.distanceTo(controls.target) - radius * 0.3), camera.position.distanceTo(controls.target) + radius * 2.3);
        renderer.render(scene, camera);
        drawLabels();
        root.dataset.renderCount = String(++renderCount);
        root.dataset.drawCalls = String(renderer.info.render.calls);
        root.dataset.cameraPosition = camera.position.toArray().map(value => value.toFixed(3)).join(',');
        setZoom(Math.round(fitDistance / camera.position.distanceTo(controls.target) * 100));
      };
      const requestRender = () => { if (!frame && !disposed) frame = requestAnimationFrame(render); };

      const update = () => {
        const options = optionsRef.current;
        selectedIndex = indices.get(options.selectedId) ?? -1;
        activeIndex = hoverIndex >= 0 ? hoverIndex : selectedIndex;
        const isolated = options.neighborsOnly && selectedIndex >= 0;
        for (let i = 0; i < model.nodes.length; i += 1) {
          const node = model.nodes[i];
          visible[i] = !isolated || i === selectedIndex || adjacent[selectedIndex].has(i);
          const active = i === selectedIndex || i === hoverIndex;
          const connected = activeIndex < 0 || i === activeIndex || adjacent[activeIndex].has(i);
          const baseColor = options.colorMode === 'groups' ? groupColor(node.clusterId) : options.colorMode === 'roles' ? node.color : '#b0a7c1';
          color.set(baseColor);
          if (active) color.lerp(new THREE.Color('#ffffff'), 0.4);
          else if (!connected) color.lerp(new THREE.Color('#17161d'), 0.8);
          nodes.setColorAt(i, color);
          transform.position.copy(positions[i]);
          transform.quaternion.identity();
          transform.scale.setScalar(visible[i] ? nodeSizes[i] * (active ? 1.5 : 1) : 0);
          transform.updateMatrix();
          nodes.setMatrixAt(i, transform.matrix);
        }
        let arrowCount = 0;
        edges.forEach((edge, edgeIndex) => {
          const connected = edge.source === activeIndex || edge.target === activeIndex;
          const show = !isolated || edge.source === selectedIndex || edge.target === selectedIndex;
          color.set(connected ? edge.source === activeIndex ? '#c7a3ff' : '#79d1c4' : options.evidence ? '#d9bc7b' : activeIndex >= 0 ? '#23212b' : '#51485e');
          for (let segment = 0; segment < segments; segment += 1) {
            const offset = (edgeIndex * segments + segment) * 6;
            if (show) {
              edgePoint(edgeIndex, segment / segments, scratch).toArray(linePositions, offset);
              edgePoint(edgeIndex, (segment + 1) / segments, scratch).toArray(linePositions, offset + 3);
            } else linePositions.fill(0, offset, offset + 6);
            color.toArray(lineColors, offset);
            color.toArray(lineColors, offset + 3);
          }
          if (show && (connected || options.evidence)) {
            edgePoint(edgeIndex, 0.76, midpoint);
            edgePoint(edgeIndex, 0.78, scratch);
            direction.subVectors(scratch, midpoint).normalize();
            transform.position.copy(midpoint);
            transform.quaternion.setFromUnitVectors(upward, direction);
            transform.scale.setScalar(radius * (model.nodes.length > 400 ? 0.009 : 0.016));
            transform.updateMatrix();
            arrows.setMatrixAt(arrowCount, transform.matrix);
            arrows.setColorAt(arrowCount, color);
            arrowCount += 1;
          }
        });
        arrows.count = arrowCount;
        nodes.instanceMatrix.needsUpdate = true;
        nodes.boundingSphere = null;
        if (nodes.instanceColor) nodes.instanceColor.needsUpdate = true;
        arrows.instanceMatrix.needsUpdate = true;
        if (arrows.instanceColor) arrows.instanceColor.needsUpdate = true;
        edgeGeometry.attributes.position.needsUpdate = true;
        edgeGeometry.attributes.color.needsUpdate = true;
        requestRender();
      };

      const fit = () => {
        const bound = new THREE.Box3().setFromPoints(positions.filter((_, index) => visible[index]));
        const center = bound.getCenter(new THREE.Vector3());
        const extent = Math.max(radius * 0.12, ...positions.filter((_, index) => visible[index]).map(position => position.distanceTo(center))) + Math.max(...nodeSizes);
        const halfFov = Math.min(camera.fov * Math.PI / 360, Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect));
        fitDistance = extent / Math.sin(halfFov) * 1.12;
        camera.position.copy(center).add(new THREE.Vector3(0, 0, fitDistance));
        controls.target.copy(center);
        controls.update();
        requestRender();
      };
      const focus = () => {
        const index = indices.get(optionsRef.current.selectedId);
        if (index === undefined) return;
        const target = positions[index];
        direction.copy(target).normalize();
        if (!direction.lengthSq()) direction.set(0, 0, 1);
        camera.position.copy(target).addScaledVector(direction, radius * (model.nodes.length > 400 ? 0.65 : 1.15));
        controls.target.copy(target);
        controls.update();
        requestRender();
      };
      const zoomBy = (factor: number) => {
        direction.subVectors(camera.position, controls.target);
        const distance = Math.max(controls.minDistance, Math.min(controls.maxDistance, direction.length() / factor));
        camera.position.copy(controls.target).add(direction.setLength(distance));
        controls.update();
        requestRender();
      };
      const rotate = (x: number, y = 0) => {
        const spherical = new THREE.Spherical().setFromVector3(direction.subVectors(camera.position, controls.target));
        spherical.theta += x;
        spherical.phi = Math.max(0.01, Math.min(Math.PI - 0.01, spherical.phi + y));
        camera.position.copy(controls.target).add(direction.setFromSpherical(spherical));
        controls.update();
        requestRender();
      };
      const resize = () => {
        const firstSize = width === 1 && height === 1;
        width = Math.max(1, surface.clientWidth);
        height = Math.max(1, surface.clientHeight);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height);
        if (firstSize) fit();
        requestRender();
      };
      const hitTest = (event: PointerEvent) => {
        const bounds = renderer.domElement.getBoundingClientRect();
        const x = event.clientX - bounds.left;
        const y = event.clientY - bounds.top;
        let found = -1;
        let closest = Infinity;
        let intersectsNode = false;
        screen.forEach((item, index) => {
          if (!item.visible) return;
          const hitRadius = Math.max(6, item.size * (index === selectedIndex ? 1.5 : 1) + 2);
          const distance = Math.hypot(item.x - x, item.y - y);
          intersectsNode ||= distance <= item.size * (index === selectedIndex ? 1.5 : 1) + 1;
          const score = distance / hitRadius + item.depth * 0.01;
          if (distance <= hitRadius && score < closest) { closest = score; found = index; }
        });
        if (intersectsNode) {
          cursor.set(x / width * 2 - 1, -y / height * 2 + 1);
          raycaster.setFromCamera(cursor, camera);
          const hit = raycaster.intersectObject(nodes, false)[0];
          if (hit?.instanceId !== undefined) return hit.instanceId;
        }
        return found;
      };
      const projectPointer = (event: PointerEvent) => {
        const bounds = renderer.domElement.getBoundingClientRect();
        cursor.set((event.clientX - bounds.left) / width * 2 - 1, -(event.clientY - bounds.top) / height * 2 + 1);
        raycaster.setFromCamera(cursor, camera);
        return raycaster.ray.intersectPlane(dragPlane, point);
      };
      const pointerDown = (event: PointerEvent) => {
        if (event.button !== 0 || pointer) return;
        const node = event.shiftKey || event.ctrlKey || event.metaKey ? -1 : hitTest(event);
        pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, node, moved: false };
        if (node < 0) return;
        controls.enabled = false;
        dragOrigin.copy(positions[node]);
        camera.getWorldDirection(direction);
        dragPlane.setFromNormalAndCoplanarPoint(direction, dragOrigin);
        if (projectPointer(event)) dragOffset.subVectors(dragOrigin, point);
        renderer.domElement.setPointerCapture(event.pointerId);
        surface.style.cursor = 'grabbing';
        event.stopImmediatePropagation();
      };
      const pointerMove = (event: PointerEvent) => {
        if (pointer) {
          if (pointer.id !== event.pointerId) return;
          pointer.moved ||= Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 3;
          if (pointer.node >= 0 && pointer.moved && projectPointer(event)) {
            direction.copy(point).add(dragOffset).sub(dragOrigin).clampLength(0, radius * 0.4);
            positions[pointer.node].copy(dragOrigin).add(direction);
            update();
            event.stopImmediatePropagation();
          }
          return;
        }
        const index = hitTest(event);
        if (index === hoverIndex) return;
        hoverIndex = index;
        surface.style.cursor = index >= 0 ? 'grab' : 'default';
        setHovered(index >= 0 ? model.nodes[index] : null);
        update();
      };
      const releasePointer = (event?: PointerEvent) => {
        if (!pointer || event && pointer.id !== event.pointerId) return;
        const previous = pointer;
        pointer = undefined;
        controls.enabled = true;
        surface.style.cursor = 'default';
        if (renderer.domElement.hasPointerCapture(previous.id)) renderer.domElement.releasePointerCapture(previous.id);
        if (event?.type === 'pointerup' && !previous.moved) optionsRef.current.onSelect(previous.node >= 0 ? model.nodes[previous.node].id : '');
        if (previous.node >= 0) event?.stopImmediatePropagation();
      };
      const clearHover = () => {
        if (pointer || hoverIndex < 0) return;
        hoverIndex = -1;
        setHovered(null);
        update();
      };
      const onBlur = () => {
        releasePointer();
        controls.disconnect();
        controls.connect(renderer.domElement);
        clearHover();
      };
      const keyDown = (event: KeyboardEvent) => {
        if (event.key === 'ArrowLeft') rotate(-0.12);
        else if (event.key === 'ArrowRight') rotate(0.12);
        else if (event.key === 'ArrowUp') rotate(0, -0.12);
        else if (event.key === 'ArrowDown') rotate(0, 0.12);
        else if (event.key === '+' || event.key === '=') zoomBy(1.2);
        else if (event.key === '-') zoomBy(1 / 1.2);
        else if (event.key === 'Home') fit();
        else return;
        event.preventDefault();
      };
      const lostContext = (event: Event) => { event.preventDefault(); setError(true); setReady(false); };
      const restoredContext = () => { setError(false); setReady(true); requestRender(); };
      const canvas = renderer.domElement;
      canvas.addEventListener('pointerdown', pointerDown, true);
      canvas.addEventListener('pointermove', pointerMove, true);
      canvas.addEventListener('pointerup', releasePointer, true);
      canvas.addEventListener('pointercancel', releasePointer, true);
      canvas.addEventListener('pointerleave', clearHover);
      canvas.addEventListener('keydown', keyDown);
      canvas.addEventListener('webglcontextlost', lostContext);
      canvas.addEventListener('webglcontextrestored', restoredContext);
      window.addEventListener('blur', onBlur);
      controls.addEventListener('change', requestRender);
      const observer = new ResizeObserver(resize);
      observer.observe(surface);
      updateRef.current = () => { hoverIndex = -1; setHovered(null); update(); };
      focusRef.current = focus;
      fitRef.current = fit;
      zoomRef.current = zoomBy;
      rotateRef.current = () => rotate(Math.PI / 8);
      update();
      resize();
      setReady(true);
      if (pendingFocus) focus();
      cleanup = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        window.removeEventListener('blur', onBlur);
        canvas.removeEventListener('pointerdown', pointerDown, true);
        canvas.removeEventListener('pointermove', pointerMove, true);
        canvas.removeEventListener('pointerup', releasePointer, true);
        canvas.removeEventListener('pointercancel', releasePointer, true);
        canvas.removeEventListener('pointerleave', clearHover);
        canvas.removeEventListener('keydown', keyDown);
        canvas.removeEventListener('webglcontextlost', lostContext);
        canvas.removeEventListener('webglcontextrestored', restoredContext);
        controls.dispose();
        nodeGeometry.dispose();
        nodeMaterial.dispose();
        nodes.dispose();
        edgeGeometry.dispose();
        edgeMaterial.dispose();
        arrowGeometry.dispose();
        arrowMaterial.dispose();
        arrows.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        canvas.remove();
      };
    };
    void initialize().catch(reason => {
      cleanup();
      if (!disposed) {
        console.error('Unable to render the 3D graph', reason);
        setError(true);
        setReady(false);
      }
    });
    return () => {
      disposed = true;
      cleanup();
      updateRef.current = () => {};
      focusRef.current = () => {};
      fitRef.current = () => {};
      zoomRef.current = () => {};
      rotateRef.current = () => {};
    };
  }, [model]);

  useEffect(() => { updateRef.current(); }, [selectedId, neighborsOnly, colorMode, labels, evidence]);
  useEffect(() => { if (focusRequest) focusRef.current(); }, [focusRequest]);

  return <div ref={rootRef} className="sigma-graph sphere-graph" data-graph-renderer="three" data-node-count={model.nodes.length} data-edge-count={model.edges.length} data-layout="static" data-ready={ready}>
    <div ref={surfaceRef} className="sigma-surface" />
    <canvas ref={labelsRef} className="sigma-loops" aria-hidden="true" />
    {!model.nodes.length && <div className="sigma-empty">По этим фильтрам связей не найдено</div>}
    {!!model.nodes.length && !ready && !error && <div className="sigma-empty">Открываем объёмный граф…</div>}
    {error && <div className="sigma-empty" role="alert"><strong>Не удалось открыть 3D-граф</strong><span>Проверьте аппаратное ускорение браузера или переключитесь на 2D.</span></div>}
    {hovered && <div className="sigma-tooltip"><strong>{hovered.gid ?? hovered.label}</strong><span style={{ color: groupColor(hovered.clusterId) }}>Группа {hovered.clusterId + 1} · Нажмите для деталей</span></div>}
    {ready && <>
      <div className="sigma-controls" role="toolbar" aria-label="Управление графом">
        <button type="button" onClick={() => zoomRef.current(1.5)} aria-label="Увеличить граф" title="Увеличить"><Plus size={16} /></button>
        <output aria-label="Масштаб графа">{zoom}%</output>
        <button type="button" onClick={() => zoomRef.current(1 / 1.5)} aria-label="Уменьшить граф" title="Уменьшить"><Minus size={16} /></button>
        <span className="sigma-controls-divider" />
        <button type="button" onClick={() => fitRef.current()} aria-label="Показать весь граф" title="Весь граф"><Expand size={16} /></button>
        <button type="button" onClick={() => focusRef.current()} disabled={!selectedId} aria-label="Приблизить выбранный узел" title="К выбранному узлу"><LocateFixed size={16} /></button>
        <button type="button" onClick={() => rotateRef.current()} aria-label="Повернуть граф" title="Повернуть"><RotateCw size={16} /></button>
      </div>
      <div className="sigma-status">Потяните фон — поворот · узел — сдвиг · колесо — масштаб</div>
    </>}
  </div>;
}
