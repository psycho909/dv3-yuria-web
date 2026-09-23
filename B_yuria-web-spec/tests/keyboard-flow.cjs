// Run against a deployed or local page with:
// ACCEPTANCE_URL=https://dv3-yuria-web.vercel.app PLAYWRIGHT_MODULE=<playwright path> node tests/keyboard-flow.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');

const url = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:4174';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 768, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(url);
    await page.evaluate(() => localStorage.removeItem('yuria-web-session-v1'));
    await page.reload();

    for (const selector of ['#add-history', '[data-picker-card="fool"]', '[data-picker-apply]', '[data-outcome="failure"]', '[data-commit-outcome]']) {
      await page.locator(selector).focus();
      await page.keyboard.press('Enter');
    }
    assert.equal(await page.locator('.history-row').count(), 1);
    assert.match(await page.locator('.history-row').innerText(), /愚者.*失敗/s);

    await page.locator('#undo').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.history-row').count(), 0);
    assert.equal(errors.length, 0, errors.join('; '));
    console.log(`PASS keyboard record-failure and undo: ${url}`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
