import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { loadScenarioInputs } from './fixture.mjs';

const modelName = 'private-model-name-for-history-test';
const firstQuestion = 'Проверь приоритет клиента.';
const firstAnswer = 'Первый диалог: приоритет подтверждён.';
const secondQuestion = 'Исследуй переводы клиента.';
const secondAnswer = 'Второй диалог: переводы проверены.';

async function agentInputs(baseURL) {
  const inputs = await loadScenarioInputs(baseURL);
  const graph = JSON.parse(await readFile(new URL('../public/generated/graph.json', import.meta.url), 'utf8'));
  expect(graph.metadata.analysis_id).toBeTruthy();
  return { ...inputs, analysisId: graph.metadata.analysis_id };
}

function agentResponse(inputs, conversationId, summary) {
  return {
    analysis_id: inputs.analysisId,
    conversation_id: conversationId,
    answer: {
      summary,
      findings: [{ text: 'Показатели клиента проверены в текущей выборке.', evidence_ids: ['client-evidence'] }],
      hypotheses: [],
      limitations: ['Вывод ограничен текущей выборкой.'],
    },
    evidence: [{
      id: 'client-evidence',
      title: 'Показатели выбранного клиента',
      facts: [{ label: 'Клиент', value: inputs.gid }],
      node_ids: [inputs.gid],
      paths: [],
      cluster_id: inputs.clusterId,
      date_from: null,
      date_to: null,
      source: { tool: 'get_node', gid: inputs.gid, direction: null },
    }],
  };
}

async function mockAgent(page, inputs, replies) {
  const requests = [];
  await page.route('**/api/agent/status', route => route.fulfill({
    json: { available: true, reason: null, analysis_id: inputs.analysisId, model: modelName },
  }));
  await page.route('**/api/agent/chat', async route => {
    const request = route.request();
    const body = request.postDataJSON();
    requests.push(body);
    const reply = replies[body.message];
    if (!reply) {
      await route.fulfill({ status: 400, json: { detail: 'Неожиданный вопрос в браузерной проверке.' } });
      return;
    }
    if (reply.wait) await reply.wait;
    try {
      await route.fulfill({
        contentType: 'text/event-stream; charset=utf-8',
        body: `data: ${JSON.stringify({ type: 'result', response: agentResponse(inputs, reply.conversationId, reply.summary) })}\n\n`,
      });
    } catch (error) {
      if (!request.failure()) throw error;
    }
  });
  return requests;
}

async function visitAgent(page, inputs) {
  const params = new URLSearchParams({
    view: 'explore', mode: 'client', client: inputs.gid, group: String(inputs.clusterId),
    direction: 'out', from: inputs.from, to: inputs.to,
  });
  await page.goto(`${inputs.baseURL}/?${params}`);
  return openAgent(page);
}

