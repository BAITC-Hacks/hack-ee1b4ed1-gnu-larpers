import { describe, expect, it, vi } from 'vitest';
import { readAgentStream, type AgentStreamUpdate } from './agent';
import type { GraphData } from './types';

const source = '9007199254740992';
const target = '9007199254740993';
const graph = {
  metadata: { analysis_id: 'analysis-stream' },
  nodes: [{ gid: source }, { gid: target }],
  edges: [{ src: source, dst: target }],
  clusters: [{ cluster_id: 0 }],
} as GraphData;

function finalResponse() {
  return {
    analysis_id: 'analysis-stream',
    conversation_id: 'conversation-stream',
    answer: {
      summary: 'В выборке есть направленная связь.',
      findings: [{ text: 'Клиенты связаны переводом.', evidence_ids: ['evidence-1'] }],
      hypotheses: [],
      limitations: ['Связь не доказывает происхождение средств.'],
    },
    evidence: [{
      id: 'evidence-1', title: 'Направленная связь',
      facts: [{ label: 'Переходов', value: '1' }],
      node_ids: [target], paths: [{ node_ids: [source, target] }],
      cluster_id: 0, date_from: null, date_to: null,
      source: { tool: 'trace_seed_paths', gid: target, direction: null },
    }],
  };
}

const event = (value: unknown, separator = '\n') => `data: ${JSON.stringify(value)}${separator}${separator}`;

function responseFromChunks(chunks: Uint8Array[]) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } });
}

function streamedResponse(events: unknown[]) {
  return responseFromChunks([new TextEncoder().encode(events.map(value => event(value)).join(''))]);
}

