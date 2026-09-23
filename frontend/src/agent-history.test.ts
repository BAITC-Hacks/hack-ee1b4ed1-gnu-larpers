import { describe, expect, it } from 'vitest';
import { AGENT_CHAT_PREFIX, agentChatTitle, chatContinuationNotice, deleteAgentChat, DeletedAgentChatError, readAgentChats, renameAgentChat, saveActiveChat, saveAgentChat, type AgentChat } from './agent-history';
import type { GraphData } from './types';

const gid = '9007199254740993';
const data = { metadata: { analysis_id: 'analysis-a' }, nodes: [{ gid }], edges: [], clusters: [] } as unknown as GraphData;

function storage() {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

function chat(id = 'chat-a', updatedAt = 2000): AgentChat {
  return {
    version: 1, id, analysisId: 'analysis-a', createdAt: 1000, updatedAt, closed: false,
    turns: [{
      id: `turn-${id}`, question: `Вопрос ${id}`, selectedGid: gid,
      activity: { startedAt: 1000, elapsedMs: 1000, phase: 'validating', reasoning: 'Проверены данные.', tools: [{ id: 'tool-1', name: 'get_node', state: 'completed' }] },
      response: {
        analysis_id: 'analysis-a', conversation_id: id,
        answer: { summary: 'Ответ агента', findings: [{ text: 'Факт', evidence_ids: ['evidence-1'] }], hypotheses: [], limitations: ['Ограниченная выборка'] },
        evidence: [{ id: 'evidence-1', title: 'Клиент', facts: [{ label: 'Роль', value: 'Транзит' }], node_ids: [gid], paths: [], cluster_id: null, date_from: null, date_to: null, source: { tool: 'get_node', gid, direction: null } }],
      },
    }],
  };
}

describe('saved agent chats', () => {
  it('restores separate conversations, exact evidence and the selected chat after storage reload', () => {
    const saved = storage();
    const first = chat();
    const second = chat('chat-b', 3000);
    saveAgentChat(saved, first, data);
    saveAgentChat(saved, second, data);
    saveActiveChat(saved, 'analysis-a', first.id);
    expect(readAgentChats(saved, data)).toEqual({ chats: [second, first], activeId: first.id, unreadable: 0 });
    saveActiveChat(saved, 'analysis-a', null);
    expect(readAgentChats(saved, data)).toEqual({ chats: [second, first], activeId: null, unreadable: 0 });
  });

  it('updates one chat without overwriting another saved by a different tab', () => {
    const saved = storage();
    const first = chat();
    const second = chat('chat-b', 3000);
    saveAgentChat(saved, first, data);
    readAgentChats(saved, data);
    saveAgentChat(saved, second, data);
    saveAgentChat(saved, { ...first, closed: true }, data);
    expect(readAgentChats(saved, data).chats).toEqual([second, { ...first, closed: true }]);
  });

  it('keeps all replies when two tabs save stale copies of the same conversation', () => {
    const saved = storage();
    const original = chat();
    saveAgentChat(saved, original, data);
    const tabA = readAgentChats(saved, data).chats[0];
    const tabB = readAgentChats(saved, data).chats[0];
    const replyA = { ...original.turns[0], id: 'reply-a', question: 'Продолжение в первой вкладке' };
    const replyB = { ...original.turns[0], id: 'reply-b', question: 'Продолжение во второй вкладке' };
    saveAgentChat(saved, { ...tabA, updatedAt: 3000, turns: [...tabA.turns, replyA] }, data);
    const merged = saveAgentChat(saved, { ...tabB, updatedAt: 4000, turns: [...tabB.turns, replyB] }, data);
    expect(merged.turns.map(turn => turn.question)).toEqual([original.turns[0].question, replyA.question, replyB.question]);
    expect(readAgentChats(saved, data).chats[0]).toEqual(merged);
  });

  it('preserves other analyses in storage and never applies their evidence to the current graph', () => {
    const saved = storage();
    saveAgentChat(saved, { ...chat(), analysisId: 'older-analysis' }, data);
    saveAgentChat(saved, chat('chat-b'), data);
    expect(readAgentChats(saved, data).chats.map(chat => chat.id)).toEqual(['chat-b']);
    expect(saved.length).toBe(2);
  });

  it.each([
    (entry: AgentChat) => { entry.turns[0].response.conversation_id = 'other-chat'; },
    (entry: AgentChat) => { entry.turns[0].response.evidence[0].node_ids = ['unknown']; },
    (entry: AgentChat) => { entry.turns[0].response.answer.findings[0].evidence_ids = ['missing']; },
    (entry: AgentChat) => { entry.turns.push(entry.turns[0]); },
    (entry: AgentChat) => { entry.updatedAt = -1; },
  ])('skips a damaged record without losing valid chats or overwriting stored data', corrupt => {
    const saved = storage();
    const broken = chat();
    corrupt(broken);
    saveAgentChat(saved, broken, data);
    saveAgentChat(saved, chat('chat-b'), data);
    saved.setItem(`${AGENT_CHAT_PREFIX}bad-json`, '{');
    const before = saved.getItem(`${AGENT_CHAT_PREFIX}chat-a`);
    const result = readAgentChats(saved, data);
    expect(result.chats.map(chat => chat.id)).toEqual(['chat-b']);
    expect(result.unreadable).toBe(2);
    expect(saved.getItem(`${AGENT_CHAT_PREFIX}chat-a`)).toBe(before);
  });

  it('propagates storage failure so the UI can report unsaved history', () => {
    const saved = storage();
    saveAgentChat(saved, chat(), data);
    const full = { ...saved, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(() => saveAgentChat(full, chat('chat-b'), data)).toThrow('QuotaExceededError');
    expect(readAgentChats(saved, data).chats).toEqual([chat()]);
  });

  it('preserves a renamed title when a stale tab appends a reply', () => {
    const saved = storage();
    const original = chat();
    saveAgentChat(saved, original, data);
    expect(agentChatTitle(original)).toBe(original.turns[0].question);
    renameAgentChat(saved, original, '  Проверка переводов  ', data);
    const followup = { ...original.turns[0], id: 'followup', question: 'Продолжение' };
    saveAgentChat(saved, { ...original, turns: [...original.turns, followup] }, data);
    const restored = readAgentChats(saved, data).chats[0];
    expect(agentChatTitle(restored)).toBe('Проверка переводов');
    expect(restored.turns).toHaveLength(2);
    expect(() => renameAgentChat(saved, restored, '  ', data)).toThrow(/Название/);
    expect(() => renameAgentChat(saved, restored, 'x'.repeat(121), data)).toThrow(/Название/);
    expect(readAgentChats(saved, data).chats[0]).toEqual(restored);
  });

  it('deletes only the selected chat and rejects late saves from another tab', () => {
    const saved = storage();
    const first = chat();
    const second = chat('chat-b');
    saveAgentChat(saved, first, data);
    saveAgentChat(saved, second, data);
    saveActiveChat(saved, 'analysis-a', first.id);
    deleteAgentChat(saved, first);
    expect(saved.getItem(`${AGENT_CHAT_PREFIX}${first.id}`)).toBeNull();
    expect(readAgentChats(saved, data)).toEqual({ chats: [second], activeId: null, unreadable: 0 });
    expect(() => saveAgentChat(saved, first, data)).toThrow(DeletedAgentChatError);
    expect(() => renameAgentChat(saved, first, 'Вернуть чат', data)).toThrow(DeletedAgentChatError);
    expect(readAgentChats(saved, data).chats).toEqual([second]);
  });

  it('keeps history readable when deleting a record fails', () => {
    const saved = storage();
    const first = chat();
    saveAgentChat(saved, first, data);
    const failing = { ...saved, removeItem: (key: string) => {
      if (key === `${AGENT_CHAT_PREFIX}${first.id}`) throw new Error('Storage unavailable');
      saved.removeItem(key);
    } };
    expect(() => deleteAgentChat(failing, first)).toThrow('Storage unavailable');
    expect(readAgentChats(saved, data).chats).toEqual([first]);
  });
});

describe('chat continuation', () => {
  it('continues a live session and starts a separate chat after expiry, cancellation or the turn limit', () => {
    const saved = chat();
    expect(chatContinuationNotice(saved, saved.updatedAt + 1000)).toBeNull();
    expect(chatContinuationNotice(saved, saved.updatedAt + 30 * 60 * 1000)).toMatch(/30 минут/);
    expect(chatContinuationNotice({ ...saved, closed: true }, 3000)).toMatch(/Сеанс завершён/);
    expect(chatContinuationNotice({ ...saved, turns: Array.from({ length: 8 }, () => saved.turns[0]) }, 3000)).toMatch(/8 вопросов/);
    expect(saved.turns).toHaveLength(1);
  });
});
