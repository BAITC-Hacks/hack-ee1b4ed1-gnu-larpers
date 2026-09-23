import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { dateLabel, money, number, percent, shortMoney } from './format';
import { roles, type Role } from './types';

const tooltipProps = {
  isAnimationActive: false,
  cursor: { fill: '#a789ee18' },
  contentStyle: {
    background: '#27232e',
    border: '1px solid #514958',
    borderRadius: 7,
    color: '#f0eaf5',
    fontSize: 12,
    lineHeight: 1.5,
  },
  labelStyle: { color: '#c5bace', marginBottom: 5 },
  itemStyle: { color: '#f0eaf5', padding: '2px 0', fontVariantNumeric: 'tabular-nums' as const },
  wrapperStyle: { zIndex: 10 },
};

type TransferDay = { date: string; total_minor?: number; in_minor?: number; out_minor?: number };
type TransferSeries = { key: 'total_minor' | 'in_minor' | 'out_minor'; label: string; color: string };

export function DailyTransfersChart({ rows, series, compact = false, highlightedDate }: {
  rows: TransferDay[];
  series: TransferSeries[];
  compact?: boolean;
  highlightedDate?: string;
}) {
  if (!rows.length) return <div className="chart-empty">Переводов в выборке нет</div>;
  const maximum = Math.max(1, ...rows.flatMap(row => series.map(item => row[item.key] ?? 0)));
  const dates = [...new Set([rows[0].date, rows[rows.length - 1].date])];

  return <div className={`data-chart transfer-chart ${compact ? 'compact' : ''}`}>
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap="20%" barGap={2} accessibilityLayer aria-label={series.length > 1 ? 'Входящие и исходящие суммы по активным дням' : 'Дневной объём переводов за период'}>
        <CartesianGrid vertical={false} stroke="#313136" />
        <XAxis dataKey="date" ticks={dates} tickFormatter={dateLabel} tick={{ fill: '#898891', style: { fontSize: 10 } }} tickLine={false} axisLine={{ stroke: '#4e4d54' }} interval={0} height={24} />
        <YAxis domain={[0, maximum]} ticks={[0, maximum]} tickFormatter={value => shortMoney(value / 100)} tick={{ fill: '#898891', style: { fontSize: 10 } }} tickLine={false} axisLine={false} width={compact ? 60 : 76} />
        <Tooltip {...tooltipProps} formatter={value => money(Number(value) / 100)} labelFormatter={label => dateLabel(String(label))} />
        {series.map(item => <Bar key={item.key} dataKey={item.key} name={item.label} fill={item.color} radius={[2, 2, 0, 0]} isAnimationActive={false} activeBar={{ fill: '#c2a8f5' }}>
          {highlightedDate && rows.map(row => <Cell key={row.date} fill={row.date === highlightedDate ? '#a789ee' : item.color} />)}
        </Bar>)}
      </BarChart>
    </ResponsiveContainer>
  </div>;
}

export function RolesChart({ counts, total }: { counts: Record<Role, number>; total: number }) {
  const rows = (Object.keys(roles) as Role[])
    .sort((a, b) => counts[b] - counts[a])
    .map(role => ({
      role,
      label: roles[role].label,
      count: counts[role],
      fill: roles[role].color,
      display: `${number.format(counts[role])} · ${percent(total ? counts[role] / total : 0)}`,
    }));

  return <div className="data-chart roles-chart">
    <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 85, bottom: 0, left: 0 }} barSize={7} accessibilityLayer aria-label="Распределение клиентов по ролям">
        <XAxis type="number" hide domain={[0, Math.max(1, ...Object.values(counts))]} />
        <YAxis type="category" dataKey="label" width={112} tick={{ fill: '#c9c8cf', style: { fontSize: 10 } }} tickLine={false} axisLine={false} interval={0} />
        <Tooltip {...tooltipProps} formatter={value => [`${number.format(Number(value))} · ${percent(total ? Number(value) / total : 0)}`, 'Клиентов']} />
        <Bar dataKey="count" name="Клиентов" radius={[0, 3, 3, 0]} background={{ fill: '#323138', radius: 3 }} isAnimationActive={false}>
          <LabelList dataKey="display" position="right" fill="#e8e8eb" style={{ fontSize: 10 }} offset={8} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  </div>;
}
