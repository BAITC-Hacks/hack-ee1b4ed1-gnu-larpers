import { useState } from 'react';
import SigmaGraph, { type SigmaGraphProps } from './SigmaGraph';
import SphereGraph from './SphereGraph';
import './graph-view.css';

export type GraphViewProps = SigmaGraphProps;

export default function GraphView(props: GraphViewProps) {
  const [dimension, setDimension] = useState<'3d' | '2d'>('3d');

  return <div className="graph-view" data-graph-dimension={dimension}>
    {dimension === '3d' ? <SphereGraph {...props} /> : <SigmaGraph {...props} />}
    <div className="graph-view-mode" role="group" aria-label="Режим отображения графа">
      <button type="button" aria-label="Объёмный граф 3D" aria-pressed={dimension === '3d'} title="Объёмный граф" onClick={() => setDimension('3d')}>3D</button>
      <button type="button" aria-label="Плоский граф 2D" aria-pressed={dimension === '2d'} title="Плоский граф" onClick={() => setDimension('2d')}>2D</button>
    </div>
  </div>;
}
