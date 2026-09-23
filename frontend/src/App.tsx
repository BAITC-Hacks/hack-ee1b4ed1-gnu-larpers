import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft, ArrowRight, ArrowUpRight, Check, ChevronDown, ChevronRight,
  CircleHelp, Copy, Download, GitBranch, Layers3, LoaderCircle, Network,
  Search, ShieldCheck, SlidersHorizontal, Users, X,
} from 'lucide-react';
import NetworkGraph from './NetworkGraph';
import { dailyForNode, filterNodes, parseGraphData, selectNeighborhood, transactionsForNode } from './data';
import { roles, type DailyRow, type GraphData, type NodeRow, type Role } from './types';

const number = new Intl.NumberFormat('ru-RU');
const moneyFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });
const shortId = (gid: string) => `…${gid.slice(-8)}`;
const money = (value: number) => `${moneyFormat.format(value)} ₸`;
const shortMoney = (value: number) => `${compact.format(value)} ₸`;
const percent = (value: number) => `${Math.round(value * 100)}%`;
const dateLabel = (value: string | null) => value
  ? new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  : 'нет даты';

function RoleBadge({ role }: { role: Role }) {
  return <span className={`role-badge role-${role}`}><i style={{ background: roles[role].color }} />{roles[role].label}</span>;
}

function DailyChart({ rows }: { rows: DailyRow[] }) {
  const maximum = Math.max(1, ...rows.flatMap(row => [row.in_minor, row.out_minor]));
  if (!rows.length) return <div className="chart-empty">Внешних переводов в выборке нет</div>;
  return <div className="daily-chart" aria-label="Входящие и исходящие суммы по активным дням">
    <div className="chart-scale"><span>{shortMoney(maximum / 100)}</span><span>0 ₸</span></div>
    <div className="chart-body">
      <div className="chart-bars">{rows.map(row => <div className="day-bars" key={row.date} title={`${row.date}: входящие ${money(row.in_minor / 100)}, исходящие ${money(row.out_minor / 100)}`}>
        <span className="bar-in" style={{ height: `${row.in_minor / maximum * 100}%` }} />
        <span className="bar-out" style={{ height: `${row.out_minor / maximum * 100}%` }} />
      </div>)}</div>
      <div className="chart-dates"><span>{dateLabel(rows[0].date)}</span><span>{dateLabel(rows[rows.length - 1].date)}</span></div>
    </div>
  </div>;
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
    <div className="panel-heading"><span className="eyebrow">Профиль клиента</span><span className="depth-label">Колено {node.depth}</span></div>
    <div className="client-id-line"><h2 title={node.gid}>{node.gid}</h2><button className="icon-button" title="Скопировать полный ID" aria-label="Скопировать ID" onClick={copy}>{copyState === 'copied' ? <Check size={15} /> : <Copy size={15} />}</button></div>
    <div className="copy-feedback" role="status">{copyState === 'copied' ? 'ID скопирован' : copyState === 'failed' ? 'Не удалось скопировать. ID можно выделить вручную.' : ''}</div>
    <div className="client-role-line"><RoleBadge role={node.role} />{node.is_seed && <span className="seed-badge">Seed</span>}</div>
    <p className="role-description">{roles[node.role].description}</p>
    <div className="score-card">
      <div><span>Приоритет исследования</span><strong>{node.priority_score.toFixed(3)}<small> / 1</small></strong></div>
      <div className="score-track"><span style={{ width: percent(node.priority_score) }} /></div>
      <p>Относительный приоритет, не вероятность нарушения</p>
    </div>
    <div className="money-pair">
      <div><span><ArrowDownLeft size={14} /> Входящие</span><strong title={money(node.in_kzt)}>{shortMoney(node.in_kzt)}</strong><small>Отправителей: {node.in_deg} · переводов: {node.in_tx}</small></div>
      <div><span><ArrowUpRight size={14} /> Исходящие</span><strong title={money(node.out_kzt)}>{shortMoney(node.out_kzt)}</strong><small>Получателей: {node.out_deg} · переводов: {node.out_tx}</small></div>
    </div>
    <section className="evidence-section"><h3><ShieldCheck size={15} /> Основания для роли</h3><p>{node.evidence}</p><div className="support-line"><span>Поддержка гипотезы</span><strong>{node.role_score.toFixed(3)} / 1</strong></div></section>
    {node.truncated_by_depth && <div className="observation-note boundary-note"><strong>Граница наблюдения</strong><p>Обход закончился на 4-м колене. Переводы дальше могут существовать за пределами выборки.</p></div>}
    {node.is_seed && <div className="observation-note"><strong>Неполные входящие</strong><p>У исходных клиентов часть поступлений находится за границей выгрузки.</p></div>}
    {node.flags.includes('no_observed_external_transfers') && <div className="observation-note"><strong>Недостаточно наблюдений</strong><p>Клиент сохранён в анализе, хотя внешних переводов в выборке нет.</p></div>}
    <section className="activity-section"><div className="section-label"><h3>Динамика переводов</h3><span>{node.active_days} акт. дней</span></div><div className="chart-legend"><span><i className="legend-in" />Входящие</span><span><i className="legend-out" />Исходящие</span></div><DailyChart rows={daily} /><p className="chart-footnote">Активные дни. Порядок переводов внутри дня неизвестен.</p></section>
    <dl className="detail-facts">
      <div><dt>Группа</dt><dd>#{node.cluster_id + 1}</dd></div>
      <div><dt>Достижимых источников seed</dt><dd>{node.seed_sources}</dd></div>
      <div><dt>Сопоставление за 1–{node.window_days} дня</dt><dd>{node.following_days_out_share === null ? 'Нет входящих' : percent(node.following_days_out_share)}</dd></div>
      <div><dt>Узлов в циклической компоненте</dt><dd>{node.cycle_component_size || 'Нет цикла'}</dd></div>
    </dl>
    <p className="details-footnote">Сопоставление сумм и наличие пути не доказывают происхождение средств.</p>
  </aside>;
}

