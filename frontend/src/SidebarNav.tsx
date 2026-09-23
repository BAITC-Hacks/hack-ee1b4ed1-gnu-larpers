import { useEffect, useRef } from 'react';
import { CircleHelp, FileText, GitBranch, Layers3, Menu, PanelLeftClose, PanelLeftOpen, Search, Table2, Waypoints } from 'lucide-react';

type View = 'report' | 'visualization' | 'explore' | 'clusters' | 'table' | 'method';

interface SidebarNavProps {
  view: View;
  onNavigate: (view: View) => void;
  onBrowseClients: () => void;
  commandOpen: boolean;
  collapsed: boolean;
  onToggle: () => void;
}

const sections = [
  { view: 'report', label: 'Отчёт', icon: FileText },
  { view: 'visualization', label: 'Визуализация', icon: Waypoints },
  { view: 'explore', label: 'Исследование', icon: GitBranch },
  { view: 'clusters', label: 'Группы клиентов', icon: Layers3 },
  { view: 'table', label: 'Таблица клиентов', icon: Table2 },
  { view: 'method', label: 'Методика', icon: CircleHelp },
] as const;

export default function SidebarNav({ view, onNavigate, onBrowseClients, commandOpen, collapsed, onToggle }: SidebarNavProps) {
  const mobileMenuRef = useRef<HTMLButtonElement>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!window.matchMedia('(max-width: 800px)').matches) return;
    if (!collapsed) sidebarToggleRef.current?.focus();
    else if (document.activeElement?.closest('#analytics-navigation')) mobileMenuRef.current?.focus();
  }, [collapsed]);

  return <>
    <header className="mobile-header">
      <button ref={mobileMenuRef} className="mobile-menu-toggle" type="button" onClick={onToggle} aria-label={collapsed ? 'Открыть меню' : 'Закрыть меню'} aria-expanded={!collapsed} aria-controls="analytics-navigation"><Menu size={20} /></button>
      <span className="mobile-brand">Анализ транзакций</span>
      <span className="mobile-section">{sections.find(item => item.view === view)?.label}</span>
    </header>
    <aside id="analytics-navigation" className={`navigation-rail beautiful-sidebar ${collapsed ? 'collapsed' : ''}`} data-sidebar-collapsed={collapsed} aria-label="Навигация по аналитике">
    <div className="sidebar-inner">
      <header className="sidebar-header">
        <button className="sidebar-workspace-button" type="button" title="Открыть аналитический отчёт" aria-label="Открыть аналитический отчёт" tabIndex={collapsed ? -1 : 0} onClick={() => onNavigate('report')}>
          <span className="sidebar-monogram">А</span><span className="sidebar-copy sidebar-workspace-name">Анализ транзакций</span>
        </button>
        <button ref={sidebarToggleRef} className="sidebar-toggle" type="button" onClick={onToggle} aria-expanded={!collapsed} aria-controls="analytics-navigation" aria-label={collapsed ? 'Развернуть боковую панель' : 'Свернуть боковую панель'} title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
      </header>

      <nav className="sidebar-primary" aria-label="Разделы">
        <button className="sidebar-row sidebar-browse" type="button" onClick={onBrowseClients} title={collapsed ? 'Выбрать клиента' : undefined} aria-haspopup="dialog" aria-expanded={commandOpen} aria-keyshortcuts="Meta+K Control+K"><Search size={18} strokeWidth={1.8} /><span className="sidebar-copy">Выбрать клиента</span><kbd className="sidebar-copy sidebar-command-shortcut">⌘ K</kbd></button>
        <div className="sidebar-primary-divider" />
        {sections.map(item => <button key={item.view} className={`sidebar-row ${view === item.view ? 'active' : ''}`} type="button" aria-label={item.label} aria-current={view === item.view ? 'page' : undefined} title={collapsed ? item.label : undefined} onClick={() => onNavigate(item.view)}><item.icon size={18} strokeWidth={1.8} /><span className="sidebar-copy">{item.label}</span></button>)}
      </nav>

    </div>
  </aside></>;
}
