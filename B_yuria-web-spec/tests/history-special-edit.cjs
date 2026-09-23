const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const url = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:4174/';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('yuria-web-session-v1')));
  const add = async (card, special) => {
    await page.locator('#add-history').click();
    await page.locator(`[data-picker-card="${card}"]`).click();
    await page.locator('[data-picker-apply]').click();
    await page.locator('[data-outcome="success"]').click();
    if (special) await page.locator(special).click();
    await page.locator('[data-commit-outcome]').click();
  };
  try {
    await page.goto(url);
    await page.evaluate(() => localStorage.removeItem('yuria-web-session-v1'));
    await page.reload();
    await add('fool');
    await add('magician');
    await add('star', '[data-remove-card="fool"]');
    assert.equal((await stored()).state.selected[0].removed, true);
    assert.equal(await page.locator('[data-history-removed="0"]').isDisabled(), true);

    await page.locator('[data-history-result="2"][data-activated="false"]').click();
    let state = await stored();
    assert.equal(state.state.selected[2].activated, false);
    assert.equal(state.state.selected[0].removed, false);
    assert.equal(state.starTargets[2], null);
    assert.equal(await page.locator('.score-breakdown b').innerText(), '215');

    await page.locator('[data-history-result="2"][data-activated="true"]').click();
    assert.equal(await page.locator('[data-edit-commit]').isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal((await stored()).state.selected[2].activated, false);
    await page.locator('[data-history-result="2"][data-activated="true"]').click();
    await page.locator('[data-edit-remove-card="magician"]').click();
    await page.locator('[data-edit-commit]').click();
    state = await stored();
    assert.equal(state.state.selected[2].activated, true);
    assert.equal(state.state.selected[1].removed, true);
    assert.equal(state.starTargets[2], 'magician');

    await page.locator('[data-history-result="2"][data-activated="true"]').click();
    await page.locator('[data-edit-remove-card="fool"]').click();
    await page.locator('[data-edit-commit]').click();
    state = await stored();
    assert.equal(state.state.selected[0].removed, true);
    assert.equal(state.state.selected[1].removed, false);
    assert.equal(state.starTargets[2], 'fool');

    await add('tower', '[data-tower-proc="true"]');
    await page.locator('[data-history-result="3"][data-activated="false"]').click();
    state = await stored();
    assert.equal(state.state.selected[3].towerProc, undefined);
    await page.locator('[data-history-result="3"][data-activated="true"]').click();
    assert.equal(await page.locator('[data-edit-commit]').isDisabled(), true);
    await page.locator('[data-edit-tower-proc="false"]').click();
    await page.locator('[data-edit-commit]').click();
    state = await stored();
    assert.equal(state.state.selected[3].towerProc, false);
    assert.deepEqual(errors, []);
    console.log(`PASS star and tower result corrections: ${url}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
