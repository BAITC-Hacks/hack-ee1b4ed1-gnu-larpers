import { parseEvidenceCard, type EvidenceCard } from './agent';
import { transactionsForNode } from './data';
import { money } from './format';
import { analysisIdentity, normalizeWorkspace, workspaceSnapshot, type WorkspaceSnapshot } from './stores/workspace';
import { roles, type GraphData } from './types';

export const CASE_STORAGE_PREFIX = 'money-graph:investigation:';
const CASE_VERSION = 1;

export interface CaseStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SavedInvestigation {
  version: number;
  id: string;
  title: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  analysisIdentity: string;
  snapshot: unknown;
  evidence: unknown[];
}

export interface InvestigationDraft {
  id?: string;
  title: string;
  notes: string;
  snapshot: WorkspaceSnapshot;
  evidence: EvidenceCard[];
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Запись расследования повреждена.');
  return value as Record<string, unknown>;
}

function string(value: unknown, limit: number): string {
  if (typeof value !== 'string' || value.length > limit) throw new Error('Запись расследования содержит некорректный текст.');
  return value;
}

function parseSavedInvestigation(value: unknown): SavedInvestigation {
  const row = record(value);
  const id = string(row.id, 200);
  const title = string(row.title, 200);
  const identity = string(row.analysisIdentity, 20000);
  const createdAt = string(row.createdAt, 100);
  const updatedAt = string(row.updatedAt, 100);
  if (!id || !title.trim() || !identity || !Number.isInteger(row.version) || Number(row.version) < 1
    || !Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))
    || !Array.isArray(row.evidence) || row.evidence.length > 100) throw new Error('Запись расследования повреждена.');
  return {
    version: Number(row.version), id, title, notes: string(row.notes, 100000), createdAt, updatedAt,
    analysisIdentity: identity, snapshot: row.snapshot, evidence: row.evidence,
  };
}

function storageKey(id: string): string {
  return `${CASE_STORAGE_PREFIX}${encodeURIComponent(id)}`;
}

export function readInvestigations(storage: CaseStorage): { records: SavedInvestigation[]; unreadable: number } {
  const records: SavedInvestigation[] = [];
  let unreadable = 0;
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(CASE_STORAGE_PREFIX)) continue;
    const value = storage.getItem(key);
    if (value === null) continue;
    try {
      const entry = parseSavedInvestigation(JSON.parse(value));
      if (storageKey(entry.id) !== key) throw new Error('Несовпадение ID расследования.');
      records.push(entry);
    } catch { unreadable++; }
  }
  return { records: records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), unreadable };
}

export function investigationCompatibility(entry: SavedInvestigation, data: GraphData): string | null {
  if (entry.version !== CASE_VERSION) return 'Другая версия формата: доступен только экспорт.';
  if (entry.analysisIdentity !== analysisIdentity(data)) return 'Другой анализ: доступен только экспорт.';
  return null;
}

export function restoreInvestigation(entry: SavedInvestigation, data: GraphData): { snapshot: WorkspaceSnapshot; evidence: EvidenceCard[] } {
  const incompatible = investigationCompatibility(entry, data);
  if (incompatible) throw new Error(incompatible);
  const raw = record(entry.snapshot);
  if (typeof raw.selectedGid !== 'string' || !data.nodes.some(node => node.gid === raw.selectedGid)) {
    throw new Error('Сохранённый клиент отсутствует в текущем анализе.');
  }
  return {
    snapshot: normalizeWorkspace(data, raw),
    evidence: entry.evidence.map(value => parseEvidenceCard(value, data)),
  };
}

export function evidenceContentKey(evidence: EvidenceCard): string {
  return JSON.stringify({
    title: evidence.title, facts: evidence.facts.map(fact => [fact.label, fact.value]),
    node_ids: evidence.node_ids, paths: evidence.paths.map(path => path.node_ids),
    cluster_id: evidence.cluster_id, date_from: evidence.date_from, date_to: evidence.date_to,
    source: [evidence.source.tool, evidence.source.gid, evidence.source.direction],
  });
}

