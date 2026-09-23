function expectEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

function expectIncludes(actual, expected, label) {
  if (!actual.includes(expected)) throw new Error(`${label}: expected ${JSON.stringify(actual)} to include ${JSON.stringify(expected)}`);
}

async function eventually(check, timeout = 8000) {
  const deadline = Date.now() + timeout;
  let failure;
  do {
    try {
      return await check();
    } catch (error) {
      failure = error;
      await new Promise(resolve => setTimeout(resolve, 80));
    }
  } while (Date.now() < deadline);
  throw failure;
}

async function expectText(locator, expected, label) {
  await locator.waitFor({ state: 'visible' });
  await eventually(async () => expectIncludes(await locator.innerText(), expected, label));
}

async function expectValue(tab, accessibleLabel, expected, label, scope = null) {
  await eventually(async () => {
    const values = await tab.playwright.evaluate(({ accessibleLabel, scope }) => {
      const root = scope ? document.querySelector(scope) : document;
      return [...(root?.querySelectorAll('input, select, textarea') ?? [])].filter(element => {
        const visible = element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[aria-hidden="true"]');
        const matches = element.getAttribute('aria-label') === accessibleLabel || [...(element.labels ?? [])].some(item => item.textContent.trim() === accessibleLabel);
        return visible && matches;
      }).map(element => element.value);
    }, { accessibleLabel, scope });
    expectEqual(values.length, 1, `${label} visible control count`);
    expectEqual(values[0], expected, label);
  });
}

async function expectAttribute(locator, attribute, expected, label) {
  await locator.waitFor({ state: 'visible' });
  await eventually(async () => expectEqual(await locator.getAttribute(attribute), expected, label));
}

async function expectUrl(tab, expected) {
  await eventually(async () => {
    const actual = new URL(await tab.playwright.evaluate(() => window.location.href));
    for (const [key, value] of Object.entries(expected)) expectEqual(actual.searchParams.get(key), String(value), `URL ${key}`);
  });
}

async function navigate(tab, url) {
  const current = await tab.playwright.evaluate(() => window.location.href);
  if (current === url) await tab.reload();
  else await tab.goto(url);
}

function contextUrl(inputs, overrides = {}) {
  const params = new URLSearchParams({
    view: 'explore', mode: 'client', client: inputs.gid, group: String(inputs.clusterId),
    hops: '2', external: '1', direction: 'out', from: inputs.from, to: inputs.to,
    q: inputs.gid, role: inputs.role, ...overrides,
  });
  return `${inputs.baseURL ?? 'http://127.0.0.1:5173'}/?${params}`;
}

async function expectProfile(tab, inputs) {
  await expectText(tab.playwright.getByRole('heading', { name: 'Исследование клиента', exact: true }), 'Исследование клиента', 'profile heading');
  await expectText(tab.playwright.locator('.workspace-heading h2'), inputs.gid, 'full client ID');
  await expectValue(tab, 'Направление переводов', 'out', 'transaction direction');
  await expectValue(tab, 'Переводы с даты', inputs.from, 'transaction start');
  await expectValue(tab, 'Переводы по дату', inputs.to, 'transaction end');
  await expectUrl(tab, { view: 'explore', client: inputs.gid, from: inputs.from, to: inputs.to, direction: 'out' });
}

async function openNotebook(tab) {
  const trigger = tab.playwright.getByRole('region', { name: 'Сохранённые расследования', exact: true }).locator('.case-notebook-toggle');
  await trigger.waitFor({ state: 'visible' });
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await tab.playwright.getByLabel('Название расследования', { exact: true }).waitFor({ state: 'visible' });
}

export async function groupNeighborhoodScenario(tab, inputs) {
  await navigate(tab, contextUrl(inputs, { view: 'visualization', mode: 'overview', external: '0', hops: '1' }));
  await tab.playwright.getByRole('button', { name: `Открыть граф группы ${inputs.clusterId + 1}`, exact: true }).click();
  const group = tab.playwright.getByRole('region', { name: `Граф группы ${inputs.clusterId + 1}`, exact: true });
  await expectText(group.locator('.graph-scope-count'), `все ${inputs.memberCount}`, 'complete group');
  await expectUrl(tab, { mode: 'cluster', group: inputs.clusterId });
  await group.getByRole('checkbox', { name: `Внешние контрагенты (${inputs.externalCount})`, exact: true }).click();
  await expectText(group.locator('.graph-scope-count'), `и ${inputs.externalCount} внешних контрагентов`, 'external context');
  await group.locator('.graph-clients summary').click();
  await group.getByLabel('Найти клиента на графе', { exact: true }).fill(inputs.gid);
  await group.getByRole('button', { name: `Открыть клиента ${inputs.gid}`, exact: true }).click();
  const neighborhood = tab.playwright.getByRole('region', { name: 'Граф окружения клиента', exact: true });
  await expectText(tab.playwright.locator('.workspace-heading h2'), inputs.gid, 'selected group member');
  await expectAttribute(neighborhood.getByRole('button', { name: '1 шаг', exact: true }), 'aria-pressed', 'true', 'initial hop');
  await neighborhood.getByRole('button', { name: '2 шага', exact: true }).click();
  await expectAttribute(neighborhood.getByRole('button', { name: '2 шага', exact: true }), 'aria-pressed', 'true', 'second hop');
  await expectUrl(tab, { client: inputs.gid, group: inputs.clusterId, hops: 2, mode: 'client' });
  await expectText(neighborhood.locator('.graph-scope-count'), inputs.neighborhoodTotal > 250 ? 'Достигнут лимит 250 клиентов' : 'Все клиенты этого окружения включены.', 'neighborhood coverage');
  await tab.playwright.getByRole('navigation', { name: 'Путь исследования', exact: true }).getByRole('button', { name: `Группа ${inputs.clusterId + 1}`, exact: true }).click();
  await group.waitFor({ state: 'visible' });
  await tab.playwright.getByRole('tab', { name: 'Один клиент', exact: true }).click();
  await tab.playwright.getByRole('button', { name: 'Профиль и переводы', exact: true }).click();
  await expectProfile(tab, inputs);
  return { scenario: 'group-neighborhood-profile', gid: inputs.gid, clusterId: inputs.clusterId };
}