async function openAgent(page) {
  await page.getByRole('button', { name: 'Открыть ассистента расследования', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Ассистент расследования', exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

async function ask(panel, question) {
  await panel.getByRole('textbox', { name: 'Ваш вопрос', exact: true }).fill(question);
  await panel.getByRole('button', { name: 'Исследовать', exact: true }).click();
}

async function history(panel) {
  const saved = panel.getByRole('region', { name: 'Сохранённые чаты', exact: true });
  if (!await saved.isVisible()) await panel.getByRole('button', { name: 'История чатов', exact: true }).click();
  await expect(saved).toBeVisible();
  return saved;
}

async function openChat(panel, question) {
  const saved = await history(panel);
  await saved.getByRole('button', { name: `Открыть чат ${question}`, exact: true }).click();
}

async function expectPanelInViewport(page, panel) {
  await expect.poll(async () => {
    const box = await panel.boundingBox();
    const viewport = page.viewportSize();
    return box !== null && viewport !== null && box.x >= -1 && box.y >= -1
      && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1;
  }).toBe(true);
}

async function createTwoChats(panel) {
  const log = panel.getByRole('log', { name: 'История диалога', exact: true });
  await ask(panel, firstQuestion);
  await expect(log.getByText(firstAnswer, { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Новый диалог', exact: true }).click();
  await expect(log.getByText(firstQuestion, { exact: true })).toHaveCount(0);
  await expect(log.getByText(firstAnswer, { exact: true })).toHaveCount(0);
  await ask(panel, secondQuestion);
  await expect(log.getByText(secondAnswer, { exact: true })).toBeVisible();
  return log;
}

function initialReplies() {
  return {
    [firstQuestion]: { conversationId: 'conversation-first', summary: firstAnswer },
    [secondQuestion]: { conversationId: 'conversation-second', summary: secondAnswer },
  };
}

test('saved agent chats stay separate, restore after reload and continue their own conversation', async ({ page, baseURL }) => {
  const inputs = await agentInputs(baseURL);
  const firstFollowup = 'Уточни приоритет первого диалога.';
  const firstContinuation = 'Первый диалог продолжен в прежнем контексте.';
  const secondFollowup = 'Уточни переводы второго диалога.';
  const secondContinuation = 'Второй диалог продолжен отдельно.';
  const requests = await mockAgent(page, inputs, {
    ...initialReplies(),
    [firstFollowup]: { conversationId: 'conversation-first', summary: firstContinuation },
    [secondFollowup]: { conversationId: 'conversation-second', summary: secondContinuation },
  });
  let panel = await visitAgent(page, inputs);
  await expect(panel.getByRole('textbox', { name: 'Ваш вопрос', exact: true })).toBeEnabled();
  await expect(panel.getByText(modelName, { exact: true })).toHaveCount(0);
  await expect(panel.getByTitle(`Текущая модель: ${modelName}`, { exact: true })).toHaveCount(0);
  let log = await createTwoChats(panel);
  const saved = await history(panel);
  await expect(saved.getByRole('button', { name: /^Открыть чат / })).toHaveCount(2);
  await expect(saved.getByRole('button', { name: `Открыть чат ${firstQuestion}`, exact: true })).toBeVisible();
  await expect(saved.getByRole('button', { name: `Открыть чат ${secondQuestion}`, exact: true })).toBeVisible();
  await openChat(panel, firstQuestion);
  await expect(log.getByText(firstQuestion, { exact: true })).toBeVisible();
  await expect(log.getByText(firstAnswer, { exact: true })).toBeVisible();
  await expect(log.getByText(secondQuestion, { exact: true })).toHaveCount(0);
  await expect(log.getByText(secondAnswer, { exact: true })).toHaveCount(0);
  await page.reload();
  panel = await openAgent(page);
  log = panel.getByRole('log', { name: 'История диалога', exact: true });
  await expect(log.getByText(firstAnswer, { exact: true })).toBeVisible();
  await expect(log.getByText(secondAnswer, { exact: true })).toHaveCount(0);
  await ask(panel, firstFollowup);
  await expect(log.getByText(firstContinuation, { exact: true })).toBeVisible();
  await expect(log.getByText(firstAnswer, { exact: true })).toBeVisible();
  await openChat(panel, secondQuestion);
  await expect(log.getByText(secondAnswer, { exact: true })).toBeVisible();
  await expect(log.getByText(firstAnswer, { exact: true })).toHaveCount(0);
  await expect(log.getByText(firstContinuation, { exact: true })).toHaveCount(0);
  await ask(panel, secondFollowup);
  await expect(log.getByText(secondContinuation, { exact: true })).toBeVisible();
  expect(requests.map(request => [request.message, request.conversation_id])).toEqual([
    [firstQuestion, null], [secondQuestion, null],
    [firstFollowup, 'conversation-first'], [secondFollowup, 'conversation-second'],
  ]);
  for (const request of requests) {
    expect(request.analysis_id).toBe(inputs.analysisId);
    expect(request.selected_gid).toBe(inputs.gid);
  }
  await openChat(panel, firstQuestion);
  await expect(log.getByText(firstContinuation, { exact: true })).toBeVisible();
  await expect(log.getByText(secondContinuation, { exact: true })).toHaveCount(0);
  await expect((await history(panel)).getByRole('button', { name: /^Открыть чат / })).toHaveCount(2);
  await expectPanelInViewport(page, panel);
  await page.screenshot({ path: test.info().outputPath('agent-history-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expectPanelInViewport(page, panel);
  await page.screenshot({ path: test.info().outputPath('agent-history-mobile.png') });
  await openChat(panel, firstQuestion);
  await expect(log.getByText(firstContinuation, { exact: true })).toBeVisible();
  await expectPanelInViewport(page, panel);
  await page.screenshot({ path: test.info().outputPath('agent-chat-mobile.png') });
});

test('switching chats cancels the pending request and does not append its late response elsewhere', async ({ page, baseURL }) => {
  const inputs = await agentInputs(baseURL);
  const delayedQuestion = 'Подробно проверь первый диалог.';
  const delayedAnswer = 'Этот отменённый ответ не должен попасть в историю.';
  let releaseResponse;
  const delayedResponse = new Promise(resolve => { releaseResponse = resolve; });
  const requests = await mockAgent(page, inputs, {
    ...initialReplies(),
    [delayedQuestion]: { conversationId: 'conversation-first', summary: delayedAnswer, wait: delayedResponse },
  });
  const panel = await visitAgent(page, inputs);
  const log = await createTwoChats(panel);
  await openChat(panel, firstQuestion);
  const started = page.waitForRequest(request => request.url().endsWith('/api/agent/chat') && request.postDataJSON()?.message === delayedQuestion);
  await ask(panel, delayedQuestion);
  await started;
  await expect(panel.getByRole('button', { name: 'Остановить', exact: true })).toBeVisible();
  const cancelled = page.waitForEvent('requestfailed', {
    predicate: request => request.url().endsWith('/api/agent/chat') && request.postDataJSON()?.message === delayedQuestion,
    timeout: 8000,
  });
  try {
    await openChat(panel, secondQuestion);
    releaseResponse();
    const failedRequest = await cancelled;
    expect(failedRequest.failure()?.errorText).toMatch(/ABORTED|CANCELLED|CANCELED|cancelled|canceled/);
    await expect(log.getByText(secondAnswer, { exact: true })).toBeVisible();
    await expect(log.getByText(firstAnswer, { exact: true })).toHaveCount(0);
    await expect(log.getByText(delayedAnswer, { exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Остановить', exact: true })).toHaveCount(0);
    await expect(panel.getByRole('textbox', { name: 'Ваш вопрос', exact: true })).toBeEnabled();
    await openChat(panel, firstQuestion);
    await expect(log.getByText(firstAnswer, { exact: true })).toBeVisible();
    await expect(log.getByText(delayedAnswer, { exact: true })).toHaveCount(0);
    expect(requests.at(-1).conversation_id).toBe('conversation-first');
    await page.reload();
    const restored = await openAgent(page);
    const restoredLog = restored.getByRole('log', { name: 'История диалога', exact: true });
    await expect(restoredLog.getByText(firstAnswer, { exact: true })).toBeVisible();
    await expect(restoredLog.getByText(delayedAnswer, { exact: true })).toHaveCount(0);
    await openChat(restored, secondQuestion);
    await expect(restoredLog.getByText(secondAnswer, { exact: true })).toBeVisible();
    await expect(restoredLog.getByText(delayedAnswer, { exact: true })).toHaveCount(0);
  } finally {
    releaseResponse();
  }
});

test('reloading during a pending continuation preserves the old chat and starts a separate session', async ({ page, baseURL }) => {
  const inputs = await agentInputs(baseURL);
  const delayedQuestion = 'Продолжи исследование перед обновлением страницы.';
  const delayedAnswer = 'Незавершённый ответ до обновления страницы.';
  const newQuestion = 'Начни исследование после обновления страницы.';
  const newAnswer = 'После обновления создан отдельный диалог.';
  let releaseResponse;
  const delayedResponse = new Promise(resolve => { releaseResponse = resolve; });
  const requests = await mockAgent(page, inputs, {
    [firstQuestion]: { conversationId: 'conversation-first', summary: firstAnswer },
    [delayedQuestion]: { conversationId: 'conversation-first', summary: delayedAnswer, wait: delayedResponse },
    [newQuestion]: { conversationId: 'conversation-after-reload', summary: newAnswer },
  });
  const panel = await visitAgent(page, inputs);
  const log = panel.getByRole('log', { name: 'История диалога', exact: true });
  await ask(panel, firstQuestion);
  await expect(log.getByText(firstAnswer, { exact: true })).toBeVisible();
  const started = page.waitForRequest(request => request.url().endsWith('/api/agent/chat') && request.postDataJSON()?.message === delayedQuestion);
  await ask(panel, delayedQuestion);
  await started;
  await expect(panel.getByRole('button', { name: 'Остановить', exact: true })).toBeVisible();
  try {
    await page.reload();
    releaseResponse();
    const restored = await openAgent(page);
    await openChat(restored, firstQuestion);
    const restoredLog = restored.getByRole('log', { name: 'История диалога', exact: true });
    await expect(restoredLog.getByText(firstQuestion, { exact: true })).toBeVisible();
    await expect(restoredLog.getByText(firstAnswer, { exact: true })).toBeVisible();
    await expect(restoredLog.getByText(delayedAnswer, { exact: true })).toHaveCount(0);
    await ask(restored, newQuestion);
    await expect(restoredLog.getByText(newAnswer, { exact: true })).toBeVisible();
    await expect(restoredLog.getByText(firstAnswer, { exact: true })).toHaveCount(0);
    await expect(restoredLog.getByText(delayedAnswer, { exact: true })).toHaveCount(0);
    expect(requests.map(request => [request.message, request.conversation_id])).toEqual([
      [firstQuestion, null],
      [delayedQuestion, 'conversation-first'],
      [newQuestion, null],
    ]);
    const saved = await history(restored);
    await expect(saved.getByRole('button', { name: /^Открыть чат / })).toHaveCount(2);
    await expect(saved.getByRole('button', { name: `Открыть чат ${firstQuestion}`, exact: true })).toBeVisible();
    await expect(saved.getByRole('button', { name: `Открыть чат ${newQuestion}`, exact: true })).toBeVisible();
    await openChat(restored, firstQuestion);
    await expect(restoredLog.getByText(firstAnswer, { exact: true })).toBeVisible();
    await expect(restoredLog.getByText(newAnswer, { exact: true })).toHaveCount(0);
    await expect(restoredLog.getByText(delayedAnswer, { exact: true })).toHaveCount(0);
    await openChat(restored, newQuestion);
    await expect(restoredLog.getByText(newAnswer, { exact: true })).toBeVisible();
    await expect(restoredLog.getByText(firstAnswer, { exact: true })).toHaveCount(0);
  } finally {
    releaseResponse();
  }
});

test('saved agent chats remain readable when the agent API is unavailable', async ({ page, baseURL }) => {
  const inputs = await agentInputs(baseURL);
  const requests = await mockAgent(page, inputs, initialReplies());
  const panel = await visitAgent(page, inputs);
  await createTwoChats(panel);
  await page.unroute('**/api/agent/status');
  await page.route('**/api/agent/status', route => route.fulfill({ status: 503, json: { detail: 'Сервер агента временно недоступен.' } }));
  await page.reload();
  const restored = await openAgent(page);
  const log = restored.getByRole('log', { name: 'История диалога', exact: true });
  await expect(restored.getByText('Не удалось подключиться к серверу агента.', { exact: true })).toBeVisible();
  await expect(restored.getByRole('textbox', { name: 'Ваш вопрос', exact: true })).toBeDisabled();
  await expect(log.getByText(secondAnswer, { exact: true })).toBeVisible();
  await openChat(restored, firstQuestion);
  await expect(log.getByText(firstQuestion, { exact: true })).toBeVisible();
  await expect(log.getByText(firstAnswer, { exact: true })).toBeVisible();
  await expect(log.getByText(secondAnswer, { exact: true })).toHaveCount(0);
  await openChat(restored, secondQuestion);
  await expect(log.getByText(secondAnswer, { exact: true })).toBeVisible();
  await expect(log.getByText(firstAnswer, { exact: true })).toHaveCount(0);
  await expect((await history(restored)).getByRole('button', { name: /^Открыть чат / })).toHaveCount(2);
  expect(requests).toHaveLength(2);
});