export function addCaseEvidence(current: EvidenceCard[], evidence: EvidenceCard): EvidenceCard[] {
  const key = evidenceContentKey(evidence);
  return current.some(item => evidenceContentKey(item) === key) ? current : [...current, evidence];
}

export function clientCaseEvidence(data: GraphData, gid: string): EvidenceCard {
  const node = data.nodes.find(item => item.gid === gid);
  if (!node) throw new Error('Клиент отсутствует в текущем анализе.');
  return {
    id: `client:${node.gid}`, title: `Клиент ${node.gid}`,
    facts: [
      { label: 'Роль', value: roles[node.role].label },
      { label: 'Приоритет исследования', value: node.priority_score.toFixed(6) },
      { label: 'Входящие переводы', value: money(node.in_kzt) },
      { label: 'Исходящие переводы', value: money(node.out_kzt) },
      { label: 'Наблюдаемые признаки', value: node.evidence },
    ],
    node_ids: [node.gid], paths: [], cluster_id: node.cluster_id,
    date_from: data.metadata.date_from, date_to: data.metadata.date_to,
    source: { tool: 'get_node', gid: node.gid, direction: null },
  };
}

export function transactionCaseEvidence(data: GraphData, snapshot: WorkspaceSnapshot): EvidenceCard {
  const { selectedGid: gid, from, to, direction } = snapshot;
  if (!data.nodes.some(node => node.gid === gid)) throw new Error('Клиент отсутствует в текущем анализе.');
  if (from && to && from > to) throw new Error('Начальная дата должна быть не позже конечной.');
  const rows = transactionsForNode(data, gid, from, to).filter(row => direction === 'all' || (direction === 'in' ? row.dst === gid : row.src === gid));
  const external = rows.filter(row => row.src !== row.dst);
  const sum = (amounts: number[]) => amounts.reduce((total, value) => total + value, 0) / 100;
  return parseEvidenceCard({
    id: `transactions:${gid}`, title: `Операции клиента ${gid}`,
    facts: [
      { label: 'Операций в выбранном направлении', value: String(rows.length) },
      { label: 'Направление', value: direction === 'in' ? 'Входящие' : direction === 'out' ? 'Исходящие' : 'Все' },
      { label: 'Внешние входящие', value: money(sum(external.filter(row => row.dst === gid).map(row => row.sum_minor))) },
      { label: 'Внешние исходящие', value: money(sum(external.filter(row => row.src === gid).map(row => row.sum_minor))) },
      { label: 'Самопереводы', value: money(sum(rows.filter(row => row.src === row.dst).map(row => row.sum_minor))) },
      { label: 'Период', value: `${from || 'начало выгрузки'} — ${to || 'конец выгрузки'}` },
      { label: 'Роли и приоритеты', value: 'Рассчитаны за всю выгрузку' },
    ],
    node_ids: [gid], paths: [], cluster_id: null, date_from: from || null, date_to: to || null,
    source: { tool: 'get_transactions', gid, direction },
  }, data);
}

