import type { GraphData } from './types';

export interface AgentStatus {
  available: boolean;
  reason: string | null;
  analysis_id: string;
  model: string | null;
}

export interface EvidenceCard {
  id: string;
  title: string;
  facts: { label: string; value: string }[];
  node_ids: string[];
  paths: { node_ids: string[] }[];
  cluster_id: number | null;
  date_from: string | null;
  date_to: string | null;
  source: { tool: string; gid: string | null; direction: 'all' | 'in' | 'out' | null };
}

export type AgentEvidence = EvidenceCard;
export type AgentAnswerKind = 'investigation' | 'clarification';

export interface AgentResponse {
  analysis_id: string;
  conversation_id: string;
  answer: {
    kind: AgentAnswerKind;
    summary: string;
    findings: { text: string; evidence_ids: string[] }[];
    hypotheses?: string[];
    limitations: string[];
  };
  evidence: AgentEvidence[];
}

export type AgentStreamUpdate =
  | { type: 'status'; phase: 'thinking' | 'answer' | 'validating' }
  | { type: 'status'; phase: 'tool'; tool: string; call_id: string; state: 'started' | 'completed' }
  | { type: 'reasoning_delta'; delta: string }
  | { type: 'answer_preview'; kind: AgentAnswerKind; summary: string; findings: string[] };

export type EvidenceAction =
  | { type: 'node'; gid: string }
  | { type: 'cluster'; clusterId: number }
  | { type: 'paths'; paths: string[][] }
  | { type: 'transactions'; gid: string; from: string | null; to: string | null; direction: 'all' | 'in' | 'out' };

export function evidenceTransactionAction(evidence: EvidenceCard): Extract<EvidenceAction, { type: 'transactions' }> | null {
  const { tool, gid, direction } = evidence.source;
  if (tool !== 'get_transactions' || gid === null || direction === null) return null;
  return { type: 'transactions', gid, direction, from: evidence.date_from, to: evidence.date_to };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Агент вернул некорректный ответ.');
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Агент вернул некорректный список.');
  return value;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length > 100000) throw new Error('Агент вернул некорректный текст.');
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function answerKind(value: unknown): AgentAnswerKind {
  if (value === undefined) return 'investigation';
  if (value !== 'investigation' && value !== 'clarification') throw new Error('Агент вернул неизвестный тип ответа.');
  return value;
}

