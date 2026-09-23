import { ArrowRight, ArrowUpRight, Layers3 } from 'lucide-react';
import type { GraphData } from '../types';
import { number, shortMoney } from '../format';

export default function GroupsPage({ data, onOpenCluster }: { data: GraphData; onOpenCluster: (id: number, gid: string) => void }) {
  return <section className="clusters-page"><div className="cluster-grid">{[...data.clusters].sort((a, b) => b.n_nodes - a.n_nodes || a.cluster_id - b.cluster_id).map(cluster => <button className="cluster-card" key={cluster.cluster_id} onClick={() => onOpenCluster(cluster.cluster_id, cluster.top_gids[0])}><div className="cluster-card-title"><span><Layers3 size={17} />Группа {cluster.cluster_id + 1}</span><ArrowUpRight size={18} /></div><strong>{number.format(cluster.n_nodes)}<small> клиентов</small></strong><div className="cluster-stats"><span>{cluster.n_seed} seed</span><span>{shortMoney(cluster.sum_kzt_internal)} внутри группы</span></div><p>{cluster.hypothesis}</p><span className="cluster-open">Исследовать группу <ArrowRight size={14} /></span></button>)}</div></section>;
}