export function saveInvestigation(storage: CaseStorage, data: GraphData, draft: InvestigationDraft): SavedInvestigation {
  const title = draft.title.trim();
  if (!title) throw new Error('Введите название расследования.');
  const id = draft.id ?? crypto.randomUUID();
  let previousText: string | null;
  try { previousText = storage.getItem(storageKey(id)); }
  catch { throw new Error('Нет доступа к локальному хранилищу. Расследование не сохранено; черновик остаётся на экране.'); }
  let previous: SavedInvestigation | null = null;
  if (previousText !== null) {
    try { previous = parseSavedInvestigation(JSON.parse(previousText)); }
    catch { throw new Error('Существующая запись повреждена и не была изменена. Сохраните работу как новое расследование.'); }
  }
  if (previous) {
    const incompatible = investigationCompatibility(previous, data);
    if (incompatible) throw new Error(incompatible);
  }
  const timestamp = new Date().toISOString();
  const entry = parseSavedInvestigation({
    version: CASE_VERSION, id, title, notes: draft.notes,
    createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp,
    analysisIdentity: analysisIdentity(data), snapshot: workspaceSnapshot(draft.snapshot),
    evidence: draft.evidence.map(value => parseEvidenceCard(value, data)),
  });
  const restored = restoreInvestigation(entry, data);
  entry.snapshot = restored.snapshot;
  entry.evidence = restored.evidence;
  try { storage.setItem(storageKey(id), JSON.stringify(entry)); }
  catch { throw new Error('Не удалось сохранить расследование в браузере. Проверьте доступ к локальному хранилищу и свободное место. Черновик сохранён на экране.'); }
  return entry;
}

const markdownText = (value: unknown): string => typeof value === 'string'
  ? value.replace(/[\\`*_{}\[\]<>#|]/g, '\\$&').replace(/\r?\n/g, '  \n') : '';

export function investigationMarkdown(entry: SavedInvestigation): string {
  const context = entry.snapshot && typeof entry.snapshot === 'object' ? entry.snapshot as Record<string, unknown> : {};
  const lines = [
    `# ${markdownText(entry.title)}`, '', `Сохранено: ${entry.updatedAt}`, `Анализ: ${markdownText(entry.analysisIdentity)}`, '',
    '## Заметки', '', markdownText(entry.notes) || 'Заметок нет.', '',
    '## Контекст исследования', '',
    `Клиент: ${markdownText(context.selectedGid)}`,
    `Группа: ${typeof context.clusterId === 'number' ? context.clusterId + 1 : 'не выбрана'}`,
    `Период: ${markdownText(context.from) || 'без начала'} — ${markdownText(context.to) || 'без конца'}`,
    `Направление: ${context.direction === 'in' ? 'входящие' : context.direction === 'out' ? 'исходящие' : 'все'}`, '',
    '## Выбранные основания', '',
  ];
  entry.evidence.forEach((value, index) => {
    if (!value || typeof value !== 'object') return;
    const evidence = value as Record<string, unknown>;
    lines.push(`### ${index + 1}. ${markdownText(evidence.title)}`, '');
    if (Array.isArray(evidence.facts)) evidence.facts.forEach(value => {
      if (value && typeof value === 'object') {
        const fact = value as Record<string, unknown>;
        lines.push(`- ${markdownText(fact.label)}: ${markdownText(fact.value)}`);
      }
    });
    if (Array.isArray(evidence.node_ids)) lines.push(`Клиенты: ${evidence.node_ids.map(markdownText).join(', ')}`);
    if (Array.isArray(evidence.paths)) evidence.paths.forEach(value => {
      if (value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).node_ids)) {
        lines.push(`Путь: ${((value as Record<string, unknown>).node_ids as unknown[]).map(markdownText).join(' → ')}`);
      }
    });
    const source = evidence.source && typeof evidence.source === 'object' ? evidence.source as Record<string, unknown> : {};
    lines.push(`Источник: ${markdownText(source.tool)}; клиент: ${markdownText(source.gid) || 'не указан'}; направление: ${source.direction === 'in' ? 'входящие' : source.direction === 'out' ? 'исходящие' : source.direction === 'all' ? 'все' : 'не применимо'}`);
    lines.push(`Период основания: ${markdownText(evidence.date_from) || 'без начала'} — ${markdownText(evidence.date_to) || 'без конца'}`, '');
  });
  if (!entry.evidence.length) lines.push('Основания не выбраны.', '');
  lines.push('Роли и приоритеты являются аналитическими гипотезами, а не доказательством нарушения.', '');
  return lines.join('\n');
}