function Transactions({ data, node, onSelect }: { data: GraphData; node: NodeRow; onSelect: (gid: string) => void }) {
  const [from, setFrom] = useState(data.metadata.date_from ?? '');
  const [to, setTo] = useState(data.metadata.date_to ?? '');
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState<'all' | 'in' | 'out'>('all');
  useEffect(() => { setPage(0); }, [node.gid, from, to, direction]);
  const rows = useMemo(() => transactionsForNode(data, node.gid, from, to).filter(row => direction === 'all' || (direction === 'in' ? row.dst === node.gid : row.src === node.gid)), [data, node.gid, from, to, direction]);
  const pageSize = 8;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  const visible = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  return <section className="transactions-panel">
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

function Methodology({ data }: { data: GraphData }) {
  return <section className="methodology-page"><div className="section-intro"><span className="eyebrow">Прозрачный анализ</span><h2>Что стоит за результатами</h2><p>Роли — объяснимые гипотезы о поведении внутри доступной выборки.</p></div>
    <div className="method-grid"><article><span className="method-number">01</span><h3>Движение средств</h3><p>Учитываем направление связей, число контрагентов, суммы и количество переводов. Посредничество показывает положение на направленных кратчайших путях.</p></article><article><span className="method-number">02</span><h3>Группы клиентов</h3><p>Louvain объединяет клиентов по ненаправленной проекции связей с логарифмом денежного веса. Параметр разрешения: {data.metadata.parameters.resolution}; seed: {data.metadata.parameters.random_seed}.</p></article><article><span className="method-number">03</span><h3>Проверка по датам</h3><p>Объёмы сопоставляются в следующие {data.metadata.parameters.window_days} дня. Один входящий объём используется не больше одного раза. Это не доказательство происхождения денег.</p></article></div>
    <h3 className="method-role-heading">Роли в графе</h3><div className="method-roles">{Object.entries(roles).map(([key, role]) => <article key={key}><RoleBadge role={key as Role} /><p>{role.description}</p></article>)}</div>
    <div className="method-limits"><CircleHelp size={24} /><div><h3>Границы наблюдения — часть результата</h3><p>{number.format(data.metadata.n_boundary)} узла находятся на границе обхода: отсутствие исходящих не подтверждает, что деньги остались у них. У {data.metadata.n_seed} seed-клиентов входящие неполны. Видны только внутрибанковские переводы от 5 000 ₸ за июль 2026 года.</p><p>Приоритет и поддержка роли — эвристические оценки от 0 до 1. Они не являются вероятностью нарушения. Размеченных ролей для измерения точности нет.</p></div></div>
  </section>;
}

function Workspace({ data }: { data: GraphData }) {
  const [selectedGid, setSelectedGid] = useState(data.top_nodes[0]?.gid ?? data.nodes[0].gid);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<Role | 'all'>('all');
  const [clusterId, setClusterId] = useState<number | null>(null);
  const [scope, setScope] = useState<1 | 2 | 'all'>(1);
  const [view, setView] = useState<'explore' | 'clusters' | 'method'>('explore');
  const [exportsOpen, setExportsOpen] = useState(false);
  const [listLimit, setListLimit] = useState(50);
  const nodeById = useMemo(() => new Map(data.nodes.map(node => [node.gid, node])), [data]);
  const selected = nodeById.get(selectedGid)!;
  const filtered = useMemo(() => filterNodes(data, query, role, clusterId), [data, query, role, clusterId]);
  useEffect(() => { setListLimit(50); }, [query, role, clusterId]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExportsOpen(false); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  const graph = useMemo(() => {
    if (scope !== 'all') return selectNeighborhood(data, selectedGid, scope);
    const nodes = data.nodes.filter(node => clusterId === null || node.cluster_id === clusterId);
    const ids = new Set(nodes.map(node => node.gid));
    return { nodes, edges: data.edges.filter(edge => ids.has(edge.src) && ids.has(edge.dst)), totalNodes: nodes.length, truncated: false };
  }, [data, selectedGid, scope, clusterId]);
  const selectNode = (gid: string) => {
    const node = nodeById.get(gid);
    if (!node) return;
    setSelectedGid(gid);
    setView('explore');
    if (clusterId !== null && clusterId !== node.cluster_id) setClusterId(null);
    if (role !== 'all' && role !== node.role) setRole('all');
    if (query && !gid.includes(query.trim())) setQuery('');
  };
  const reset = () => { setQuery(''); setRole('all'); setClusterId(null); };
  const openCluster = (id: number, gid: string) => { setSelectedGid(gid); setClusterId(id); setRole('all'); setQuery(''); setScope('all'); setView('explore'); };
  return <div className="app-shell">
    <aside className="navigation-rail"><a href="#" className="brand" aria-label="Граф денег — исследование" onClick={event => { event.preventDefault(); setView('explore'); }}><Network size={24} strokeWidth={1.6} /></a><div className="rail-rule" /><nav aria-label="Основная навигация"><button className={view === 'explore' ? 'active' : ''} onClick={() => setView('explore')} title="Исследование" aria-label="Исследование" aria-current={view === 'explore' ? 'page' : undefined}><GitBranch size={21} /></button><button className={view === 'clusters' ? 'active' : ''} onClick={() => setView('clusters')} title="Группы клиентов" aria-label="Группы клиентов" aria-current={view === 'clusters' ? 'page' : undefined}><Layers3 size={21} /></button><button className={view === 'method' ? 'active' : ''} onClick={() => setView('method')} title="Методика" aria-label="Методика" aria-current={view === 'method' ? 'page' : undefined}><CircleHelp size={21} /></button></nav><div className="rail-bottom"><span className="status-dot" /><span>LOCAL</span></div></aside>
    <div className="page-content">
      <header className="topbar"><div className="wordmark">Граф денег<span> / </span><small>{view === 'explore' ? 'Исследование' : view === 'clusters' ? 'Группы клиентов' : 'Методика'}</small></div><div className="topbar-right"><span className="local-badge"><span className="status-dot" />Локальные данные</span><div className="avatar">АН</div></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">Аналитика переводов</div><h1>{view === 'explore' ? 'Связи, которые имеют значение' : view === 'clusters' ? 'Структура денежных потоков' : 'Понятные основания каждого вывода'}</h1><p>Внутрибанковские переводы · {dateLabel(data.metadata.date_from)} — {dateLabel(data.metadata.date_to)} 2026</p></div><div className="export-container"><button className="export-button" onClick={() => setExportsOpen(open => !open)} aria-expanded={exportsOpen}><Download size={16} />Экспорт результатов<ChevronDown size={14} /></button>{exportsOpen && <><button className="menu-backdrop" aria-label="Закрыть меню экспорта" onClick={() => setExportsOpen(false)} /><div className="export-menu">{[['nodes_roles.csv', 'Роли всех клиентов · CSV'], ['clusters.csv', 'Группы клиентов · CSV'], ['top_nodes.csv', 'Приоритетные клиенты · CSV'], ['graph.json', 'Полный граф · JSON']].map(([file, label]) => <a key={file} href={`/generated/${file}`} download onClick={() => setExportsOpen(false)}><Download size={14} />{label}</a>)}</div></>}</div></div>
        <div className="metrics-grid"><article className="metric-card"><div className="metric-label">Клиентов в графе<Users size={17} /></div><strong>{number.format(data.metadata.n_nodes)}</strong><span>{data.metadata.n_seed} исходных клиентов</span></article><article className="metric-card"><div className="metric-label">Наблюдаемый оборот<ArrowUpRight size={17} /></div><strong>{shortMoney(data.metadata.sum_minor / 100)}</strong><span>Сумма всех переводов в выборке</span></article><article className="metric-card"><div className="metric-label">Связей между клиентами<GitBranch size={17} /></div><strong>{number.format(data.metadata.n_edges)}</strong><span>{number.format(data.metadata.n_transactions)} отдельных транзакций</span></article><article className="metric-card accented"><div className="metric-label">Выделенных групп<Layers3 size={17} /></div><strong>{data.metadata.n_clusters}<span className="metric-tag">Louvain</span></strong><span>Гипотезы о структуре потоков</span></article></div>
        {view === 'explore' && <>
          <div className="workspace-heading"><div><h2>Исследование графа</h2><span>Выберите клиента, чтобы увидеть его связи и основания роли</span></div><button className="text-button" onClick={() => setView('method')}><CircleHelp size={14} />Как читать результаты</button></div>
          <div className="investigation-workspace">
            <aside className="client-list-panel"><div className="list-heading"><h3>Приоритетные клиенты</h3><SlidersHorizontal size={16} /></div><label className="search-field"><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти по полному ID или части" aria-label="Поиск клиента по ID" />{query && <button className="icon-button" aria-label="Очистить поиск" onClick={() => setQuery('')}><X size={13} /></button>}</label><div className="list-filters"><select aria-label="Фильтр по роли" value={role} onChange={event => setRole(event.target.value as Role | 'all')}><option value="all">Все роли</option>{Object.entries(roles).map(([key, item]) => <option value={key} key={key}>{item.label}</option>)}</select><select aria-label="Фильтр по группе" value={clusterId ?? 'all'} onChange={event => setClusterId(event.target.value === 'all' ? null : Number(event.target.value))}><option value="all">Все группы</option>{data.clusters.map(cluster => <option key={cluster.cluster_id} value={cluster.cluster_id}>Группа {cluster.cluster_id + 1} · {cluster.n_nodes}</option>)}</select></div><div className="list-count"><span>Клиентов: {number.format(filtered.length)} · по приоритету</span>{(query || role !== 'all' || clusterId !== null) && <button onClick={reset}>Сбросить</button>}</div>
              <div className="client-list">{filtered.slice(0, listLimit).map((node, index) => <button key={node.gid} onClick={() => selectNode(node.gid)} className={`client-row ${selectedGid === node.gid ? 'selected' : ''}`} aria-label={`Клиент ${node.gid}, ${roles[node.role].label}`} aria-pressed={selectedGid === node.gid}><span className="client-rank">{String(index + 1).padStart(2, '0')}</span><div className="client-row-main"><div className="row-id"><span title={node.gid}>{shortId(node.gid)}</span>{node.is_seed && <span className="seed-mark" title="Исходный клиент">S</span>}</div><RoleBadge role={node.role} /></div><span className="row-score">{node.priority_score.toFixed(2)}<div style={{ width: percent(node.priority_score) }} /></span></button>)}{!filtered.length && <div className="list-empty"><Search size={22} /><strong>Клиенты не найдены</strong><p>Измените ID или сбросьте фильтры.</p><button className="text-button" onClick={reset}>Сбросить фильтры</button></div>}{filtered.length > listLimit && <button className="load-more" onClick={() => setListLimit(limit => limit + 50)}>Показать ещё 50</button>}</div><div className="list-footer">Фильтры применяются к списку клиентов</div>
            </aside>
            <section className="graph-panel" aria-label="Граф переводов"><div className="graph-toolbar"><div><span className="graph-status" />{scope === 'all' ? clusterId === null ? 'Весь граф' : `Группа ${clusterId + 1}` : 'Окружение клиента'}</div><div className="scope-control" aria-label="Глубина отображения">{([1, 2, 'all'] as const).map(value => <button key={value} onClick={() => setScope(value)} className={scope === value ? 'active' : ''} aria-pressed={scope === value}>{value === 'all' ? 'Обзор' : `${value} ${value === 1 ? 'шаг' : 'шага'}`}</button>)}</div></div><div className="graph-stage"><NetworkGraph nodes={graph.nodes} edges={graph.edges} selectedGid={selectedGid} mode={scope === 'all' ? 'overview' : 'focus'} onSelect={selectNode} /></div><div className="graph-legend">{Object.entries(roles).map(([key, item]) => <span key={key}><i style={{ background: item.color }} />{item.label}</span>)}</div><div className="graph-footer"><span>Узлов: {graph.nodes.length} · связей: {graph.edges.length}</span><span>{graph.truncated ? `Показаны ${graph.nodes.length} из ${graph.totalNodes} по приоритету` : 'Стрелки показывают направление перевода'}</span></div></section>
            <ClientDetails node={selected} data={data} />
          </div>
          <div className="coverage-banner"><CircleHelp size={16} /><p><strong>{data.metadata.n_boundary} узла на границе выборки.</strong> Отсутствие исходящих переводов не подтверждает, что деньги остались у клиента.</p><button onClick={() => setView('method')}>Подробнее <ArrowRight size={14} /></button></div>
          <Transactions data={data} node={selected} onSelect={selectNode} />
        </>}
        {view === 'clusters' && <section className="clusters-page"><div className="section-intro"><h2>Группы клиентов</h2><p>Состав групп отражает связи в выборке. Их экономическое назначение требует дополнительной проверки.</p></div><div className="cluster-grid">{[...data.clusters].sort((a, b) => b.n_nodes - a.n_nodes || a.cluster_id - b.cluster_id).map(cluster => <button className="cluster-card" key={cluster.cluster_id} onClick={() => openCluster(cluster.cluster_id, cluster.top_gids[0])}><div className="cluster-card-title"><span><Layers3 size={17} />Группа {cluster.cluster_id + 1}</span><ArrowUpRight size={18} /></div><strong>{number.format(cluster.n_nodes)}<small> клиентов</small></strong><div className="cluster-stats"><span>{cluster.n_seed} seed</span><span>{shortMoney(cluster.sum_kzt_internal)} внутри группы</span></div><p>{cluster.hypothesis}</p><span className="cluster-open">Исследовать группу <ArrowRight size={14} /></span></button>)}</div></section>}
        {view === 'method' && <Methodology data={data} />}
        <footer className="page-footer"><span><Network size={14} />Граф денег</span><span>Объяснимый анализ · Данные за июль 2026</span><span>Выводы описывают наблюдаемую выборку</span></footer>
      </main>
    </div>
  </div>;
}

export default function App() {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    fetch('/generated/graph.json', { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('Не удалось загрузить результаты анализа.'); return response.json(); })
      .then(value => setData(parseGraphData(value)))
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Ошибка загрузки данных.'); });
    return () => controller.abort();
  }, [attempt]);
  if (error) return <div className="app-state"><Network size={38} /><h1>Данные пока недоступны</h1><p>{error}</p><p>Подготовьте выгрузку командой <code>npm run data</code> в папке фронтенда.</p><button className="export-button" onClick={() => setAttempt(value => value + 1)}>Повторить загрузку</button></div>;
  if (!data) return <div className="app-state"><Network size={38} /><h1>Граф денег</h1><p><LoaderCircle size={17} className="spinner" />Загружаем результаты анализа</p></div>;
  return <Workspace data={data} />;
}