describe('agent streaming transport', () => {
  it('decodes split UTF-8 and split CRLF before validating the final evidence', async () => {
    const updates: AgentStreamUpdate[] = [
      { type: 'status', phase: 'thinking' },
      { type: 'status', phase: 'tool', tool: 'get_node', call_id: 'call-1', state: 'started' },
      { type: 'status', phase: 'tool', tool: 'get_node', call_id: 'call-1', state: 'completed' },
      { type: 'reasoning_delta', delta: 'Проверяю связи 🔎' },
      { type: 'answer_preview', summary: 'В выборке', findings: [] },
      { type: 'answer_preview', summary: 'В выборке есть направленная связь.', findings: ['Клиенты связаны переводом.'] },
      { type: 'status', phase: 'validating' },
    ];
    const bytes = new TextEncoder().encode([...updates, { type: 'result', response: finalResponse() }].map(value => event(value, '\r\n')).join(''));
    const response = responseFromChunks(Array.from(bytes, byte => new Uint8Array([byte])));
    const received: AgentStreamUpdate[] = [];
    const result = await readAgentStream(response, graph, null, update => received.push(update), new AbortController().signal);
    expect(received).toEqual(updates);
    expect(result).toEqual(finalResponse());
    expect(result.evidence[0].paths[0].node_ids).toEqual([source, target]);
    expect(response.body?.locked).toBe(false);
  });

  it('supports multiline data and keepalive comments without inventing reasoning', async () => {
    const text = ': keepalive\r\rdata: {"type":"status",\rdata: "phase":"thinking"}\r\r' + event({ type: 'result', response: finalResponse() }, '\r');
    const updates = vi.fn();
    await readAgentStream(responseFromChunks([new TextEncoder().encode(text)]), graph, null, updates, new AbortController().signal);
    expect(updates.mock.calls).toEqual([[{ type: 'status', phase: 'thinking' }]]);
  });

  it('finishes and releases the stream as soon as the verified result arrives', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(event({ type: 'result', response: finalResponse() }))); },
      cancel,
    });
    const response = new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    await expect(readAgentStream(response, graph, null, vi.fn(), new AbortController().signal)).resolves.toEqual(finalResponse());
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('rejects a preview-only stream instead of adding it to confirmed history', async () => {
    const response = streamedResponse([{ type: 'answer_preview', summary: 'Предварительный ответ', findings: [] }]);
    const update = vi.fn();
    await expect(readAgentStream(response, graph, null, update, new AbortController().signal)).rejects.toThrow(/до готового ответа/);
    expect(update).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  it('reports server errors received after partial text and releases the reader', async () => {
    const response = streamedResponse([
      { type: 'answer_preview', summary: 'Предварительный ответ', findings: [] },
      { type: 'error', detail: 'Не удалось проверить основания.' },
    ]);
    await expect(readAgentStream(response, graph, null, vi.fn(), new AbortController().signal)).rejects.toThrow('Не удалось проверить основания.');
    expect(response.body?.locked).toBe(false);
  });

  it('aborts a pending read even when the transport has no chunks to deliver', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const response = new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    const controller = new AbortController();
    const pending = readAgentStream(response, graph, null, vi.fn(), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('does not accept a queued final result after cancellation during an update', async () => {
    const controller = new AbortController();
    const response = streamedResponse([
      { type: 'answer_preview', summary: 'Предварительный ответ', findings: [] },
      { type: 'result', response: finalResponse() },
    ]);
    await expect(readAgentStream(response, graph, null, () => controller.abort(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(response.body?.locked).toBe(false);
  });

  it('rejects an ungrounded final result even after valid previews', async () => {
    const result = finalResponse();
    result.evidence[0].node_ids = ['missing'];
    const response = streamedResponse([
      { type: 'answer_preview', summary: 'Предварительный ответ', findings: [] },
      { type: 'result', response: result },
    ]);
    await expect(readAgentStream(response, graph, null, vi.fn(), new AbortController().signal)).rejects.toThrow(/Клиент.*отсутствует/);
    expect(response.body?.locked).toBe(false);
  });

  it('rejects a final result from another conversation', async () => {
    const response = streamedResponse([{ type: 'result', response: finalResponse() }]);
    await expect(readAgentStream(response, graph, 'other-conversation', vi.fn(), new AbortController().signal)).rejects.toThrow(/другому диалогу/);
  });

  it.each([
    [{ type: 'answer_preview', summary: 'x'.repeat(2401), findings: [] }, /размер события/],
    [{ type: 'answer_preview', summary: '', findings: Array(9).fill('Вывод') }, /много выводов/],
    [{ type: 'answer_preview', summary: '', findings: [false] }, /некорректный текст/],
    [{ type: 'status', phase: 'tool', tool: 'get_node', call_id: '', state: 'started' }, /вызов инструмента/],
    [{ type: 'status', phase: 'tool', tool: 'get_node', call_id: '1', state: 'unknown' }, /неизвестный этап/],
    [{ type: 'unknown' }, /неизвестное событие/],
  ])('rejects malformed or oversized events %#', async (value, error) => {
    const response = streamedResponse([value, { type: 'result', response: finalResponse() }]);
    await expect(readAgentStream(response, graph, null, vi.fn(), new AbortController().signal)).rejects.toThrow(error);
    expect(response.body?.locked).toBe(false);
  });

  it('bounds accumulated reasoning across multiple individually valid deltas', async () => {
    const response = streamedResponse([
      { type: 'reasoning_delta', delta: 'x'.repeat(12001) },
      { type: 'reasoning_delta', delta: 'x'.repeat(12000) },
    ]);
    await expect(readAgentStream(response, graph, null, vi.fn(), new AbortController().signal)).rejects.toThrow(/размер объяснения/);
  });

  it('rejects a tool call that changes identity under the same call id', async () => {
    const response = streamedResponse([
      { type: 'status', phase: 'tool', tool: 'get_node', call_id: 'same', state: 'started' },
      { type: 'status', phase: 'tool', tool: 'get_transactions', call_id: 'same', state: 'completed' },
    ]);
    await expect(readAgentStream(response, graph, null, vi.fn(), new AbortController().signal)).rejects.toThrow(/вызов инструмента/);
  });

  it('rejects malformed SSE JSON without accepting the following result', async () => {
    const response = responseFromChunks([new TextEncoder().encode('data: {broken}\n\n' + event({ type: 'result', response: finalResponse() }))]);
    await expect(readAgentStream(response, graph, null, vi.fn(), new AbortController().signal)).rejects.toThrow(/Поток ответа повреждён/);
  });

  it('rejects invalid UTF-8 instead of silently changing a streamed answer', async () => {
    const response = responseFromChunks([new Uint8Array([0xc3, 0x28])]);
    await expect(readAgentStream(response, graph, null, vi.fn(), new AbortController().signal)).rejects.toThrow();
    expect(response.body?.locked).toBe(false);
  });

  it('keeps ordinary HTTP error details before streaming begins', async () => {
    const response = new Response(JSON.stringify({ detail: 'Агент занят.' }), { status: 429 });
    await expect(readAgentStream(response, graph, null, vi.fn(), new AbortController().signal)).rejects.toThrow('Агент занят.');
  });
});
