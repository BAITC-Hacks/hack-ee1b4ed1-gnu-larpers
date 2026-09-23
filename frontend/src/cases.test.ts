import { describe, expect, it } from 'vitest';
import { evidenceTransactionAction, type EvidenceCard } from './agent';
import { addCaseEvidence, CASE_STORAGE_PREFIX, clientCaseEvidence, investigationMarkdown, readInvestigations, restoreInvestigation, saveInvestigation, transactionCaseEvidence, type CaseStorage } from './cases';
import { normalizeWorkspace, type WorkspaceSnapshot } from './stores/workspace';
import type { GraphData, NodeRow } from './types';

class MemoryStorage implements CaseStorage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const a = '9007199254740992';
const b = '9007199254740993';

function fixture(): GraphData {
  const node = (gid: string): NodeRow => ({
    gid, cluster_id: 0, role: 'transit', depth: 1, is_seed: false, role_score: .7,
    priority_score: .6, evidence: 'Наблюдаемые переводы', role_status: 'observed_pattern', flags: [],
    in_deg: 1, out_deg: 1, in_kzt: 1, out_kzt: 2, in_tx: 1, out_tx: 1, in_minor: 100, out_minor: 200,
    seed_sources: 1, active_days: 2, same_day_activity_days: 0, following_days_out_share: .5,
    following_days_matched_minor: 100, window_days: 3, truncated_by_depth: false,
    cycle_component_size: 2, neighbor_clusters: 0, pass_through: .5,
  });
  return {
    metadata: { analysis_id: 'analysis-one', schema_version: 1, n_nodes: 2, n_edges: 2, n_transactions: 5,
      n_clusters: 1, n_seed: 0, n_boundary: 0, n_isolated: 0, sum_minor: 1000,
      date_from: '2026-07-01', date_to: '2026-07-03', parameters: { window_days: 3, resolution: 1, random_seed: 42 } },
    nodes: [node(a), node(b)],
    edges: [{ src: a, dst: b, sum_kzt: 2, sum_minor: 200, n_tx: 1, depth: 1 }, { src: b, dst: a, sum_kzt: 1, sum_minor: 100, n_tx: 1, depth: 1 }],
    clusters: [{ cluster_id: 0, n_nodes: 2, n_seed: 0, sum_kzt_internal: 3, top_gids: [a], hypothesis: 'Группа' }],
    top_nodes: [{ rank: 1, gid: a, role: 'transit', priority_score: .6, why: 'Наблюдаемые переводы' }],
    transactions: [
      { src: b, dst: a, date: '2026-07-01', sum_kzt: 1, sum_minor: 100 },
      { src: a, dst: b, date: '2026-07-02', sum_kzt: 2, sum_minor: 200 },
      { src: a, dst: b, date: '2026-07-02', sum_kzt: 2, sum_minor: 200 },
      { src: a, dst: a, date: '2026-07-02', sum_kzt: 3, sum_minor: 300 },
      { src: a, dst: b, date: '2026-07-03', sum_kzt: 2, sum_minor: 200 },
    ], daily_flows: [],
  };
}

function state(data: GraphData, patch: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return normalizeWorkspace(data, { selectedGid: a, view: 'visualization', visualizationMode: 'cluster', clusterId: 0, hops: 2, includeExternal: true, from: '2026-07-02', to: '2026-07-03', direction: 'out', highlightedPaths: [[a, b]], ...patch });
}

