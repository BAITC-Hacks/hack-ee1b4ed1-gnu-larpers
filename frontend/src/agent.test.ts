import { describe, expect, it } from 'vitest';
import { evidenceGraph, evidenceTransactionAction, parseAgentResponse, parseAgentStatus } from './agent';
import type { GraphData } from './types';

const a = '9007199254740992';
const b = '9007199254740993';
const c = '9007199254740994';
const data = {
  metadata: { analysis_id: 'analysis-a' },
  nodes: [{ gid: a }, { gid: b }, { gid: c }],
  edges: [{ src: a, dst: b }, { src: b, dst: c }, { src: c, dst: b }, { src: a, dst: c }],
  clusters: [{ cluster_id: 0 }],
} as GraphData;

function response() {
  return {
    analysis_id: 'analysis-a', conversation_id: 'conversation-a',
    answer: {
      summary: 'В наблюдаемом графе есть путь.',
      findings: [{ text: 'Два направленных перехода.', evidence_ids: ['path-1'] }],
      hypotheses: [],
      limitations: ['Структурная связь не доказывает происхождение денег.'],
    },
    evidence: [{
      id: 'path-1', title: 'Путь от исходного клиента', facts: [{ label: 'Переходов', value: '2' }],
      node_ids: [c], paths: [{ node_ids: [a, b, c] }], cluster_id: 0,
      date_from: '2026-07-01', date_to: '2026-07-31',
      source: { tool: 'trace_seed_paths', gid: c, direction: null },
    }],
  };
}

describe('agent response evidence validation', () => {
  it('keeps neighboring large IDs distinct and preserves server facts and grounded findings', () => {
    const result = parseAgentResponse(JSON.parse(JSON.stringify(response())), data, null);
    expect(result.evidence[0].paths[0].node_ids).toEqual([a, b, c]);
    expect(result.evidence[0].facts).toEqual([{ label: 'Переходов', value: '2' }]);
    expect(result.answer.findings[0].evidence_ids).toEqual(['path-1']);
  });

  it.each([
    ['snapshot changed', (value: any) => { value.analysis_id = 'analysis-b'; }, /Версия анализа/],
    ['unknown node', (value: any) => { value.evidence[0].node_ids = ['123']; }, /Клиент.*отсутствует/],
    ['numeric ID loses precision', (value: any) => { value.evidence[0].node_ids = [Number(a)]; }, /некорректный текст/],
    ['reverse-only edge', (value: any) => { value.evidence[0].paths = [{ node_ids: [b, a] }]; }, /направленными связями/],
    ['missing path node', (value: any) => { value.evidence[0].paths = [{ node_ids: [a, '123'] }]; }, /Клиент.*отсутствует/],
    ['empty path', (value: any) => { value.evidence[0].paths = [{ node_ids: [] }]; }, /Путь.*не подтверждён/],
    ['unknown cluster', (value: any) => { value.evidence[0].cluster_id = 99; }, /Группа.*отсутствует/],
    ['missing citation', (value: any) => { value.answer.findings[0].evidence_ids = ['missing']; }, /подтверждённой ссылки/],
    ['ungrounded finding', (value: any) => { value.answer.findings[0].evidence_ids = []; }, /подтверждённой ссылки/],
    ['duplicate evidence ID', (value: any) => { value.evidence.push(value.evidence[0]); }, /неоднозначную ссылку/],
    ['impossible date', (value: any) => { value.evidence[0].date_from = '2026-02-30'; }, /некорректную дату/],
    ['reversed period', (value: any) => { value.evidence[0].date_from = '2026-08-01'; }, /некорректный период/],
  ])('rejects %s before allowing graph actions', (_name, mutate, error) => {
    const value = response();
    mutate(value);
    expect(() => parseAgentResponse(value, data, null)).toThrow(error);
  });

  it.each([
    { tool: 'get_transactions', gid: c, direction: null },
    { tool: 'get_transactions', gid: null, direction: 'in' },
    { tool: 'get_transactions', gid: c, direction: 'invalid' },
    { tool: 'get_transactions', gid: 'unknown', direction: 'in' },
  ])('rejects an incomplete or invalid transaction source', source => {
    const value = response();
    expect(() => parseAgentResponse({ ...value, evidence: [{ ...value.evidence[0], source }] }, data, null)).toThrow();
  });

  it('keeps model hypotheses separate from verified findings', () => {
    const value = response();
    const result = parseAgentResponse({ ...value, answer: { ...value.answer, hypotheses: ['Проверить гипотезу транзита.'] } }, data, null);
    expect(result.answer.hypotheses).toEqual(['Проверить гипотезу транзита.']);
    expect(result.answer.findings).toEqual(value.answer.findings);
  });

  it('rejects a response from a different conversation', () => {
    expect(() => parseAgentResponse(response(), data, 'conversation-b')).toThrow(/другому диалогу/);
  });

  it('accepts an empty result without inventing evidence', () => {
    const value = response();
    value.evidence = [];
    value.answer.findings = [];
    expect(parseAgentResponse(value, data, 'conversation-a').evidence).toEqual([]);
  });
});

describe('agent graph actions', () => {
  it.each(['all', 'in', 'out'] as const)('opens the exact %s transaction scope without requiring dates', direction => {
    const value = response();
    const card = value.evidence[0];
    const candidate = { ...card, date_from: null, date_to: null, source: { tool: 'get_transactions', gid: b, direction } };
    const result = parseAgentResponse({ ...value, evidence: [candidate] }, data, null);
    expect(evidenceTransactionAction(result.evidence[0])).toEqual({ type: 'transactions', gid: b, direction, from: null, to: null });
  });

  it('preserves the exact period in a transaction drilldown', () => {
    const value = response();
    const card = { ...value.evidence[0], source: { tool: 'get_transactions', gid: c, direction: 'out' as const } };
    expect(evidenceTransactionAction(card)).toEqual({ type: 'transactions', gid: c, direction: 'out', from: '2026-07-01', to: '2026-07-31' });
    expect(evidenceTransactionAction(value.evidence[0])).toBeNull();
  });

  it('shows only consecutive directed edges of evidence paths, excluding shortcuts and reverse edges', () => {
    const result = evidenceGraph(data, [[a, b, c]]);
    expect(result.nodes.map(node => node.gid)).toEqual([a, b, c]);
    expect(result.edges).toEqual([{ src: a, dst: b }, { src: b, dst: c }]);
  });

  it('keeps an entire long evidence path visible beyond the neighborhood cap', () => {
    const ids = Array.from({ length: 300 }, (_, index) => String(1000 + index));
    const longGraph = {
      ...data, nodes: ids.map(gid => ({ ...data.nodes[0], gid })),
      edges: ids.slice(1).map((gid, index) => ({ ...data.edges[0], src: ids[index], dst: gid })),
    };
    const result = evidenceGraph(longGraph, [ids]);
    expect(result.nodes.length).toBe(300);
    expect(result.edges.length).toBe(299);
    expect(result.truncated).toBe(false);
  });
});

describe('agent availability', () => {
  it('accepts an unavailable backend without blocking standalone analysis', () => {
    expect(parseAgentStatus({ available: false, reason: 'Нужен OPENAI_API_KEY', analysis_id: 'analysis-a', model: null }).available).toBe(false);
  });

  it('rejects an unavailable snapshot identity', () => {
    expect(() => parseAgentStatus({ available: true, reason: null, analysis_id: '', model: 'test' })).toThrow(/версию анализа/);
  });
});
