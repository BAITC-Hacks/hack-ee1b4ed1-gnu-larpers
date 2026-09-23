import { useMemo, useState, type PointerEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Columns3, Copy, RotateCcw, Search } from 'lucide-react';
import { money, number, plural } from '../format';
import { roles, type GraphData, type NodeRow, type Role } from '../types';

type Column = { key: string; label: string; group: string; width: number };
type Sort = { key: string; direction: 1 | -1 };

const GROUPS = [
  { name: 'Клиент', keys: ['gid', 'role', 'cluster_id', 'priority_score', 'is_seed', 'role_score', 'role_status', 'flags', 'evidence'] },
  { name: 'Переводы', keys: ['in_kzt', 'out_kzt', 'in_tx', 'out_tx', 'in_minor', 'out_minor', 'self_tx', 'self_minor', 'pass_through', 'pass_through_available'] },
  { name: 'Связи', keys: ['in_deg', 'out_deg', 'depth', 'seed_sources', 'neighbor_clusters', 'cycle_component_size', 'reciprocal_neighbors', 'pagerank', 'betweenness'] },
  { name: 'Активность', keys: ['active_days', 'same_day_activity_days', 'following_days_matched_minor', 'following_days_out_share', 'following_days_available', 'temporal_right_censored', 'max_daily_out_share', 'window_days'] },
  { name: 'Процентили', keys: ['in_amount_percentile', 'out_amount_percentile', 'in_tx_percentile', 'out_tx_percentile', 'turnover_percentile', 'tx_percentile', 'betweenness_percentile'] },
  { name: 'Ограничения', keys: ['truncated_by_depth'] },
];

const LABELS: Record<string, string> = {
  gid: 'ID клиента', role: 'Роль', cluster_id: 'Группа', priority_score: 'Приоритет', is_seed: 'Исходный', role_score: 'Оценка роли', role_status: 'Статус роли', flags: 'Флаги', evidence: 'Основание',
  in_kzt: 'Входящие, ₸', out_kzt: 'Исходящие, ₸', in_tx: 'Входящих переводов', out_tx: 'Исходящих переводов', in_minor: 'Входящие, тиын', out_minor: 'Исходящие, тиын', self_tx: 'Переводы себе', self_minor: 'Себе, тиын', pass_through: 'Транзитная доля', pass_through_available: 'Транзит рассчитан',
  in_deg: 'Отправителей', out_deg: 'Получателей', depth: 'Глубина', seed_sources: 'Исходных источников', neighbor_clusters: 'Соседних групп', cycle_component_size: 'Размер цикла', reciprocal_neighbors: 'Встречных связей', pagerank: 'PageRank', betweenness: 'Посредничество',
  active_days: 'Активных дней', same_day_activity_days: 'Дней с входом и выходом', following_days_matched_minor: 'Совпало далее, тиын', following_days_out_share: 'Доля выхода далее', following_days_available: 'Следующие дни доступны', temporal_right_censored: 'Конец периода ограничен', max_daily_out_share: 'Макс. доля выхода в день', window_days: 'Окно, дней',
  in_amount_percentile: 'Перцентиль входящей суммы', out_amount_percentile: 'Перцентиль исходящей суммы', in_tx_percentile: 'Перцентиль входящих переводов', out_tx_percentile: 'Перцентиль исходящих переводов', turnover_percentile: 'Перцентиль оборота', tx_percentile: 'Перцентиль числа переводов', betweenness_percentile: 'Перцентиль посредничества', truncated_by_depth: 'Ограничен глубиной',
};

const DEFAULT_COLUMNS = ['gid', 'role', 'cluster_id', 'priority_score', 'in_kzt', 'out_kzt', 'in_tx', 'out_tx', 'in_deg', 'out_deg', 'flags', 'evidence'];
const PAGE_SIZES = [50, 100, 250, 500] as const;

function buildColumns(rows: NodeRow[]): Column[] {
  const available = new Set(rows.flatMap(row => Object.keys(row)));
  const defined = new Set(GROUPS.flatMap(group => group.keys));
  const ordered = [...GROUPS.flatMap(group => group.keys), ...[...available].filter(key => !defined.has(key)).sort()];
  return ordered.filter(key => available.has(key)).map(key => ({
    key,
    label: LABELS[key] ?? key,
    group: GROUPS.find(group => group.keys.includes(key))?.name ?? 'Другие поля',
    width: key === 'gid' ? 244 : key === 'evidence' ? 345 : key === 'flags' ? 230 : key === 'role' ? 170 : Math.max(142, Math.min(240, (LABELS[key]?.length ?? key.length) * 7 + 32)),
  }));
}

function rawValue(row: NodeRow, key: string): unknown {
  return (row as unknown as Record<string, unknown>)[key];
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), 'ru', { numeric: true });
}

