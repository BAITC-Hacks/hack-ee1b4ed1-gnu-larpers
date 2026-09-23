import { useMemo } from 'react';
import { Activity, ArrowRight, BarChart3, ChevronRight, CircleHelp, GitBranch, Layers3, ShieldCheck, Users } from 'lucide-react';
import { roles, type GraphData, type Role } from '../types';
import { dateLabel, money, number, percent, plural, shortId, shortMoney } from '../format';

export default function ReportPage({ data, onSelect, onCluster, onMethod }: {
  data: GraphData;
  onSelect: (gid: string) => void;
  onCluster: (id: number, gid: string) => void;
  onMethod: () => void;
}) {
  const report = useMemo(() => {
    const counts = Object.fromEntries(Object.keys(roles).map(role => [role, 0])) as Record<Role, number>;
    data.nodes.forEach(node => { counts[node.role] += 1; });
    const dayTotals = new Map<string, number>();
    data.transactions.forEach(row => dayTotals.set(row.date, (dayTotals.get(row.date) ?? 0) + row.sum_minor));
    const days = [...dayTotals.entries()].sort(([a], [b]) => a.localeCompare(b));
    const peak = [...days].sort((a, b) => b[1] - a[1])[0];
    const groups = [...data.clusters].sort((a, b) => b.n_nodes - a.n_nodes || a.cluster_id - b.cluster_id).slice(0, 5);
    return { counts, days, peak, groups };
  }, [data]);
  const largestRole = (Object.keys(roles) as Role[]).sort((a, b) => report.counts[b] - report.counts[a])[0];
  const maxDay = Math.max(1, ...report.days.map(([, value]) => value));
  const maxRole = Math.max(1, ...Object.values(report.counts));
  const largestGroup = report.groups[0];
  return <div className="report-page">
    <section className="report-hero">
      <div className="report-hero-main"><h2>{number.format(data.metadata.n_transactions)} {plural(data.metadata.n_transactions, 'перевод', 'перевода', 'переводов')} в выборке</h2><p>Переводы между {number.format(data.metadata.n_nodes)} клиентами за {dateLabel(data.metadata.date_from)} — {dateLabel(data.metadata.date_to)}. Это наблюдаемая часть сети; роли и связи требуют ручной проверки.</p><div className="hero-actions"><button className="primary-action" onClick={() => onSelect(data.top_nodes[0]?.gid ?? data.nodes[0].gid)}>Изучить клиентов</button><button className="quiet-action" onClick={onMethod}>Как читать выводы</button></div></div>
      <div className="hero-total"><span>Общий объём переводов</span><strong>{shortMoney(data.metadata.sum_minor / 100)}</strong><small>{money(data.metadata.sum_minor / 100)} точно</small><p>Сумма наблюдаемых операций. При движении денег по цепочке один и тот же объём может встречаться снова.</p></div>
    </section>

    <section className="report-metrics" aria-label="Ключевые показатели">
      <article><span><Users size={18} /> Клиенты</span><strong>{number.format(data.metadata.n_nodes)}</strong><small>{number.format(data.metadata.n_seed)} исходных клиентов</small></article>
      <article><span><GitBranch size={18} /> Связи</span><strong>{number.format(data.metadata.n_edges)}</strong><small>Направленные пары клиентов</small></article>
      <article><span><Layers3 size={18} /> Группы</span><strong>{number.format(data.metadata.n_clusters)}</strong><small>По структуре наблюдаемых связей</small></article>
      <article><span><CircleHelp size={18} /> Граница выборки</span><strong>{number.format(data.metadata.n_boundary)}</strong><small>{percent(data.metadata.n_boundary / data.metadata.n_nodes)} клиентов на 4-м колене</small></article>
    </section>

    <div className="report-section-heading"><div><h2>Что показывает выборка</h2><p>Показатели рассчитаны по загруженным операциям и клиентам.</p></div></div>
    <div className="report-chart-grid">
      <section className="report-card volume-card"><div className="card-heading"><div><span className="section-icon"><Activity size={19} /></span><h3>Переводы по дням</h3><p>Сумма всех операций за каждый активный день</p></div><span className="card-pill">{report.days.length} дней</span></div><div className="volume-chart" role="img" aria-label="Дневной объём переводов за период"><div className="volume-scale"><span>{shortMoney(maxDay / 100)}</span><span>0 ₸</span></div><div className="volume-bars">{report.days.map(([day, value]) => <div className={`volume-bar ${report.peak?.[0] === day ? 'peak' : ''}`} key={day} title={`${dateLabel(day)}: ${money(value / 100)}`}><span style={{ height: `${Math.max(2, value / maxDay * 100)}%` }} /></div>)}</div></div><div className="chart-axis"><span>{dateLabel(report.days[0]?.[0] ?? null)}</span><span>{dateLabel(report.days[report.days.length - 1]?.[0] ?? null)}</span></div><div className="chart-insight"><span className="insight-mark" /><span>Самый активный день — <strong>{dateLabel(report.peak?.[0] ?? null)}</strong>, {shortMoney((report.peak?.[1] ?? 0) / 100)}.</span></div></section>
      <section className="report-card roles-card"><div className="card-heading"><div><span className="section-icon"><BarChart3 size={19} /></span><h3>Роли клиентов</h3><p>Одна основная роль у каждого клиента</p></div></div><div className="role-breakdown">{(Object.keys(roles) as Role[]).sort((a, b) => report.counts[b] - report.counts[a]).map(role => <div className="role-breakdown-row" key={role}><div className="role-breakdown-label"><span><i style={{ background: roles[role].color }} />{roles[role].label}</span><strong>{number.format(report.counts[role])}<small> · {percent(report.counts[role] / data.metadata.n_nodes)}</small></strong></div><div className="role-track"><span style={{ width: `${report.counts[role] / maxRole * 100}%`, background: roles[role].color }} /></div></div>)}</div><p className="card-note">Чаще всего встречается роль «{roles[largestRole].label.toLocaleLowerCase('ru')}». Роль описывает поведение только в доступной выборке.</p></section>
    </div>

    <div className="report-lists-grid">
      <section className="report-card groups-report"><div className="card-heading"><div><span className="section-icon"><Layers3 size={19} /></span><h3>Крупнейшие группы</h3><p>По числу клиентов в каждой группе</p></div></div><div className="report-rows">{report.groups.map(group => <button className="report-row" key={group.cluster_id} onClick={() => onCluster(group.cluster_id, group.top_gids[0])}><span className="row-symbol"><Layers3 size={17} /></span><span className="report-row-title"><strong>Группа {group.cluster_id + 1}</strong><small>{number.format(group.n_nodes)} {plural(group.n_nodes, 'клиент', 'клиента', 'клиентов')} · {number.format(group.n_seed)} {plural(group.n_seed, 'исходный', 'исходных', 'исходных')}</small></span><span className="report-row-value">{shortMoney(group.sum_kzt_internal)}<small>внутри группы</small></span><ChevronRight size={17} /></button>)}</div><p className="card-note">Крупнейшая группа включает {number.format(largestGroup.n_nodes)} клиентов — {percent(largestGroup.n_nodes / data.metadata.n_nodes)} сети. Внутренний объём не включает переводы между группами.</p></section>
      <section className="report-card priorities-report"><div className="card-heading"><div><span className="section-icon"><ShieldCheck size={19} /></span><h3>С кого начать проверку</h3><p>Клиенты с наибольшим приоритетом исследования</p></div></div><div className="report-rows">{data.top_nodes.slice(0, 5).map((item, index) => <button className="report-row" key={item.gid} onClick={() => onSelect(item.gid)}><span className="row-rank">{String(index + 1).padStart(2, '0')}</span><span className="report-row-title"><strong>{shortId(item.gid)}</strong><small>{roles[item.role].label}</small></span><span className="priority-value">{item.priority_score.toFixed(2)}</span><ChevronRight size={17} /></button>)}</div><p className="card-note">Приоритет показывает порядок ручного изучения. Он не является оценкой вероятности нарушения.</p></section>
    </div>
    <section className="report-boundary"><CircleHelp size={20} /><div><strong>Как интерпретировать отчёт</strong><p>{number.format(data.metadata.n_boundary)} клиента находятся на границе наблюдения. У них могут быть переводы за пределами данных. Даты известны с точностью до дня, а роли и группы остаются аналитическими гипотезами.</p></div><button onClick={onMethod}>Методика <ArrowRight size={15} /></button></section>
  </div>;
}

