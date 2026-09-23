import { useEffect, useMemo, useState } from 'react';
import { DailyTransfersChart } from '../Charts';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Check, ChevronRight, CircleHelp, Copy, ShieldCheck } from 'lucide-react';
import { dailyForNode, transactionsForNode } from '../data';
import { roles, type DailyRow, type GraphData, type NodeRow } from '../types';
import { RoleBadge, dateLabel, money, percent, plural, shortId, shortMoney } from '../format';
import '../role-explanation.css';

interface TransactionFilters {
  from: string;
  to: string;
  direction: 'all' | 'in' | 'out';
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
  setDirection: (value: 'all' | 'in' | 'out') => void;
}

function readableEvidence(node: NodeRow) {
  const sources = `${node.seed_sources} ${plural(node.seed_sources, 'исходным клиентом', 'исходными клиентами', 'исходными клиентами')}`;
  switch (node.role) {
    case 'coordinator': return `Соединяет клиентов из ${node.neighbor_clusters} ${plural(node.neighbor_clusters, 'соседней группы', 'соседних групп', 'соседних групп')}. Через наблюдаемые пути связан с ${sources}.`;
    case 'consolidator': return `Получил ${shortMoney(node.in_kzt)} от ${node.in_deg} ${plural(node.in_deg, 'отправителя', 'отправителей', 'отправителей')}. Поступления сосредоточены на этом клиенте.`;
    case 'distributor': return `Отправил ${shortMoney(node.out_kzt)} ${node.out_deg} ${plural(node.out_deg, 'получателю', 'получателям', 'получателям')} в ${node.out_tx} ${plural(node.out_tx, 'переводе', 'переводах', 'переводах')}.`;
    case 'transit': return node.following_days_out_share === null
      ? 'Есть входящие и исходящие переводы, но долю сопоставимого объёма определить не удалось.'
      : `В течение ${node.window_days} ${plural(node.window_days, 'дня', 'дней', 'дней')} после поступлений наблюдались исходящие переводы, сопоставимые с ${percent(node.following_days_out_share)} входящего объёма.`;
    case 'terminal': return `В наблюдаемой сети получено ${shortMoney(node.in_kzt)} от ${node.in_deg} ${plural(node.in_deg, 'отправителя', 'отправителей', 'отправителей')}; дальнейших исходящих переводов не видно${node.truncated_by_depth ? ' на границе выборки' : ''}.`;
    case 'peripheral': return `В выборке видно ${node.in_deg + node.out_deg} ${plural(node.in_deg + node.out_deg, 'связь', 'связи', 'связей')}. Этого недостаточно для более определённой роли.`;
  }
}

function DailyChart({ rows }: { rows: DailyRow[] }) {
  if (!rows.length) return <div className="chart-empty">Внешних переводов в выборке нет</div>;
  return <DailyTransfersChart rows={rows} compact series={[
    { key: 'in_minor', label: 'Входящие', color: '#a785f4' },
    { key: 'out_minor', label: 'Исходящие', color: '#71c1cb' },
  ]} />;
}

const scoreFormat = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 3, maximumFractionDigits: 6 });

const priorityLabels: Record<string, string> = {
  betweenness: 'Связующее положение в графе',
  turnover: 'Объём переводов',
  transactions: 'Количество переводов',
  seed_sources: 'Связь с исходными клиентами',
  role_support: 'Поддержка роли после поправок',
  temporal: 'Сопоставление объёмов по датам',
};

function PriorityBreakdown({ node }: { node: NodeRow }) {
  const entries = Object.entries(node.priority_components ?? {});
  if (!entries.length) return <p className="priority-unavailable">Разложение приоритета отсутствует в этой версии анализа.</p>;
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  return <details className="priority-breakdown">
    <summary>Из чего складывается приоритет</summary>
    <dl>{entries.map(([key, value]) => <div key={key}>
      <dt>{priorityLabels[key] ?? key}</dt><dd>{scoreFormat.format(value)}</dd>
    </div>)}<div className="priority-total"><dt>Сумма вкладов</dt><dd>{scoreFormat.format(total)}</dd></div></dl>
    <p>Вклады уже учитывают веса признаков. Итог показан с округлением.</p>
  </details>;
}