function CellValue({ row, keyName }: { row: NodeRow; keyName: string }): ReactNode {
  const value = rawValue(row, keyName);
  if (value == null || value === '') return <span className="records-muted">—</span>;
  if (keyName === 'role') {
    const role = value as Role;
    return <span className="records-role"><i style={{ background: roles[role].color }} />{roles[role].label}</span>;
  }
  if (keyName === 'cluster_id') return `Группа ${Number(value) + 1}`;
  if (keyName === 'flags') return Array.isArray(value) && value.length
    ? <span className="records-tags">{value.map(flag => <span className="records-tag" key={flag}>{flag}</span>)}</span>
    : <span className="records-muted">—</span>;
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  if (typeof value === 'number') {
    if (keyName.endsWith('_kzt')) return money(value);
    if (keyName === 'priority_score' || keyName === 'role_score') return value.toFixed(3);
    if (keyName.includes('share') || keyName.includes('percentile') || keyName === 'pass_through') return `${(value * 100).toFixed(1)}%`;
    if (keyName === 'pagerank' || keyName === 'betweenness') return value.toPrecision(3);
    return number.format(value);
  }
  return <span title={String(value)}>{String(value)}</span>;
}

function Checkbox({ checked, mixed = false, onChange, label }: { checked: boolean; mixed?: boolean; onChange: () => void; label: string }) {
  return <label className="records-checkbox" onClick={event => event.stopPropagation()}>
    <input type="checkbox" checked={checked} ref={input => { if (input) input.indeterminate = mixed; }} onChange={onChange} aria-label={label} />
    <span className="records-checkbox-box" aria-hidden="true">{checked ? <Check size={12} /> : mixed ? '−' : null}</span>
  </label>;
}

