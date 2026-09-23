import { parseAgentResponse, type AgentResponse } from './agent';
import type { GraphData } from './types';

export const AGENT_CHAT_PREFIX = 'money-graph:agent-chat:';
const ACTIVE_CHAT_PREFIX = 'money-graph:active-agent-chat:';
const DELETED_CHAT_PREFIX = 'money-graph:deleted-agent-chat:';

export interface AgentActivity {
  startedAt: number;
  elapsedMs: number;
  phase: 'connecting' | 'thinking' | 'tool' | 'answer' | 'validating';
  reasoning: string;
  tools: { id: string; name: string; state: 'started' | 'completed' }[];
}

export interface AgentTurn {
  id: string;
  question: string;
  selectedGid: string;
  response: AgentResponse;
  activity: AgentActivity;
}

export interface AgentChat {
  version: 1;
  id: string;
  analysisId: string;
  createdAt: number;
  updatedAt: number;
  closed: boolean;
  title?: string;
  turns: AgentTurn[];
}

type ChatStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem'>;

export class DeletedAgentChatError extends Error {
  constructor() { super('Этот чат уже удалён. Начните новый диалог.'); }
}

export function agentChatTitle(chat: AgentChat): string {
  return chat.title || chat.turns[0].question;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Запись чата повреждена.');
  return value as Record<string, unknown>;
}

function text(value: unknown, limit: number): string {
  if (typeof value !== 'string' || value.length > limit) throw new Error('Запись чата содержит некорректный текст.');
  return value;
}

function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 8640000000000000) throw new Error('Запись чата содержит некорректное время.');
  return value;
}

function parseActivity(value: unknown): AgentActivity {
  const row = record(value);
  if (!Array.isArray(row.tools) || row.tools.length > 128) throw new Error('Запись чата содержит некорректные этапы.');
  return {
    startedAt: timestamp(row.startedAt), elapsedMs: timestamp(row.elapsedMs), phase: 'validating',
    reasoning: text(row.reasoning, 24000),
    tools: row.tools.map(value => {
      const tool = record(value);
      if (tool.state !== 'started' && tool.state !== 'completed') throw new Error('Запись чата содержит некорректный этап.');
      return { id: text(tool.id, 200), name: text(tool.name, 100), state: tool.state };
    }),
  };
}

function parseChat(value: unknown, data: GraphData): AgentChat {
  const row = record(value);
  const id = text(row.id, 64);
  const analysisId = text(row.analysisId, 200);
  const createdAt = timestamp(row.createdAt);
  const updatedAt = timestamp(row.updatedAt);
  if (row.version !== 1 || !id || analysisId !== data.metadata.analysis_id || createdAt > updatedAt
    || typeof row.closed !== 'boolean' || !Array.isArray(row.turns) || !row.turns.length || row.turns.length > 8) throw new Error('Запись чата повреждена.');
  const turnIds = new Set<string>();
  const turns = row.turns.map(value => {
    const turn = record(value);
    const turnId = text(turn.id, 200);
    const question = text(turn.question, 4000);
    const selectedGid = text(turn.selectedGid, 200);
    if (!turnId || turnIds.has(turnId) || !question.trim() || !data.nodes.some(node => node.gid === selectedGid)) throw new Error('Запись чата содержит некорректный вопрос.');
    turnIds.add(turnId);
    return { id: turnId, question, selectedGid, response: parseAgentResponse(turn.response, data, id), activity: parseActivity(turn.activity) };
  });
  const title = row.title === undefined ? undefined : text(row.title, 120).trim();
  return { version: 1, id, analysisId, createdAt, updatedAt, closed: row.closed, turns, ...(title ? { title } : {}) };
}

function chatKey(id: string): string {
  return `${AGENT_CHAT_PREFIX}${encodeURIComponent(id)}`;
}

export function readAgentChats(storage: ChatStorage, data: GraphData) {
  const chats: AgentChat[] = [];
  let unreadable = 0;
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(AGENT_CHAT_PREFIX)) continue;
    try {
      const value = storage.getItem(key);
      if (value === null) continue;
      const row = record(JSON.parse(value));
      if (typeof row.analysisId === 'string' && row.analysisId !== data.metadata.analysis_id) continue;
      const chat = parseChat(row, data);
      if (chatKey(chat.id) !== key) throw new Error('Несовпадение ID чата.');
      if (storage.getItem(`${DELETED_CHAT_PREFIX}${encodeURIComponent(chat.id)}`) !== null) continue;
      chats.push(chat);
    } catch { unreadable++; }
  }
  chats.sort((left, right) => right.updatedAt - left.updatedAt);
  const savedActive = storage.getItem(`${ACTIVE_CHAT_PREFIX}${data.metadata.analysis_id}`);
  const activeId = savedActive === null ? chats[0]?.id ?? null : chats.find(chat => chat.id === savedActive)?.id ?? null;
  return { chats, activeId, unreadable };
}

export function saveAgentChat(storage: ChatStorage, chat: AgentChat, data: GraphData): AgentChat {
  if (storage.getItem(`${DELETED_CHAT_PREFIX}${encodeURIComponent(chat.id)}`) !== null) throw new DeletedAgentChatError();
  const stored = storage.getItem(chatKey(chat.id));
  if (stored !== null) {
    const previous = parseChat(JSON.parse(stored), data);
    const turns = new Map(previous.turns.map(turn => [turn.id, turn]));
    for (const turn of chat.turns) turns.set(turn.id, turn);
    chat = { ...chat, ...(previous.title ? { title: previous.title } : {}), createdAt: Math.min(chat.createdAt, previous.createdAt), updatedAt: Math.max(chat.updatedAt, previous.updatedAt), turns: [...turns.values()].sort((left, right) => left.activity.startedAt - right.activity.startedAt) };
  }
  storage.setItem(chatKey(chat.id), JSON.stringify(chat));
  return chat;
}

export function renameAgentChat(storage: ChatStorage, chat: AgentChat, title: string, data: GraphData): AgentChat {
  const trimmed = title.trim();
  if (!trimmed || trimmed.length > 120) throw new Error('Название должно содержать от 1 до 120 символов.');
  const updated = { ...saveAgentChat(storage, chat, data), title: trimmed };
  storage.setItem(chatKey(chat.id), JSON.stringify(updated));
  return updated;
}

export function deleteAgentChat(storage: ChatStorage & Pick<Storage, 'removeItem'>, chat: AgentChat): void {
  const deletedKey = `${DELETED_CHAT_PREFIX}${encodeURIComponent(chat.id)}`;
  storage.setItem(deletedKey, '1');
  try { storage.removeItem(chatKey(chat.id)); }
  catch (reason) {
    storage.removeItem(deletedKey);
    throw reason;
  }
}

export function saveActiveChat(storage: ChatStorage, analysisId: string, id: string | null): void {
  storage.setItem(`${ACTIVE_CHAT_PREFIX}${analysisId}`, id ?? '');
}

export function chatContinuationNotice(chat: AgentChat | undefined, now = Date.now()): string | null {
  if (!chat) return null;
  if (chat.closed) return 'Сеанс завершён. Следующий вопрос начнёт новый чат; эта переписка останется в истории.';
  if (chat.turns.length >= 8) return 'В этом чате достигнут лимит 8 вопросов. Следующий вопрос начнёт новый чат.';
  if (now - chat.updatedAt >= 30 * 60 * 1000) return 'Прошло более 30 минут. Следующий вопрос начнёт новый чат; эта переписка останется в истории.';
  return null;
}