function RoleHypotheses({ node }: { node: NodeRow }) {
  if (!node.role_candidates) return <p className="role-unavailable">Сравнение ролей отсутствует в этой версии анализа.</p>;
  const candidates = [...node.role_candidates].sort((left, right) => right.score - left.score);
  if (!candidates.length) return <p className="role-unavailable">Недостаточно внешних переводов для сравнения ролей.</p>;
  const margin = node.role_margin ?? (candidates.length > 1 ? candidates[0].score - candidates[1].score : null);
  const close = margin !== null && margin < 0.05;
  return <section className="role-hypotheses" aria-label="Сравнение гипотез ролей">
    <h4>Основная и альтернативные роли</h4>
    <p className="role-scoring-note">Исходные эвристические оценки до поправок за неполноту наблюдений. Это не вероятности.</p>
    <ol className="role-candidates">{candidates.slice(0, 3).map(candidate => <li key={candidate.role}>
      <div className="role-candidate-heading"><RoleBadge role={candidate.role} /><strong>{scoreFormat.format(candidate.score)}<small> / 1</small></strong></div>
      <span className="role-candidate-status">{candidate.role === node.role ? 'Выбранная роль' : 'Альтернативная гипотеза'}</span>
      <p>{candidate.role === 'peripheral' && node.role !== 'peripheral'
        ? 'Базовая гипотеза для клиентов без выраженного рисунка переводов. Более сильные признаки поддерживают другие роли.'
        : readableEvidence({ ...node, role: candidate.role })}</p>
    </li>)}</ol>
    {margin !== null ? <div className={`role-margin${close ? ' role-margin-close' : ''}`}>
      <strong>{close ? 'Близкие гипотезы' : 'Разница двух ведущих оценок'}: {scoreFormat.format(margin)}</strong>
      {close && <p>Разница меньше 0,05: при исследовании учитывайте обе ведущие роли.</p>}
    </div> : <p className="role-scoring-note">Для наблюдаемых признаков рассчитана только одна гипотеза.</p>}
  </section>;
}

function ClientDetails({ node, data }: { node: NodeRow; data: GraphData }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => { setCopyState('idle'); }, [node.gid]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(node.gid);
      setCopyState('copied');
    } catch { setCopyState('failed'); }
  };
  const daily = useMemo(() => dailyForNode(data, node.gid), [data, node.gid]);
  return <aside className="details-panel" aria-label="Карточка клиента">
    <div className="panel-heading"><span className="eyebrow">Профиль клиента</span><span className="depth-label">Шаг от исходного: {node.depth}</span></div>
    <div className="client-id-line"><h2 title={node.gid}>{node.gid}</h2><button className="icon-button" title="Скопировать полный ID" aria-label="Скопировать ID" onClick={copy}>{copyState === 'copied' ? <Check size={15} /> : <Copy size={15} />}</button></div>
    <div className="copy-feedback" role="status">{copyState === 'copied' ? 'ID скопирован' : copyState === 'failed' ? 'Не удалось скопировать. ID можно выделить вручную.' : ''}</div>
    <div className="client-role-line"><RoleBadge role={node.role} />{node.is_seed && <span className="seed-badge">Исходный</span>}</div>
    <p className="role-description">{roles[node.role].description}</p>
    <div className="score-card">
      <div><span>Приоритет исследования</span><strong>{node.priority_score.toFixed(3)}<small> / 1</small></strong></div>
      <div className="score-track"><span style={{ width: percent(node.priority_score) }} /></div>
      <p>Относительный приоритет, не вероятность нарушения</p>
      <PriorityBreakdown node={node} />
    </div>
    <div className="money-pair">
      <div><span><ArrowDownLeft size={14} /> Входящие</span><strong title={money(node.in_kzt)}>{shortMoney(node.in_kzt)}</strong><small>Отправителей: {node.in_deg} · переводов: {node.in_tx}</small></div>
      <div><span><ArrowUpRight size={14} /> Исходящие</span><strong title={money(node.out_kzt)}>{shortMoney(node.out_kzt)}</strong><small>Получателей: {node.out_deg} · переводов: {node.out_tx}</small></div>
    </div>
    <section className="evidence-section"><h3><ShieldCheck size={15} /> Почему эта роль</h3><p>{readableEvidence(node)}</p><div className="support-line"><span>Поддержка после поправок</span><strong>{node.role_score.toFixed(3)} / 1</strong></div><RoleHypotheses node={node} /><details className="raw-evidence"><summary>Показать исходные признаки</summary><p>{node.evidence}</p></details></section>
    {node.truncated_by_depth && <div className="observation-note boundary-note"><strong>Граница наблюдения</strong><p>Обход закончился на 4-м колене. Переводы дальше могут существовать за пределами выборки.</p></div>}
    {node.is_seed && <div className="observation-note"><strong>Неполные входящие</strong><p>У исходных клиентов часть поступлений находится за границей выгрузки.</p></div>}
    {node.flags.includes('temporal_right_censored') && <div className="observation-note"><strong>Не завершено окно наблюдения</strong><p>Для части поступлений до конца выгрузки осталось меньше {node.window_days} {plural(node.window_days, 'дня', 'дней', 'дней')}. Последующие переводы могут не попасть в анализ; поддержка роли «Транзит» учитывает эту неполноту.</p></div>}
    {node.flags.includes('no_observed_external_transfers') && <div className="observation-note"><strong>Недостаточно наблюдений</strong><p>Клиент сохранён в анализе, хотя внешних переводов в выборке нет.</p></div>}
    <section className="activity-section"><div className="section-label"><h3>Динамика переводов</h3><span>{node.active_days} акт. дней</span></div><div className="chart-legend"><span><i className="legend-in" />Входящие</span><span><i className="legend-out" />Исходящие</span></div><DailyChart rows={daily} /><p className="chart-footnote">Активные дни. Порядок переводов внутри дня неизвестен.</p></section>
    <dl className="detail-facts">
      <div><dt>Группа</dt><dd>#{node.cluster_id + 1}</dd></div>
      <div><dt>Связано с исходными клиентами</dt><dd>{node.seed_sources}</dd></div>
      <div><dt>Сопоставимый исходящий объём за {node.window_days} дн.</dt><dd>{node.following_days_out_share === null ? 'Нет входящих' : percent(node.following_days_out_share)}</dd></div>
      <div><dt>Клиентов в цикле</dt><dd>{node.cycle_component_size || 'Нет цикла'}</dd></div>
    </dl>
    <p className="details-footnote">Сопоставление сумм и наличие пути не доказывают происхождение средств.</p>
  </aside>;
}