export function RecordsTable({ rows, onOpenClient }: { rows: NodeRow[]; onOpenClient: (gid: string) => void }) {
  const columns = useMemo(() => buildColumns(rows), [rows]);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(DEFAULT_COLUMNS);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [sort, setSort] = useState<Sort>({ key: 'priority_score', direction: -1 });
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<Role | 'all'>('all');
  const [cluster, setCluster] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const shownColumns = useMemo(() => columns.filter(column => visibleKeys.includes(column.key)), [columns, visibleKeys]);
  const clusters = useMemo(() => [...new Set(rows.map(row => row.cluster_id))].sort((a, b) => a - b), [rows]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru');
    return rows.filter(row =>
      (role === 'all' || row.role === role) &&
      (cluster === 'all' || row.cluster_id === Number(cluster)) &&
      (!needle || row.gid.includes(needle) || row.evidence.toLocaleLowerCase('ru').includes(needle) || row.flags.some(flag => flag.toLocaleLowerCase('ru').includes(needle)))
    ).sort((a, b) => compareValues(rawValue(a, sort.key), rawValue(b, sort.key)) * sort.direction || a.gid.localeCompare(b.gid));
  }, [rows, role, cluster, query, sort]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const allSelected = pageRows.length > 0 && pageRows.every(row => selected.has(row.gid));
  const mixedSelected = !allSelected && pageRows.some(row => selected.has(row.gid));

  const changeSort = (key: string) => setSort(current => current.key === key
    ? { key, direction: current.direction === 1 ? -1 : 1 }
    : { key, direction: key === 'gid' || key === 'role' ? 1 : -1 });
  const toggleRow = (gid: string) => setSelected(current => {
    const next = new Set(current);
    if (next.has(gid)) next.delete(gid); else next.add(gid);
    return next;
  });
  const togglePage = () => setSelected(current => {
    const next = new Set(current);
    pageRows.forEach(row => { if (allSelected) next.delete(row.gid); else next.add(row.gid); });
    return next;
  });
  const startResize = (event: PointerEvent<HTMLSpanElement>, key: string, baseWidth: number) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widths[key] ?? baseWidth;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const move = (next: globalThis.PointerEvent) => setWidths(current => ({ ...current, [key]: Math.max(110, startWidth + next.clientX - startX) }));
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };
  const copySelected = async () => {
    await navigator.clipboard.writeText([...selected].join('\n'));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return <section className="records-shell" aria-label="Таблица клиентов">
    <div className="records-toolbar">
      <div className="records-search"><Search size={16} /><input value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="ID, основание или флаг" aria-label="Поиск клиентов" /></div>
      <select aria-label="Фильтр по роли" value={role} onChange={event => { setRole(event.target.value as Role | 'all'); setPage(1); }}><option value="all">Все роли</option>{Object.entries(roles).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select>
      <select aria-label="Фильтр по группе" value={cluster} onChange={event => { setCluster(event.target.value); setPage(1); }}><option value="all">Все группы</option>{clusters.map(id => <option key={id} value={id}>Группа {id + 1}</option>)}</select>
      <details className="records-column-picker"><summary><Columns3 size={15} />Поля <span>{shownColumns.length}/{columns.length}</span></summary><div className="records-column-menu"><div className="records-column-menu-heading">Показать колонки <button type="button" onClick={() => setVisibleKeys(columns.map(column => column.key))}>Все</button><button type="button" onClick={() => setVisibleKeys(DEFAULT_COLUMNS)}>Сбросить</button></div>{[...new Set(columns.map(column => column.group))].map(group => <div className="records-column-group" key={group}><strong>{group}</strong>{columns.filter(column => column.group === group).map(column => <label key={column.key}><input type="checkbox" checked={visibleKeys.includes(column.key)} disabled={column.key === 'gid'} onChange={() => setVisibleKeys(current => current.includes(column.key) ? current.filter(key => key !== column.key) : [...current, column.key])} />{column.label}</label>)}</div>)}</div></details>
    </div>
    <div className="records-subbar"><span>{number.format(filtered.length)} {plural(filtered.length, 'клиент', 'клиента', 'клиентов')} из {number.format(rows.length)}</span><div>{selected.size > 0 && <><span>Выбрано: {number.format(selected.size)}</span><button type="button" onClick={() => void copySelected()}><Copy size={13} />{copied ? 'Скопировано' : 'Копировать ID'}</button><button type="button" onClick={() => setSelected(new Set())}>Снять выбор</button></>}{(query || role !== 'all' || cluster !== 'all') && <button type="button" onClick={() => { setQuery(''); setRole('all'); setCluster('all'); setPage(1); }}><RotateCcw size={13} />Сбросить фильтры</button>}</div></div>
    <div className="records-scroll" tabIndex={0} aria-label="Таблица клиентов с горизонтальной прокруткой">
      <table className="records-table" style={{ width: shownColumns.reduce((sum, column) => sum + (widths[column.key] ?? column.width), 0) }}>
        <colgroup>{shownColumns.map(column => <col key={column.key} style={{ width: widths[column.key] ?? column.width }} />)}</colgroup>
        <thead><tr>{shownColumns.map(column => <th key={column.key} className={`records-header-cell ${column.key === 'gid' ? 'records-sticky-cell' : ''}`} scope="col"><div className="records-header-content">{column.key === 'gid' && <Checkbox checked={allSelected} mixed={mixedSelected} onChange={togglePage} label="Выбрать клиентов на странице" />}<button type="button" className="records-header-button" onClick={() => changeSort(column.key)} title={`Сортировать: ${column.label}`}>{column.label}{sort.key === column.key && (sort.direction === 1 ? <ArrowUp size={13} /> : <ArrowDown size={13} />)}</button></div><span role="separator" aria-orientation="vertical" aria-label={`Изменить ширину: ${column.label}`} className="records-resize-handle" onPointerDown={event => startResize(event, column.key, column.width)} /></th>)}</tr></thead>
        <tbody>{pageRows.map(row => <tr key={row.gid} className={selected.has(row.gid) ? 'is-selected' : ''}>{shownColumns.map(column => <td key={column.key} className={`records-cell ${column.key === 'gid' ? 'records-sticky-cell' : ''}`} title={column.key === 'evidence' ? row.evidence : undefined}>{column.key === 'gid' ? <div className="records-company-cell"><Checkbox checked={selected.has(row.gid)} onChange={() => toggleRow(row.gid)} label={`Выбрать клиента ${row.gid}`} /><button className="records-client-link" type="button" onClick={() => onOpenClient(row.gid)} title="Открыть исследование клиента">{row.gid}</button></div> : <CellValue row={row} keyName={column.key} />}</td>)}</tr>)}</tbody>
        {pageRows.length > 0 && <tfoot><tr className="records-calculation-row"><td className="records-cell records-sticky-cell">{number.format(filtered.length)} записей</td>{shownColumns.slice(1).map(column => <td className="records-cell" key={column.key}>{column.key === 'in_kzt' || column.key === 'out_kzt' ? money(filtered.reduce((sum, row) => sum + Number(rawValue(row, column.key) ?? 0), 0)) : '—'}</td>)}</tr></tfoot>}
      </table>
      {!pageRows.length && <div className="records-empty">Клиенты не найдены. Измените запрос или сбросьте фильтры.</div>}
    </div>
    <div className="records-footer"><div className="records-footer-summary"><span>Показаны {filtered.length ? number.format((currentPage - 1) * pageSize + 1) : 0}–{number.format(Math.min(currentPage * pageSize, filtered.length))} из {number.format(filtered.length)}</span><label>На странице <select aria-label="Клиентов на странице" value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>{PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}</select></label></div><div className="records-footer-pages"><button type="button" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={currentPage === 1} aria-label="Предыдущая страница"><ChevronLeft size={16} /></button><span>Страница {currentPage} из {pageCount}</span><button type="button" onClick={() => setPage(current => Math.min(pageCount, current + 1))} disabled={currentPage === pageCount} aria-label="Следующая страница"><ChevronRight size={16} /></button></div></div>
  </section>;
}

export default function ClientsTablePage({ data, onOpenClient }: { data: GraphData; onOpenClient: (gid: string) => void }) {
  return <div className="records-page"><RecordsTable rows={data.nodes} onOpenClient={onOpenClient} /></div>;
}
