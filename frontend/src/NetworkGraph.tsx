import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, LocateFixed, X } from 'lucide-react';
import type { EdgeRow, NodeRow } from './types';
import { RoleBadge, number, plural, shortMoney } from './format';
import { clientGraph, graphNeighborhood } from './network-model';
import GraphView from './GraphView';
import './network-graph.css';

interface NetworkGraphProps {
  nodes: NodeRow[];
  edges: EdgeRow[];
  selectedGid: string;
  mode: 'focus' | 'overview' | 'paths' | 'cluster';
  clusterId?: number;
  onSelect: (gid: string) => void;
}

export default function NetworkGraph({ nodes, edges, selectedGid, mode, clusterId, onSelect }: NetworkGraphProps) {
  const model = useMemo(() => clientGraph(nodes, edges), [nodes, edges]);
  const nodeById = useMemo(() => new Map(nodes.map(node => [`node:${node.gid}`, node])), [nodes]);
  const [selectedId, setSelectedId] = useState(() => `node:${selectedGid}`);
  const [neighborsOnly, setNeighborsOnly] = useState(false);
  const [labels, setLabels] = useState(true);
  const [focusRequest, setFocusRequest] = useState(0);
  const selected = nodeById.get(selectedId);
  const neighborhood = useMemo(() => graphNeighborhood(model, selectedId), [model, selectedId]);
  const selectedEdges = useMemo(() => model.edges.filter(edge => edge.source === selectedId || edge.target === selectedId), [model, selectedId]);
  const incoming = selectedEdges.filter(edge => edge.target === selectedId).reduce((sum, edge) => sum + edge.sumMinor, 0);
  const outgoing = selectedEdges.filter(edge => edge.source === selectedId).reduce((sum, edge) => sum + edge.sumMinor, 0);
  const external = mode === 'cluster' && selected && selected.cluster_id !== clusterId;
  const shownNodes = selected && neighborsOnly ? neighborhood.size : model.nodes.length;
  const shownEdges = selected && neighborsOnly ? selectedEdges.length : model.edges.length;

  useEffect(() => {
    setSelectedId(`node:${selectedGid}`);
    setNeighborsOnly(false);
  }, [selectedGid]);

  useEffect(() => {
    setSelectedId(current => nodeById.has(current) ? current : nodeById.has(`node:${selectedGid}`) ? `node:${selectedGid}` : '');
  }, [nodeById, selectedGid]);

  const selectOnMap = (id: string) => {
    setSelectedId(id);
    if (!id) setNeighborsOnly(false);
  };

  if (!nodes.length) return <div className="network-graph interactive-network network-empty-state"><strong>В этой выборке нет клиентов</strong><p>Измените группу, глубину окружения или выбранные пути.</p></div>;

  return <div className="network-graph interactive-network" data-graph-mode={mode} data-selected-gid={selected?.gid ?? ''}>
    <div className="local-network-toolbar">
      <label className="local-network-picker">Выделить клиента<select aria-label="Выделить клиента на карте" value={selected?.gid ?? ''} onChange={event => { selectOnMap(event.target.value ? `node:${event.target.value}` : ''); setFocusRequest(value => value + 1); }}><option value="">Выберите ID</option>{nodes.map(node => <option key={node.gid} value={node.gid}>{node.gid} · гр. {node.cluster_id + 1}{mode === 'cluster' && node.cluster_id !== clusterId ? ' · внешний' : ''}</option>)}</select></label>
      <div className="local-network-options"><label><input type="checkbox" checked={labels} onChange={event => setLabels(event.target.checked)} />Подписи</label><label><input type="checkbox" checked={neighborsOnly} disabled={!selected} onChange={event => setNeighborsOnly(event.target.checked)} />Только прямые связи</label></div>
      <span className="local-network-count">{number.format(shownNodes)} {plural(shownNodes, 'клиент', 'клиента', 'клиентов')} · {number.format(shownEdges)} {plural(shownEdges, 'связь', 'связи', 'связей')}</span>
    </div>
    <div className="local-network-canvas"><GraphView model={model} selectedId={selected?.gid ? selectedId : ''} neighborsOnly={neighborsOnly} focusRequest={focusRequest} onSelect={selectOnMap} colorMode="roles" labels={labels} evidence={mode === 'paths'} /></div>
    <div className="local-network-selection" aria-live="polite">
      {selected ? <>
        <div className="local-network-client"><strong>{selected.gid}</strong><span><RoleBadge role={selected.role} /><span>{external ? 'Внешний контрагент · ' : ''}Группа {selected.cluster_id + 1}</span></span></div>
        <div className="local-network-flows"><span>Входящие <strong>{shortMoney(incoming / 100)}</strong></span><span>Исходящие <strong>{shortMoney(outgoing / 100)}</strong></span><small>По связям текущей карты</small></div>
        <div className="local-network-actions"><button type="button" className="local-network-locate" aria-label="Приблизить выделенного клиента" onClick={() => setFocusRequest(value => value + 1)}><LocateFixed size={16} /></button><button type="button" className="local-network-open" onClick={() => onSelect(selected.gid)}>Открыть клиента<ArrowUpRight size={15} /></button><button type="button" aria-label="Снять выделение клиента" onClick={() => selectOnMap('')}><X size={16} /></button></div>
      </> : <p>Нажмите на узел или выберите ID, чтобы выделить клиента и его связи. Карта останется на месте.</p>}
    </div>
  </div>;
}
