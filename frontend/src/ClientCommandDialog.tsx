import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, CornerDownLeft, Search } from 'lucide-react';
import { filterNodes } from './data';
import { number, plural } from './format';
import { roles, type GraphData, type NodeRow, type Role } from './types';

const PAGE_SIZE = 50;

export default function ClientCommandDialog({ data, open, onOpenChange, onSelect, currentGid, initialClusterId }: {
  data: GraphData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (gid: string) => void;
  currentGid: string;
  initialClusterId: number | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<Role | 'all'>('all');
  const [clusterId, setClusterId] = useState<number | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [activeIndex, setActiveIndex] = useState(0);

  const matches = useMemo(() => filterNodes(data, query, role, clusterId), [data, query, role, clusterId]);
  const visible = useMemo(() => matches.slice(0, limit), [matches, limit]);
  const showSuggestions = !query.trim() && role === 'all' && clusterId === null;
  const suggested = showSuggestions ? visible.slice(0, 8) : [];
  const remaining = showSuggestions ? visible.slice(8) : visible;

  useEffect(() => {
    const down = (event: globalThis.KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    inputRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      previousFocus?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setRole('all');
    setClusterId(initialClusterId);
    setLimit(PAGE_SIZE);
    setActiveIndex(0);
  }, [open, initialClusterId]);

  useEffect(() => { setLimit(PAGE_SIZE); setActiveIndex(0); }, [query, role, clusterId]);
  useEffect(() => {
    if (!open) return;
    const active = visible[activeIndex];
    if (active) document.getElementById(`client-command-${active.gid}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, visible]);

  const choose = (node: NodeRow) => {
    onOpenChange(false);
    onSelect(node.gid);
  };
  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (activeIndex === visible.length - 1 && visible.length < matches.length) {
        setLimit(current => current + PAGE_SIZE);
        setActiveIndex(current => current + 1);
      } else setActiveIndex(current => Math.min(current + 1, visible.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(current => Math.max(0, current - 1));
    } else if (event.key === 'Enter' && visible[activeIndex]) {
      event.preventDefault();
      choose(visible[activeIndex]);
    }
  };
  const renderItem = (node: NodeRow, index: number) => <button
    id={`client-command-${node.gid}`}
    key={node.gid}
    type="button"
    role="option"
    tabIndex={-1}
    aria-selected={activeIndex === index}
    className={`client-command-item ${activeIndex === index ? 'is-active' : ''}`}
    onMouseEnter={() => setActiveIndex(index)}
    onClick={() => choose(node)}
  >
    <span className="client-command-item-icon" aria-hidden="true">{node.gid.slice(-6, -4)}</span>
    <span className="client-command-item-main"><strong>{node.gid}</strong><small><i style={{ background: roles[node.role].color }} />{roles[node.role].label}<span>·</span>Группа {node.cluster_id + 1}{node.is_seed ? ' · исходный' : ''}</small></span>
    {currentGid === node.gid && <span className="client-command-current">Текущий</span>}
    <span className="client-command-score">{node.priority_score.toFixed(3)}</span>
  </button>;

  return <dialog
    ref={dialogRef}
    className="client-command-dialog"
    aria-label="Выбрать клиента"
    onCancel={event => { event.preventDefault(); onOpenChange(false); }}
    onClose={() => onOpenChange(false)}
    onClick={event => { if (event.target === dialogRef.current) onOpenChange(false); }}
  >
    <div className="client-command-popup">
      <div className="client-command-search"><Search size={19} strokeWidth={1.8} /><input ref={inputRef} role="combobox" aria-label="Поиск клиента" aria-autocomplete="list" aria-expanded={open} aria-controls="client-command-list" aria-activedescendant={visible[activeIndex] ? `client-command-${visible[activeIndex].gid}` : undefined} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={handleInputKeyDown} placeholder="Найти клиента по ID, роли или признакам..." /><kbd>Esc</kbd></div>
      <div className="client-command-filters"><span>{number.format(matches.length)} {plural(matches.length, 'клиент', 'клиента', 'клиентов')}</span><div><select aria-label="Фильтр по роли" value={role} onChange={event => { setRole(event.target.value as Role | 'all'); inputRef.current?.focus(); }}><option value="all">Все роли</option>{Object.entries(roles).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select><select aria-label="Фильтр по группе" value={clusterId ?? 'all'} onChange={event => { setClusterId(event.target.value === 'all' ? null : Number(event.target.value)); inputRef.current?.focus(); }}><option value="all">Все группы</option>{data.clusters.map(group => <option key={group.cluster_id} value={group.cluster_id}>Группа {group.cluster_id + 1}</option>)}</select></div></div>
      <div className="client-command-panel" id="client-command-list" role="listbox" aria-label="Клиенты">
        {!matches.length && <div className="client-command-empty">Клиенты не найдены. Измените запрос или фильтры.</div>}
        {suggested.length > 0 && <div className="client-command-group"><div className="client-command-group-label">Приоритетные клиенты</div>{suggested.map((node, index) => renderItem(node, index))}</div>}
        {remaining.length > 0 && <div className="client-command-group"><div className="client-command-group-label">{showSuggestions ? 'Все клиенты' : clusterId !== null && !query ? `Клиенты группы ${clusterId + 1}` : 'Результаты поиска'}</div>{remaining.map((node, index) => renderItem(node, index + suggested.length))}</div>}
        {visible.length < matches.length && <button type="button" className="client-command-more" onClick={() => { setLimit(current => current + PAGE_SIZE); inputRef.current?.focus(); }}>Показать ещё {Math.min(PAGE_SIZE, matches.length - visible.length)}</button>}
      </div>
      <div className="client-command-footer"><div><span><kbd><ArrowUp size={13} /></kbd><kbd><ArrowDown size={13} /></kbd>Навигация</span><span><kbd><CornerDownLeft size={13} /></kbd>Открыть</span></div><span><kbd>Esc</kbd>Закрыть</span></div>
    </div>
  </dialog>;
}
