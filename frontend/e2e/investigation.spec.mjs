import { test } from '@playwright/test';
import { loadScenarioInputs } from './fixture.mjs';
import { groupNeighborhoodScenario, savedInvestigationScenario, transactionEvidenceScenario, urlRestorationScenario } from './scenarios.mjs';

const scenarios = [
  ['group → client → neighborhood → profile', groupNeighborhoodScenario],
  ['exact client and filters survive reload and browser back', urlRestorationScenario],
  ['saved investigation reopens after reload', savedInvestigationScenario],
  ['transaction evidence restores its exact filter context', transactionEvidenceScenario],
];

for (const [name, scenario] of scenarios) {
  test(name, async ({ page, baseURL }) => {
    const inputs = await loadScenarioInputs(baseURL);
    const tab = { goto: page.goto.bind(page), reload: page.reload.bind(page), back: page.goBack.bind(page), playwright: page };
    await scenario(tab, inputs);
  });
}
