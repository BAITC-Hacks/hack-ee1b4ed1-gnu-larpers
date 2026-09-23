import { useEffect, useRef, useState } from 'react';
import { CircleHelp, FileText, GitBranch, Layers3, PanelLeftClose, PanelLeftOpen, Search, Waypoints, X } from 'lucide-react';
import type { GraphData } from './types';

type View = 'report' | 'visualization' | 'explore' | 'clusters' | 'method';

interface SidebarNavProps {
  view: View;
  onNavigate: (view: View) => void;
  data: GraphData;
  selectedGid: string;
  onPickClient: (gid: string) => void;
  onBrowseClients: () => void;
  collapsed: boolean;
  onToggle: () => void;
}

const sections = [
  { view: 'report', label: 'Отчёт', icon: FileText },
  { view: 'visualization', label: 'Визуализация', icon: Waypoints },
  { view: 'explore', label: 'Исследование', icon: GitBranch },
  { view: 'clusters', label: 'Группы клиентов', icon: Layers3 },
  { view: 'method', label: 'Методика', icon: CircleHelp },
] as const;

export default function SidebarNav({ view, onNavigate, data, selectedGid, onPickClient, onBrowseClients, collapsed, onToggle }: SidebarNavProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);
  const normalized = query.trim();
  const byId = new Map(data.nodes.map(node => [node.gid, node]));
  const visibleClients = normalized
    ? data.nodes.filter(node => node.gid.includes(normalized)).sort((a, b) => b.priority_score - a.priority_score).slice(0, 8)
    : data.top_nodes.slice(0, 8).map(item => byId.get(item.gid)).filter((node): node is GraphData['nodes'][number] => Boolean(node));

  useEffect(() => { if (searchOpen && !collapsed) searchRef.current?.focus(); }, [searchOpen, collapsed]);
  useEffect(() => { if (collapsed) { setSearchOpen(false); setQuery(''); } }, [collapsed]);

  const closeSearch = () => { setSearchOpen(false); setQuery(''); requestAnimationFrame(() => searchTriggerRef.current?.focus()); };

  return <aside className={`navigation-rail beautiful-sidebar ${collapsed ? 'collapsed' : ''}`} data-sidebar-collapsed={collapsed} aria-label="Навигация по аналитике">
    <div className="sidebar-inner">
      <header className="sidebar-header">
        <button className="sidebar-workspace-button" type="button" title="Открыть аналитический отчёт" aria-label="Открыть аналитический отчёт" tabIndex={collapsed ? -1 : 0} onClick={() => onNavigate('report')}>
          <span className="sidebar-monogram">Г</span><span className="sidebar-copy sidebar-workspace-name">Граф денег</span>
        </button>
        <button className="sidebar-toggle" type="button" onClick={onToggle} aria-label={collapsed ? 'Развернуть боковую панель' : 'Свернуть боковую панель'} title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
      </header>

      <nav className="sidebar-primary" aria-label="Разделы">
        <button className="sidebar-row sidebar-browse" type="button" onClick={onBrowseClients} title={collapsed ? 'Выбрать клиента' : undefined}><Search size={18} strokeWidth={1.8} /><span className="sidebar-copy">Выбрать клиента</span></button>
        <div className="sidebar-primary-divider" />
        {sections.map(item => <button key={item.view} className={`sidebar-row ${view === item.view ? 'active' : ''}`} type="button" aria-label={item.label} aria-current={view === item.view ? 'page' : undefined} title={collapsed ? item.label : undefined} onClick={() => onNavigate(item.view)}><item.icon size={18} strokeWidth={1.8} /><span className="sidebar-copy">{item.label}</span></button>)}
      </nav>

      <section className="sidebar-clients" aria-label="Клиенты для проверки" aria-hidden={collapsed}>
        <div className="sidebar-clients-heading">
          <span className={`sidebar-clients-title ${searchOpen ? 'searching' : ''}`}>Клиенты для проверки</span>
          <button ref={searchTriggerRef} className={`sidebar-search-trigger ${searchOpen ? 'searching' : ''}`} type="button" aria-label="Поиск клиента" aria-expanded={searchOpen} onClick={() => setSearchOpen(true)}><Search size={16} /></button>
          <div className={`sidebar-search-field ${searchOpen ? 'open' : ''}`}>
            <Search size={15} />
            <input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') closeSearch(); }} placeholder="ID клиента" aria-label="Поиск клиента по ID" tabIndex={searchOpen && !collapsed ? 0 : -1} />
            <button type="button" onClick={closeSearch} aria-label="Закрыть поиск" tabIndex={searchOpen && !collapsed ? 0 : -1}><X size={15} /></button>
          </div>
        </div>
        <div className="sidebar-client-list">{visibleClients.map(node => <button key={node.gid} className={`sidebar-client-row ${selectedGid === node.gid && view === 'visualization' ? 'active' : ''}`} type="button" onClick={() => onPickClient(node.gid)} title={node.gid}><span>…{node.gid.slice(-8)}</span><small>{node.priority_score.toFixed(2)}</small></button>)}{!visibleClients.length && <p>Клиент не найден</p>}</div>
      </section>

      <footer className="sidebar-footer"><span className="status-dot" /><span className="sidebar-copy">Локальная выборка<small>{data.metadata.date_from?.slice(0, 7) ?? 'Без даты'}</small></span></footer>
    </div>
  </aside>;
}