describe('saved investigations', () => {
  it('round-trips exact client IDs, group context, paths, notes and filtered evidence through storage', () => {
    const storage = new MemoryStorage();
    const data = fixture();
    const snapshot = state(data);
    const evidence = transactionCaseEvidence(data, snapshot);
    const saved = saveInvestigation(storage, data, { title: '  Группа 1  ', notes: 'Проверить исходящие\nНе считать гипотезу доказательством.', snapshot, evidence: [evidence] });
    snapshot.highlightedPaths[0].push(a);
    evidence.facts[0].value = 'изменённый черновик';
    const read = readInvestigations(storage);
    expect(read.unreadable).toBe(0);
    expect(read.records[0].title).toBe('Группа 1');
    expect(read.records[0].id).toBe(saved.id);
    const restored = restoreInvestigation(read.records[0], data);
    expect(restored.snapshot).toMatchObject({ selectedGid: a, clusterId: 0, hops: 2, includeExternal: true, visualizationMode: 'cluster', from: '2026-07-02', to: '2026-07-03', direction: 'out', highlightedPaths: [[a, b]] });
    expect(restored.evidence[0].facts[0].value).toBe('4');
    expect(restored.evidence[0].source).toEqual({ tool: 'get_transactions', gid: a, direction: 'out' });
    expect(read.records[0].notes).toContain('\n');
  });

  it('updates only the selected record, keeping other analyses, unrelated storage and broken entries untouched', () => {
    const storage = new MemoryStorage();
    const data = fixture();
    const first = saveInvestigation(storage, data, { title: 'Первое', notes: '', snapshot: state(data), evidence: [] });
    const otherData = { ...data, metadata: { ...data.metadata, analysis_id: 'analysis-two' } };
    const second = saveInvestigation(storage, otherData, { title: 'Другое', notes: 'Другой анализ', snapshot: state(otherData), evidence: [] });
    storage.setItem('another-app', 'keep');
    storage.setItem(`${CASE_STORAGE_PREFIX}damaged`, '{broken');
    const unchanged = storage.getItem(`${CASE_STORAGE_PREFIX}${second.id}`);
    const updated = saveInvestigation(storage, data, { id: first.id, title: 'Первое уточнённое', notes: 'Дополнение', snapshot: state(data), evidence: [] });
    expect(updated.createdAt).toBe(first.createdAt);
    expect(storage.getItem(`${CASE_STORAGE_PREFIX}${second.id}`)).toBe(unchanged);
    expect(storage.getItem('another-app')).toBe('keep');
    expect(storage.getItem(`${CASE_STORAGE_PREFIX}damaged`)).toBe('{broken');
    expect(readInvestigations(storage)).toMatchObject({ unreadable: 1 });
    expect(readInvestigations(storage).records).toHaveLength(2);
  });

  it('keeps evidence content distinct when separate AI turns both call it E1', () => {
    const data = fixture();
    const first = { ...clientCaseEvidence(data, a), id: 'E1' };
    const second = { ...clientCaseEvidence(data, b), id: 'E1' };
    const all = addCaseEvidence([first], second);
    expect(all).toHaveLength(2);
    expect(addCaseEvidence(all, { ...first, id: 'E9' })).toBe(all);
    expect(addCaseEvidence(all, { ...first, source: { ...first.source, direction: 'out' } })).toHaveLength(3);
  });

  it('refuses to restore or overwrite another analysis but keeps its Markdown and JSON exportable', () => {
    const storage = new MemoryStorage();
    const data = fixture();
    const entry = saveInvestigation(storage, data, { title: 'Историческое', notes: 'Старые выводы', snapshot: state(data), evidence: [transactionCaseEvidence(data, state(data))] });
    const other = { ...data, metadata: { ...data.metadata, analysis_id: 'analysis-two' } };
    expect(() => restoreInvestigation(entry, other)).toThrow(/Другой анализ/);
    expect(() => saveInvestigation(storage, other, { id: entry.id, title: 'Перезаписать', notes: '', snapshot: state(other), evidence: [] })).toThrow(/Другой анализ/);
    const markdown = investigationMarkdown(entry);
    expect(markdown).toContain('Старые выводы');
    expect(markdown).toContain('направление: исходящие');
    expect(markdown).toContain('2026-07-02 — 2026-07-03');
    expect(JSON.parse(JSON.stringify(entry)).snapshot.selectedGid).toBe(a);
    expect(readInvestigations(storage).records[0].title).toBe('Историческое');
  });

  it('refuses unsupported saved formats while retaining them for export', () => {
    const storage = new MemoryStorage();
    const data = fixture();
    const entry = saveInvestigation(storage, data, { title: 'Будущая версия', notes: '', snapshot: state(data), evidence: [] });
    storage.setItem(`${CASE_STORAGE_PREFIX}${entry.id}`, JSON.stringify({ ...entry, version: 2 }));
    const loaded = readInvestigations(storage).records[0];
    expect(loaded.version).toBe(2);
    expect(() => restoreInvestigation(loaded, data)).toThrow(/версия формата/);
    expect(investigationMarkdown(loaded)).toContain('Будущая версия');
  });

  it('rejects a tampered client and invalid evidence instead of silently restoring another investigation', () => {
    const data = fixture();
    const storage = new MemoryStorage();
    const entry = saveInvestigation(storage, data, { title: 'Проверка', notes: '', snapshot: state(data), evidence: [] });
    expect(() => restoreInvestigation({ ...entry, snapshot: { ...state(data), selectedGid: 'missing' } }, data)).toThrow(/отсутствует/);
    const invalid: EvidenceCard = { ...clientCaseEvidence(data, a), node_ids: ['missing'] };
    expect(() => restoreInvestigation({ ...entry, evidence: [invalid] }, data)).toThrow(/отсутствует/);
    expect(() => saveInvestigation(storage, data, { title: 'Плохое основание', notes: '', snapshot: state(data), evidence: [invalid] })).toThrow(/отсутствует/);
    expect(readInvestigations(storage).records).toHaveLength(1);
  });

  it('normalizes obsolete optional controls on restore without losing valid client or direction', () => {
    const data = fixture();
    const entry = saveInvestigation(new MemoryStorage(), data, { title: 'Проверка', notes: '', snapshot: state(data), evidence: [] });
    const restored = restoreInvestigation({ ...entry, snapshot: { ...state(data), hops: 99, role: 'unknown', query: false, highlightedPaths: [[a, 'missing']] } }, data);
    expect(restored.snapshot).toMatchObject({ selectedGid: a, hops: 1, role: 'all', query: '', highlightedPaths: [], direction: 'out' });
  });

  it('reports a failed storage write and does not claim success or erase an existing record', () => {
    const storage = new MemoryStorage();
    const data = fixture();
    const saved = saveInvestigation(storage, data, { title: 'Сохранено ранее', notes: '', snapshot: state(data), evidence: [] });
    storage.setItem = () => { throw new Error('QuotaExceededError'); };
    expect(() => saveInvestigation(storage, data, { id: saved.id, title: 'Не сохранилось', notes: '', snapshot: state(data), evidence: [] })).toThrow(/Не удалось сохранить расследование/);
    expect(readInvestigations(storage).records[0].title).toBe('Сохранено ранее');
  });

  it('reports unavailable storage reads before any write attempt', () => {
    const storage = new MemoryStorage();
    const data = fixture();
    storage.getItem = () => { throw new Error('SecurityError'); };
    expect(() => saveInvestigation(storage, data, { title: 'Без доступа', notes: '', snapshot: state(data), evidence: [] })).toThrow(/Расследование не сохранено/);
    expect(storage.values.size).toBe(0);
  });

  it('refuses to overwrite a corrupt stored record', () => {
    const storage = new MemoryStorage();
    storage.setItem(`${CASE_STORAGE_PREFIX}known`, '{broken');
    const data = fixture();
    expect(() => saveInvestigation(storage, data, { id: 'known', title: 'Не заменять', notes: '', snapshot: state(data), evidence: [] })).toThrow();
    expect(storage.getItem(`${CASE_STORAGE_PREFIX}known`)).toBe('{broken');
  });

  it('escapes titles and notes in Markdown without removing content', () => {
    const data = fixture();
    const entry = saveInvestigation(new MemoryStorage(), data, { title: '<script> *пример*', notes: '[ссылка](https://example.test)', snapshot: state(data), evidence: [] });
    expect(investigationMarkdown(entry)).toContain('\\<script\\> \\*пример\\*');
    expect(investigationMarkdown(entry)).toContain('\\[ссылка\\](https://example.test)');
  });
});

