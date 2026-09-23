// Run against production with PLAYWRIGHT_MODULE and ACCEPTANCE_URL set.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');

const url = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:4174';
const samples = 30;

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__workerDurations = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.starts = new Map();
        this.addEventListener('message', event => {
          const started = this.starts.get(event.data.requestId);
          if (started !== undefined) {
            window.__workerDurations.push(performance.now() - started);
            this.starts.delete(event.data.requestId);
          }
        });
      }
      postMessage(message, ...args) {
        if (message.type === 'RECOMMEND') this.starts.set(message.requestId, performance.now());
        return super.postMessage(message, ...args);
      }
    };
  });
  try {
    await page.goto(url);
    await page.evaluate(() => localStorage.removeItem('yuria-web-session-v1'));
    await page.reload();
    for (const [slot, card] of ['magician', 'death', 'lovers'].entries()) {
      await page.locator(`[data-pick="${slot}"]`).click();
      await page.locator(`[data-picker-card="${card}"]`).click();
      await page.locator('[data-picker-apply]').click();
    }
    await page.waitForFunction(() => document.querySelectorAll('[data-choose]').length === 3, null, { timeout: 120000 });
    // Warm up once; count only completed, three-candidate recommendation requests.
    await page.evaluate(() => { window.__workerDurations = []; });
    for (let i = 0; i < samples; i++) {
      await page.locator('#calculate').click();
      await page.waitForFunction(count => window.__workerDurations.length >= count, i + 1, { timeout: 120000 });
      await page.waitForFunction(() => document.querySelectorAll('[data-choose]').length === 3, null, { timeout: 120000 });
    }
    const durations = await page.evaluate(() => window.__workerDurations);
    assert.equal(durations.length, samples);
    assert.deepEqual(errors, []);
    const sorted = [...durations].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(.95 * samples) - 1];
    console.log(JSON.stringify({ url, browser: browser.version(), samples, metric: 'Worker postMessage to result message, excludes 150ms debounce and render', minMs: sorted[0], medianMs: sorted[Math.floor(samples / 2)], p95Ms: p95, maxMs: sorted.at(-1), errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
