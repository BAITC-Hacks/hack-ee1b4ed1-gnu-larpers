import { roles, type Role } from './types';

export const number = new Intl.NumberFormat('ru-RU');
export const moneyFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
export const compact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });
export const shortId = (gid: string) => `…${gid.slice(-8)}`;
export const money = (value: number) => `${moneyFormat.format(value)} ₸`;
export const shortMoney = (value: number) => `${compact.format(value)} ₸`;
export const percent = (value: number) => `${Math.round(value * 100)}%`;
export const plural = (value: number, one: string, few: string, many: string) => {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  const last = value % 10;
  return last === 1 ? one : last >= 2 && last <= 4 ? few : many;
};
export const dateLabel = (value: string | null) => value
  ? new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  : 'нет даты';

export function RoleBadge({ role }: { role: Role }) {
  return <span className={`role-badge role-${role}`}><i style={{ background: roles[role].color }} />{roles[role].label}</span>;
}