describe('manual transaction evidence', () => {
  it.each([
    ['all', '3', '0 ₸', '4 ₸', '3 ₸'],
    ['in', '1', '0 ₸', '0 ₸', '3 ₸'],
    ['out', '3', '0 ₸', '4 ₸', '3 ₸'],
  ] as const)('counts repeated rows and self-transfers once for direction %s', (direction, total, incoming, outgoing, self) => {
    const data = fixture();
    const evidence = transactionCaseEvidence(data, state(data, { from: '2026-07-02', to: '2026-07-02', direction }));
    const facts = Object.fromEntries(evidence.facts.map(fact => [fact.label, fact.value]));
    expect(facts).toMatchObject({ 'Операций в выбранном направлении': total, 'Внешние входящие': incoming, 'Внешние исходящие': outgoing, 'Самопереводы': self, 'Роли и приоритеты': 'Рассчитаны за всю выгрузку' });
    expect(evidenceTransactionAction(evidence)).toEqual({ type: 'transactions', gid: a, direction, from: '2026-07-02', to: '2026-07-02' });
  });

  it('opens operations without dates using the saved direction', () => {
    const data = fixture();
    const evidence = transactionCaseEvidence(data, state(data, { from: '', to: '', direction: 'out' }));
    expect(evidenceTransactionAction(evidence)).toEqual({ type: 'transactions', gid: a, from: null, to: null, direction: 'out' });
  });

  it('rejects a reversed period before creating an empty misleading observation', () => {
    const data = fixture();
    expect(() => transactionCaseEvidence(data, state(data, { from: '2026-07-03', to: '2026-07-01' }))).toThrow(/Начальная дата/);
  });
});