function date(value: unknown): string | null {
  if (value === null) return null;
  const result = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error('Агент вернул некорректный период.');
  const timestamp = Date.parse(`${result}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== result) throw new Error('Агент вернул некорректную дату.');
  return result;
}

export const edgeId = (src: string, dst: string) => `${src}->${dst}`;

export function parseAgentStatus(value: unknown): AgentStatus {
  const row = object(value);
  if (typeof row.available !== 'boolean') throw new Error('Не удалось проверить доступность агента.');
  const analysisId = text(row.analysis_id);
  if (!analysisId) throw new Error('Сервер не указал версию анализа.');
  return { available: row.available, reason: nullableText(row.reason), analysis_id: analysisId, model: nullableText(row.model) };
}

function evidenceContext(data: GraphData) {
  return {
    nodes: new Set(data.nodes.map(node => node.gid)),
    clusters: new Set(data.clusters.map(cluster => cluster.cluster_id)),
    edges: new Set(data.edges.map(edge => edgeId(edge.src, edge.dst))),
  };
}

function parseEvidence(value: unknown, { nodes, clusters, edges }: ReturnType<typeof evidenceContext>): EvidenceCard {
  const nodeIds = (value: unknown) => array(value).map(item => {
    const gid = text(item);
    if (!nodes.has(gid)) throw new Error('Клиент из ответа отсутствует в текущем графе.');
    return gid;
  });
  const source = object(value);
  const id = text(source.id);
  if (!id) throw new Error('Агент вернул пустую ссылку на доказательство.');
  const clusterId = source.cluster_id;
  if (clusterId !== null && (typeof clusterId !== 'number' || !clusters.has(clusterId))) throw new Error('Группа из ответа отсутствует в текущем графе.');
  const from = date(source.date_from);
  const to = date(source.date_to);
  if (from && to && from > to) throw new Error('Агент вернул некорректный период.');
  const paths = array(source.paths).map(value => {
    const ids = nodeIds(object(value).node_ids);
    if (!ids.length || ids.some((gid, index) => index > 0 && !edges.has(edgeId(ids[index - 1], gid)))) throw new Error('Путь из ответа не подтверждён направленными связями графа.');
    return { node_ids: ids };
  });
  const origin = object(source.source);
  const tool = text(origin.tool);
  const gid = nullableText(origin.gid);
  const direction = origin.direction;
  if (gid !== null && !nodes.has(gid)) throw new Error('Источник основания содержит неизвестного клиента.');
  if (direction !== null && direction !== 'all' && direction !== 'in' && direction !== 'out') throw new Error('Источник основания содержит неизвестное направление.');
  if (tool === 'get_transactions' && (gid === null || direction === null)) throw new Error('Основание операций не содержит точный контекст.');
  return {
    id, title: text(source.title),
    source: { tool, gid, direction: direction as EvidenceCard['source']['direction'] },
    facts: array(source.facts).map(value => { const fact = object(value); return { label: text(fact.label), value: text(fact.value) }; }),
    node_ids: nodeIds(source.node_ids), paths, cluster_id: clusterId as number | null, date_from: from, date_to: to,
  };
}

export function parseEvidenceCard(value: unknown, data: GraphData): EvidenceCard {
  return parseEvidence(value, evidenceContext(data));
}

export function parseAgentResponse(value: unknown, data: GraphData, conversationId: string | null): AgentResponse {
  const row = object(value);
  const analysisId = text(row.analysis_id);
  if (!data.metadata.analysis_id || analysisId !== data.metadata.analysis_id) throw new Error('Версия анализа изменилась. Обновите страницу и начните новый диалог.');
  const returnedConversation = text(row.conversation_id);
  if (!returnedConversation || (conversationId !== null && returnedConversation !== conversationId)) throw new Error('Ответ относится к другому диалогу. Начните новый диалог.');
  const context = evidenceContext(data);
  const evidenceIds = new Set<string>();
  const evidence = array(row.evidence).map(item => {
    const card = parseEvidence(item, context);
    if (evidenceIds.has(card.id)) throw new Error('Агент вернул неоднозначную ссылку на доказательство.');
    evidenceIds.add(card.id);
    return card;
  });
  const answer = object(row.answer);
  const kind = answerKind(answer.kind);
  const findings = array(answer.findings).map(value => {
    const finding = object(value);
    const ids = array(finding.evidence_ids).map(text);
    if (!ids.length || ids.some(id => !evidenceIds.has(id))) throw new Error('Вывод агента не содержит подтверждённой ссылки на доказательство.');
    return { text: text(finding.text), evidence_ids: ids };
  });
  const hypotheses = answer.hypotheses === undefined ? [] : array(answer.hypotheses).map(text);
  const limitations = array(answer.limitations).map(text);
  if (kind === 'clarification' && (findings.length || hypotheses.length || limitations.length || evidence.length)) {
    throw new Error('Уточнение агента содержит неожиданные результаты исследования.');
  }
  return {
    analysis_id: analysisId, conversation_id: returnedConversation,
    answer: { kind, summary: text(answer.summary), findings, hypotheses, limitations }, evidence,
  };
}

export function evidenceGraph(data: GraphData, paths: string[][]) {
  const ids = new Set(paths.flat());
  const edgeIds = new Set(paths.flatMap(path => path.slice(1).map((gid, index) => edgeId(path[index], gid))));
  const nodes = data.nodes.filter(node => ids.has(node.gid));
  const edges = data.edges.filter(edge => edgeIds.has(edgeId(edge.src, edge.dst)));
  return { nodes, edges, totalNodes: nodes.length, truncated: false };
}

export async function agentError(response: Response): Promise<Error> {
  let detail = '';
  try {
    const body = object(await response.json());
    if (typeof body.detail === 'string') detail = body.detail;
  } catch { detail = ''; }
  const fallback: Record<number, string> = {
    409: 'Версия анализа или диалог устарели. Обновите страницу и начните новый диалог.',
    429: 'Агент занят. Повторите запрос через несколько секунд.',
    502: 'Не удалось получить ответ от модели. Повторите запрос.',
    503: 'Агент недоступен. Настройте API-ключ на сервере.',
    504: 'Время ожидания ответа истекло. Попробуйте более узкий вопрос.',
  };
  return new Error(detail || fallback[response.status] || 'Не удалось выполнить запрос к агенту.');
}

export async function readAgentStream(
  response: Response,
  data: GraphData,
  conversationId: string | null,
  onUpdate: (update: AgentStreamUpdate) => void,
  signal: AbortSignal,
): Promise<AgentResponse> {
  signal.throwIfAborted();
  if (!response.ok) throw await agentError(response);
  if (!response.body || response.headers.get('content-type')?.split(';')[0].trim() !== 'text/event-stream') {
    await response.body?.cancel().catch(() => {});
    throw new Error('Сервер не открыл поток ответа. Обновите страницу и повторите вопрос.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let eventData: string[] = [];
  let eventSize = 0;
  let bytes = 0;
  let reasoningSize = 0;
  let events = 0;
  let result: AgentResponse | null = null;
  const toolCalls = new Map<string, string>();
  const cancelReader = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancelReader, { once: true });
  const boundedText = (value: unknown, limit: number) => {
    const parsed = text(value);
    if (parsed.length > limit) throw new Error('Агент превысил допустимый размер события.');
    return parsed;
  };
  const dispatch = () => {
    signal.throwIfAborted();
    if (!eventData.length) return;
    if (++events > 10000) throw new Error('Агент отправил слишком много событий.');
    let parsed: unknown;
    try { parsed = JSON.parse(eventData.join('\n')); } catch { throw new Error('Поток ответа повреждён. Повторите вопрос.'); }
    eventData = [];
    eventSize = 0;
    const row = object(parsed);
    if (row.type === 'result') {
      result = parseAgentResponse(row.response, data, conversationId);
    } else if (row.type === 'error') {
      throw new Error(boundedText(row.detail, 4000) || 'Не удалось завершить ответ агента.');
    } else if (row.type === 'reasoning_delta') {
      const delta = boundedText(row.delta, 24000);
      reasoningSize += delta.length;
      if (reasoningSize > 24000) throw new Error('Агент превысил допустимый размер объяснения.');
      onUpdate({ type: 'reasoning_delta', delta });
    } else if (row.type === 'answer_preview') {
      const kind = answerKind(row.kind);
      const summary = boundedText(row.summary, 2400);
      const findings = array(row.findings);
      if (findings.length > 8) throw new Error('Агент прислал слишком много выводов.');
      if (kind === 'clarification' && findings.length) throw new Error('Уточнение агента содержит неожиданные результаты исследования.');
      onUpdate({ type: 'answer_preview', kind, summary, findings: findings.map(value => boundedText(value, 1600)) });
    } else if (row.type === 'status') {
      if (row.phase === 'thinking' || row.phase === 'answer' || row.phase === 'validating') {
        onUpdate({ type: 'status', phase: row.phase });
      } else if (row.phase === 'tool' && (row.state === 'started' || row.state === 'completed')) {
        const tool = boundedText(row.tool, 100);
        const callId = boundedText(row.call_id, 200);
        if (!tool || !callId || (toolCalls.has(callId) && toolCalls.get(callId) !== tool)) throw new Error('Агент прислал некорректный вызов инструмента.');
        toolCalls.set(callId, tool);
        if (toolCalls.size > 128) throw new Error('Агент вызвал слишком много инструментов.');
        onUpdate({ type: 'status', phase: 'tool', tool, call_id: callId, state: row.state });
      } else {
        throw new Error('Агент прислал неизвестный этап исследования.');
      }
    } else {
      throw new Error('Агент прислал неизвестное событие.');
    }
  };
  const consume = (ending: boolean) => {
    while (!result) {
      const boundary = /[\r\n]/.exec(buffer);
      if (!boundary || (!ending && boundary.index === buffer.length - 1 && boundary[0] === '\r')) break;
      const line = buffer.slice(0, boundary.index);
      const separatorSize = buffer.slice(boundary.index, boundary.index + 2) === '\r\n' ? 2 : 1;
      buffer = buffer.slice(boundary.index + separatorSize);
      if (!line) dispatch();
      else if (line.startsWith('data:')) {
        const value = line.slice(5).replace(/^ /, '');
        eventSize += value.length;
        if (eventSize > 500000) throw new Error('Событие ответа слишком большое.');
        eventData.push(value);
      }
    }
    if (buffer.length > 500000) throw new Error('Событие ответа слишком большое.');
  };
  try {
    signal.throwIfAborted();
    while (!result) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) {
        buffer += decoder.decode();
        consume(true);
        if (!result) throw new Error('Соединение прервалось до готового ответа. Повторите вопрос.');
        break;
      }
      bytes += value.byteLength;
      if (bytes > 16000000) throw new Error('Поток ответа слишком большой.');
      buffer += decoder.decode(value, { stream: true });
      consume(false);
    }
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener('abort', cancelReader);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
