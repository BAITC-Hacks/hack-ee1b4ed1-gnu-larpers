import { useState } from 'react';
import { Button, IconButton, TextField, Tooltip } from '@radix-ui/themes';
import { History, MessageSquarePlus, Pencil, Search, Trash2, X } from 'lucide-react';
import { agentChatTitle, type AgentChat } from './agent-history';

interface AgentChatSidebarProps {
  chats: AgentChat[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
  onRename: (chat: AgentChat, title: string) => boolean;
  onDelete: (chat: AgentChat) => boolean;
}

const chatDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function AgentChatSidebar({ chats, activeId, onSelect, onNew, onClose, onRename, onDelete }: AgentChatSidebarProps) {
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const search = query.trim().toLocaleLowerCase('ru-RU');
  const filtered = chats.filter(chat => [agentChatTitle(chat), ...chat.turns.flatMap(turn => [turn.question, turn.response.answer.summary])].some(text => text.toLocaleLowerCase('ru-RU').includes(search)));

  return <section id="agent-chat-history" className="trace-agent-history" aria-label="Сохранённые чаты">
    <div className="trace-agent-history-heading"><div><h3>Чаты</h3><p>Текущий анализ · {chats.length}</p></div><IconButton type="button" size="1" variant="ghost" color="gray" aria-label="Закрыть список чатов" onClick={onClose}><X size={16} /></IconButton></div>
    <Button type="button" size="2" variant="soft" className="trace-agent-new-chat" onClick={() => { setQuery(''); setEditingId(null); setDeletingId(null); onNew(); }}><MessageSquarePlus size={15} />Новый чат</Button>
    <TextField.Root size="2" value={query} onChange={event => { setQuery(event.target.value); setEditingId(null); setDeletingId(null); }} aria-label="Поиск чатов" placeholder="Найти диалог…" className="trace-agent-chat-search"><TextField.Slot><Search size={14} /></TextField.Slot>{query && <TextField.Slot><IconButton type="button" size="1" variant="ghost" color="gray" aria-label="Очистить поиск чатов" onClick={() => setQuery('')}><X size={13} /></IconButton></TextField.Slot>}</TextField.Root>
    <div className="trace-agent-chat-list">
      {filtered.map(chat => {
        const name = agentChatTitle(chat);
        return <article key={chat.id} className="trace-agent-chat-item" data-current={activeId === chat.id}>
          {editingId === chat.id ? <form className="trace-agent-chat-edit" onSubmit={event => { event.preventDefault(); if (onRename(chat, title)) setEditingId(null); }}>
            <label htmlFor={`chat-title-${chat.id}`}>Название чата</label>
            <TextField.Root id={`chat-title-${chat.id}`} aria-label="Название чата" value={title} maxLength={120} autoFocus onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditingId(null); } }} />
            <div className="trace-agent-chat-edit-actions"><Button type="submit" size="1" disabled={!title.trim()} aria-label="Сохранить название">Сохранить</Button><Button type="button" size="1" variant="ghost" color="gray" aria-label="Отменить переименование" onClick={() => setEditingId(null)}>Отмена</Button></div>
          </form> : <>
            <button type="button" className="trace-agent-chat-open" aria-label={`Открыть чат ${name}`} aria-current={activeId === chat.id ? 'true' : undefined} onClick={() => { setDeletingId(null); onSelect(chat.id); }}>
              <span className="trace-agent-chat-title">{name}</span>
              <span className="trace-agent-chat-preview">{chat.turns.at(-1)!.response.answer.summary}</span>
              <time className="trace-agent-chat-date" dateTime={new Date(chat.updatedAt).toISOString()}>{chatDate.format(chat.updatedAt)}</time>
            </button>
            <div className="trace-agent-chat-meta"><span>Ответов: {chat.turns.length}{activeId === chat.id ? ' · Текущий' : ''}</span><div className="trace-agent-chat-actions"><Tooltip content="Переименовать"><IconButton type="button" size="1" variant="ghost" color="gray" aria-label={`Переименовать чат ${name}`} onClick={() => { setEditingId(chat.id); setTitle(name.slice(0, 120)); setDeletingId(null); }}><Pencil size={13} /></IconButton></Tooltip><Tooltip content="Удалить"><IconButton type="button" size="1" variant="ghost" color="gray" aria-label={`Удалить чат ${name}`} onClick={() => { setDeletingId(chat.id); setEditingId(null); }}><Trash2 size={13} /></IconButton></Tooltip></div></div>
          </>}
          {deletingId === chat.id && <div className="trace-agent-chat-delete" role="group" aria-label={`Удаление чата ${name}`}><p>Удалить этот чат? Переписку нельзя будет восстановить.</p><div className="trace-agent-chat-edit-actions"><Button type="button" size="1" color="red" aria-label="Удалить чат" onClick={() => { if (onDelete(chat)) setDeletingId(null); }}>Удалить</Button><Button type="button" size="1" variant="ghost" color="gray" onClick={() => setDeletingId(null)}>Отмена</Button></div></div>}
        </article>;
      })}
      {!filtered.length && <div className="trace-agent-history-empty"><History size={24} /><h4>{chats.length ? 'Чаты не найдены' : 'Здесь будут ваши диалоги'}</h4><p>{chats.length ? 'Попробуйте другое название или слова из переписки.' : 'Задайте агенту вопрос, чтобы сохранить первый чат.'}</p></div>}
    </div>
    <p className="trace-agent-session-note">История хранится в этом браузере.</p>
  </section>;
}