export async function urlRestorationScenario(tab, inputs) {
  await navigate(tab, contextUrl(inputs));
  await expectProfile(tab, inputs);
  await tab.reload();
  await expectProfile(tab, inputs);
  await tab.playwright.locator('.workspace-actions').getByRole('button', { name: 'Выбрать клиента', exact: true }).click();
  const directory = tab.playwright.getByRole('dialog', { name: 'Каталог клиентов', exact: true });
  await expectValue(tab, 'Поиск клиента по ID', inputs.gid, 'restored exact ID search', '[role=dialog]');
  await expectValue(tab, 'Фильтр по роли', inputs.role, 'restored role', '[role=dialog]');
  await expectValue(tab, 'Фильтр по группе', String(inputs.clusterId), 'restored group', '[role=dialog]');
  await directory.getByRole('button', { name: 'Закрыть каталог', exact: true }).click();
  await tab.playwright.getByRole('button', { name: 'Группы клиентов', exact: true }).click();
  await expectText(tab.playwright.locator('h1'), 'Группы клиентов', 'groups page heading');
  await tab.back();
  await expectProfile(tab, inputs);
  await expectUrl(tab, { q: inputs.gid, role: inputs.role, group: inputs.clusterId, hops: 2, external: 1 });
  return { scenario: 'url-reload-back', gid: inputs.gid };
}

export async function savedInvestigationScenario(tab, inputs) {
  const title = inputs.caseTitle ?? `Регрессия сохранения ${Date.now()}`;
  const notes = inputs.caseNotes ?? 'Проверить исходящие переводы и сопоставить роли контрагентов.';
  await navigate(tab, contextUrl(inputs));
  await expectProfile(tab, inputs);
  await openNotebook(tab);
  await tab.playwright.getByLabel('Название расследования', { exact: true }).fill(title);
  await tab.playwright.getByLabel('Заметки расследования', { exact: true }).fill(notes);
  await tab.playwright.getByRole('button', { name: 'Добавить клиента в основания', exact: true }).click();
  await tab.playwright.getByRole('button', { name: 'Добавить операции в основания', exact: true }).click();
  await tab.playwright.getByRole('button', { name: 'Сохранить расследование', exact: true }).click();
  const saved = tab.playwright.getByRole('article', { name: `Расследование ${title}`, exact: true });
  await saved.waitFor({ state: 'visible' });
  await tab.playwright.getByRole('button', { name: 'Отчёт', exact: true }).click();
  await tab.playwright.getByRole('heading', { name: 'Аналитический отчёт', exact: true }).waitFor({ state: 'visible' });
  await tab.reload();
  await openNotebook(tab);
  await saved.getByRole('button', { name: 'Открыть', exact: true }).click();
  await expectProfile(tab, inputs);
  await expectValue(tab, 'Название расследования', title, 'saved title');
  await expectValue(tab, 'Заметки расследования', notes, 'saved notes');
  await tab.playwright.getByRole('article', { name: 'Основание 1', exact: true }).waitFor({ state: 'visible' });
  await tab.playwright.getByRole('article', { name: 'Основание 2', exact: true }).getByRole('button', { name: 'Операции', exact: true }).waitFor({ state: 'visible' });
  return { scenario: 'saved-investigation-reload', title, gid: inputs.gid };
}

export async function transactionEvidenceScenario(tab, inputs) {
  await navigate(tab, contextUrl(inputs));
  await expectProfile(tab, inputs);
  await openNotebook(tab);
  await tab.playwright.getByRole('button', { name: 'Добавить операции в основания', exact: true }).click();
  await tab.playwright.getByLabel('Направление переводов', { exact: true }).selectOption('in');
  await tab.playwright.getByLabel('Переводы с даты', { exact: true }).fill(inputs.datasetFrom);
  await tab.playwright.getByLabel('Переводы по дату', { exact: true }).fill(inputs.datasetTo);
  await expectValue(tab, 'Направление переводов', 'in', 'changed direction before evidence');
  await tab.playwright.getByRole('article', { name: 'Основание 1', exact: true }).getByRole('button', { name: 'Операции', exact: true }).click();
  await expectProfile(tab, inputs);
  await expectText(tab.playwright.locator('#client-transactions .table-footer'), `из ${inputs.transactionCount} переводов`, 'evidence operation count');
  const directions = await tab.playwright.locator('#client-transactions tbody').innerText();
  expectEqual(directions.includes('Входящий'), false, 'outgoing evidence must not display incoming transfers');
  return { scenario: 'transaction-evidence-context', gid: inputs.gid, from: inputs.from, to: inputs.to, direction: 'out' };
}
