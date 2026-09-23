import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { loadScenarioInputs } from './fixture.mjs';

const clarification = 'Не понял запрос. Что вы хотите узнать о выбранном клиенте?';
const followup = 'Почему этот клиент важен?';

async function setup(page, baseURL) {
  const inputs = await loadScenarioInputs(baseURL);
  const graph = JSON.parse(await readFile(new URL('../public/generated/graph.json', import.meta.url), 'utf8'));
  inputs.analysisId = graph.metadata.analysis_id;
  await page.route('**/api/agent/status', route => route.fulfill({
    json: { available: true, reason: null, analysis_id: inputs.analysisId, model: 'test' },
  }));
  return inputs;
}

function response(inputs, kind) {
  const investigation = kind === 'investigation';
  return {
    analysis_id: inputs.analysisId,
    conversation_id: 'clarification-conversation',
    answer: {
      kind,
      summary: investigation ? 'Важность клиента связана с его наблюдаемыми связями.' : clarification,
      findings: investigation ? [{ text: 'Клиент присутствует в выборке.', evidence_ids: ['client'] }] : [],
      hypotheses: investigation ? ['Проверьте связи за соседние периоды.'] : [],
      limitations: investigation ? ['Вывод ограничен текущей выборкой.'] : [],
    },
    evidence: investigation ? [{
      id: 'client', title: 'Выбранный клиент', facts: [{ label: 'Клиент', value: inputs.gid }],
      node_ids: [inputs.gid], paths: [], cluster_id: inputs.clusterId,
      date_from: null, date_to: null, source: { tool: 'get_node', gid: inputs.gid, direction: null },
    }] : [],
  };
}

async function openAgent(page) {
  await page.getByRole('button', { name: 'Открыть ассистента расследования', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Ассистент расследования', exact: true });
  await expect(panel.getByRole('textbox', { name: 'Ваш вопрос', exact: true })).toBeEnabled();
  return panel;
}

async function visitAgent(page, inputs) {
  const params = new URLSearchParams({ view: 'explore', mode: 'client', client: inputs.gid, group: String(inputs.clusterId) });
  await page.goto(`${inputs.baseURL}/?${params}`);
  return openAgent(page);
}

async function ask(panel, question) {
  await panel.getByRole('textbox', { name: 'Ваш вопрос', exact: true }).fill(question);
  await panel.getByRole('button', { name: 'Исследовать', exact: true }).click();
}

async function expectPlainClarification(turn) {
  await expect(turn.getByText(clarification, { exact: true })).toBeVisible();
  await expect(turn.locator('.trace-agent-activity, .trace-agent-preview-note, .trace-agent-hypotheses, .trace-agent-findings, .trace-agent-evidence-list, .trace-agent-limitations')).toHaveCount(0);
  await expect(turn.getByText('Интерпретация модели', { exact: true })).toHaveCount(0);
}

test('unclear input renders a plain clarification, survives reload and allows a grounded follow-up', async ({ page, baseURL }) => {
  const inputs = await setup(page, baseURL);
  const requests = [];
  await page.route('**/api/agent/chat', async route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    const kind = body.message === 'папвап' ? 'clarification' : 'investigation';
    await route.fulfill({
      contentType: 'text/event-stream; charset=utf-8',
      body: `data: ${JSON.stringify({ type: 'result', response: response(inputs, kind) })}\n\n`,
    });
  });
  let panel = await visitAgent(page, inputs);
  await ask(panel, 'папвап');
  await expectPlainClarification(panel.locator('.trace-agent-turn').first());
  await page.reload();
  panel = await openAgent(page);
  await expectPlainClarification(panel.locator('.trace-agent-turn').first());
  await ask(panel, followup);
  await expect(panel.locator('.trace-agent-turn')).toHaveCount(2);
  await expectPlainClarification(panel.locator('.trace-agent-turn').first());
  const investigation = panel.locator('.trace-agent-turn').last();
  for (const label of ['Ход исследования', 'Интерпретация модели', 'Гипотезы и рекомендации', 'Проверенные факты из выборки', 'Основания ответа', 'Границы вывода']) {
    await expect(investigation.getByText(label, { exact: true })).toBeVisible();
  }
  expect(requests.map(request => [request.message, request.conversation_id])).toEqual([
    ['папвап', null], [followup, 'clarification-conversation'],
  ]);
  expect(requests.every(request => request.selected_gid === inputs.gid)).toBe(true);
});

test('a clarification preview has no research trace or interpretation warning', async ({ page, baseURL }) => {
  const inputs = await setup(page, baseURL);
  const panel = await visitAgent(page, inputs);
  const result = response(inputs, 'clarification');
  await page.evaluate(result => {
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      if (input !== '/api/agent/chat') return originalFetch(input, init);
      const encode = value => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`);
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encode({ type: 'answer_preview', kind: 'clarification', summary: result.answer.summary, findings: [] }));
          window.finishAgentClarification = () => {
            controller.enqueue(encode({ type: 'result', response: result }));
            controller.close();
          };
        },
      }), { headers: { 'Content-Type': 'text/event-stream' } });
    };
  }, result);
  await ask(panel, 'папвап');
  await expectPlainClarification(panel.locator('.trace-agent-pending-turn'));
  await expect(panel.getByRole('button', { name: 'Остановить', exact: true })).toBeVisible();
  await page.evaluate(() => window.finishAgentClarification());
  await expectPlainClarification(panel.locator('.trace-agent-turn'));
  await expect(panel.getByRole('button', { name: 'Исследовать', exact: true })).toBeVisible();
});