function Transactions({ data, node, onSelect, from, to, direction, setFrom, setTo, setDirection }: { data: GraphData; node: NodeRow; onSelect: (gid: string) => void } & TransactionFilters) {
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [node.gid, from, to, direction]);
  const rows = useMemo(() => transactionsForNode(data, node.gid, from, to).filter(row => direction === 'all' || (direction === 'in' ? row.dst === node.gid : row.src === node.gid)), [data, node.gid, from, to, direction]);
  const pageSize = 8;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  const visible = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  return <section className="transactions-panel" id="client-transactions">
    <div className="transactions-heading"><div><h2>Переводы клиента <span>{shortId(node.gid)}</span></h2><p>Исходные операции, включая повторяющиеся строки</p></div>
      <div className="transaction-filters"><select aria-label="Направление переводов" value={direction} onChange={event => setDirection(event.target.value as typeof direction)}><option value="all">Все направления</option><option value="in">Входящие</option><option value="out">Исходящие</option></select><input aria-label="Переводы с даты" type="date" value={from} onInput={event => setFrom(event.currentTarget.value)} onChange={event => setFrom(event.target.value)} /><span>—</span><input aria-label="Переводы по дату" type="date" value={to} onInput={event => setTo(event.currentTarget.value)} onChange={event => setTo(event.target.value)} /></div>
    </div>
    <div className="table-scroll"><table><thead><tr><th>Дата</th><th>Направление</th><th>Контрагент</th><th className="numeric">Сумма</th><th /></tr></thead><tbody>{visible.map((row, index) => {
      const incoming = row.dst === node.gid;
      const counterparty = incoming ? row.src : row.dst;
      return <tr key={`${currentPage}-${index}-${row.date}-${row.src}-${row.dst}`}><td>{new Date(`${row.date}T12:00:00`).toLocaleDateString('ru-RU')}</td><td><span className={`direction ${incoming ? 'incoming' : 'outgoing'}`}>{incoming ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}{row.src === row.dst ? 'Самоперевод' : incoming ? 'Входящий' : 'Исходящий'}</span></td><td><button className="id-link" onClick={() => onSelect(counterparty)}>{counterparty}</button></td><td className="numeric amount">{money(row.sum_minor / 100)}</td><td><button className="icon-button" aria-label={`Открыть клиента ${counterparty}`} onClick={() => onSelect(counterparty)}><ArrowUpRight size={15} /></button></td></tr>;
    })}</tbody></table></div>
    {!rows.length && <div className="table-empty">{from && to && from > to ? 'Начальная дата должна быть не позже конечной.' : 'За выбранный период переводов не найдено.'}</div>}
    <div className="table-footer"><span>{rows.length ? `${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, rows.length)} из ${rows.length} переводов` : '0 переводов'}</span><div><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Назад</button><button disabled={(currentPage + 1) * pageSize >= rows.length} onClick={() => setPage(currentPage + 1)}>Далее <ChevronRight size={14} /></button></div></div>
  </section>;
}

export default function InvestigationPage({ data, node, onSelectClient, onBrowseClients, onOpenMethod, ...filters }: { data: GraphData; node: NodeRow; onSelectClient: (gid: string) => void; onBrowseClients: () => void; onOpenMethod: () => void } & TransactionFilters) {
  return <>
    <div className="workspace-heading"><div><span>Выбранный клиент</span><h2 title={node.gid}>{node.gid}</h2></div><div className="workspace-actions"><button className="directory-trigger" onClick={onBrowseClients}>Выбрать клиента</button><button className="method-link" onClick={onOpenMethod}>Как читать данные</button></div></div>
    <div className="profile-workspace"><ClientDetails node={node} data={data} /></div>
    <div className="coverage-banner"><CircleHelp size={16} /><p><strong>{data.metadata.n_boundary} узла на границе выборки.</strong> Отсутствие исходящих переводов не подтверждает, что деньги остались у клиента.</p><button onClick={onOpenMethod}>Подробнее <ArrowRight size={14} /></button></div>
    <Transactions data={data} node={node} onSelect={onSelectClient} {...filters} />
  </>;
}
