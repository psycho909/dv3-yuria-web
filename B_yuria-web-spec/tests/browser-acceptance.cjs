// Run: node tests/browser-acceptance.cjs; set PLAYWRIGHT_MODULE if not installed locally.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const out = path.resolve('artifacts/acceptance');
fs.mkdirSync(out, { recursive: true });
const url = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:4174';
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const report = { url, browser: browser.version(), date: new Date().toISOString(), checks: [], errors };
  const check = async (name, action) => {
    try { const detail = await action(); report.checks.push({ name, pass: true, ...detail }); console.log(`PASS ${name}`); }
    catch (error) { report.checks.push({ name, pass: false, error: error.stack }); console.log(`FAIL ${name}: ${error.message}`); await page.screenshot({ path: path.join(out, `failure-${name}.png`) }).catch(() => {}); process.exitCode = 1; }
  };
  const select = async (trigger, id, color = 'blue') => {
    const details = page.locator('details').filter({ has: page.locator(trigger).first() });
    if (await details.count() && !await details.first().evaluate(el => el.open)) await details.first().locator('summary').first().click();
    await page.locator(trigger).first().click();
    await page.locator(`[data-picker-card="${id}"]`).click();
    await page.locator(`[data-picker-color="${color}"]`).click();
    await page.locator('[data-picker-apply]').click();
  };
  const add = async (id, outcome = 'success', color = 'blue', special) => {
    await select('#add-history', id, color);
    await page.locator(`[data-outcome="${outcome}"]`).click();
    if (special) await page.locator(special).click();
    await page.locator('[data-commit-outcome]').click();
  };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('yuria-web-session-v1')));
  const fresh = async () => { await page.goto(url); await page.evaluate(() => localStorage.removeItem('yuria-web-session-v1')); await page.reload(); };
  try {
    await page.goto(url);
    await check('guided-settings', async () => {
      assert.match(await page.locator('.workflow [aria-current="step"]').innerText(), /填入 3 張/);
      assert.equal(await page.locator('.advanced-settings').evaluate(el => el.open), false);
      await page.locator('.advanced-settings > summary').focus();
      await page.keyboard.press('Enter');
      await page.locator('[data-layout-mode="narrow"]').click();
      assert.equal(await page.locator('.advanced-settings').evaluate(el => el.open), true);
      await page.locator('[data-layout-mode="full"]').click();
      await page.locator('.advanced-settings > summary').click();
    });
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, background: getComputedStyle(document.body).backgroundColor }));
      report.checks.push({ name: `empty-${width}`, ...layout, pass: layout.scrollWidth <= width });
      await page.screenshot({ path: path.join(out, `empty-${width}.png`), fullPage: true });
      await page.locator('[data-pick="0"]').click();
      await page.locator('#card-search').fill('月亮');
      await page.locator('[data-picker-card="moon"]').click();
      await page.locator('[data-picker-color="purple"]').click();
      await page.screenshot({ path: path.join(out, `picker-${width}.png`) });
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('[data-pick="0"]').evaluate(el => el === document.activeElement), true);
      assert.equal(await page.locator('.history-row').count(), 0);
      report.checks.push({ name: `cancel-${width}`, pass: true });
    }
    await fresh();
    await check('pc-empty-workbench-first-fold', async () => {
      const measurements = [];
      for (const [width, height] of [[1024, 768], [1440, 900]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => scrollTo(0, 0));
        const bounds = await page.evaluate(() => {
          const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width) }; };
          return { history: box('.history-panel'), candidates: box('.candidate-grid'), historyCard: box('.history-empty-slot'), candidateCard: box('.candidate-card'), scrollY };
        });
        assert.equal(bounds.scrollY, 0);
        assert.ok(bounds.history.bottom <= height, width + 'px history is below fold: ' + JSON.stringify(bounds));
        assert.ok(bounds.candidates.bottom <= height, width + 'px candidates are below fold: ' + JSON.stringify(bounds));
        assert.equal(await page.locator('.history-empty-slot').count(), 5);
        assert.equal(await page.locator('.candidate-card').count(), 3);
        await page.screenshot({ path: path.join(out, 'workbench-empty-' + width + '.png') });
        measurements.push({ width, height, ...bounds });
      }
      return { measurements };
    });
    await fresh();
    await check('pc-active-workbench-first-fold', async () => {
      const measurements = [];
      for (const scenario of [
        { selected: ['fool'], candidates: ['justice', 'hermit', 'chariot'] },
        { selected: ['fool', 'magician', 'moon'], candidates: ['empress', 'emperor', 'hermit'] },
        { selected: ['fool', 'magician', 'moon', 'empress'], candidates: ['justice', 'hermit', 'chariot'] },
      ]) {
        await fresh();
        for (const id of scenario.selected) await add(id);
        for (const [index, id] of scenario.candidates.entries()) await select('[data-pick="' + index + '"]', id, 'blue');
        await page.waitForFunction(() => document.querySelectorAll('[data-choose]').length === 3, null, { timeout: 120000 });
        for (const [width, height] of [[1024, 768], [1440, 900]]) {
          await page.setViewportSize({ width, height });
          await page.evaluate(() => scrollTo(0, 0));
          const bounds = await page.evaluate(() => {
            const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) }; };
            return { history: box('.history-panel'), candidates: box('.candidate-grid'), historyCard: box('.history-row'), candidateCard: box('.candidate-card'), candidateFace: box('.candidate-card:not(.pending-card) > .card-face'), scrollY };
          });
          assert.equal(bounds.scrollY, 0);
          assert.ok(bounds.history.bottom <= height, width + 'px history is below fold: ' + JSON.stringify(bounds));
          assert.ok(bounds.candidates.bottom <= height - 8, width + 'px candidates lack an 8px fold margin: ' + JSON.stringify(bounds));
          assert.equal(await page.locator('.history-row').count(), scenario.selected.length);
          assert.equal(await page.locator('.history-empty-slot').count(), 5 - scenario.selected.length);
          assert.equal(await page.locator('.candidate-card').count(), 3);
          assert.ok(bounds.historyCard.width >= 160 && bounds.historyCard.width <= 176, 'history card width: ' + JSON.stringify(bounds));
          assert.ok(bounds.candidateCard.width >= 210 && bounds.candidateCard.width <= 240, 'candidate card width: ' + JSON.stringify(bounds));
          assert.ok(Math.abs(bounds.candidateFace.height / bounds.candidateFace.width - 1.25) < 0.05, 'candidate face should stay 4:5: ' + JSON.stringify(bounds.candidateFace));
          await page.screenshot({ path: path.join(out, 'workbench-' + scenario.selected.length + '-of-5-' + width + '.png') });
          measurements.push({ selectedCount: scenario.selected.length, width, height, ...bounds });
        }
      }
      await fresh();
      for (const id of ['fool', 'magician', 'moon', 'empress', 'emperor']) await add(id);
      assert.equal(await page.locator('.history-row').count(), 5);
      assert.equal(await page.locator('.candidate-card').count(), 0, 'completed game has no active candidate choices');
      const completed = [];
      for (const [width, height] of [[1024, 768], [1440, 900]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => scrollTo(0, 0));
        const bounds = await page.evaluate(() => {
          const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width) }; };
          return { history: box('.history-panel'), completion: box('.completion'), scrollY };
        });
        assert.equal(bounds.scrollY, 0);
        assert.ok(bounds.history.bottom <= height, width + 'px completed history is below fold: ' + JSON.stringify(bounds));
        assert.ok(bounds.completion.bottom <= height, width + 'px completion state is below fold: ' + JSON.stringify(bounds));
        await page.screenshot({ path: path.join(out, 'workbench-complete-' + width + '.png') });
        completed.push({ width, height, ...bounds });
      }
      return { measurements, completed };
    });
    await fresh();
    await check('result-draft-cancel', async () => {
      await select('#add-history', 'magician');
      await page.locator('[data-outcome="failure"]').click();
      assert.equal(await page.locator('.history-row').count(), 0);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.history-row').count(), 0);
    });
    await fresh();
    await check('five-turns-special-undo-refresh', async () => {
      await add('fool');
      await add('magician', 'failure');
      await add('tower', 'success', 'purple', '[data-tower-proc="true"]');
      await add('star', 'success', 'purple', '[data-remove-card="fool"]');
      assert.equal((await stored()).state.selected[0].removed, true);
      await page.reload();
      await page.locator('#undo').click();
      const saved = await stored();
      assert.equal(saved.state.turn, 4);
      assert.equal(saved.state.selected.length, 3);
      assert.notEqual(saved.state.selected[0].removed, true);
      await add('star', 'success', 'purple', '[data-remove-card="magician"]');
      await add('moon', 'success', 'red');
      assert.equal(await page.locator('#completion-title').count(), 1);
      assert.match(await page.locator('.workflow [aria-current="step"]').innerText(), /本局完成/);
      assert.equal(await page.locator('[data-pick]').count(), 0);
      assert.equal((await stored()).state.selected.length, 5);
      await page.screenshot({ path: path.join(out, 'completed-1440.png'), fullPage: true });
    });
    await fresh();
    await check('worker-modes-fixed-slots-duplicate', async () => {
      await select('[data-pick="0"]', 'fool');
      await page.locator('[data-pick="1"]').click();
      assert.equal(await page.locator('[data-picker-card="fool"]').isDisabled(), true);
      await page.keyboard.press('Escape');
      await select('[data-pick="1"]', 'strength', 'purple');
      await select('[data-pick="2"]', 'moon', 'red');
      await page.waitForFunction(() => document.querySelectorAll('[data-choose]').length === 3, null, { timeout: 120000 });
      const ids = () => page.locator('[data-choose]').evaluateAll(els => els.map(el => el.dataset.choose));
      assert.deepEqual(await ids(), ['fool', 'strength', 'moon']);
      assert.match(await page.locator('.workflow [aria-current="step"]').innerText(), /比較推薦/);
      assert.equal(await page.locator('.metric-details').first().evaluate(el => el.open), false);
      await page.locator('.metric-details > summary').first().click();
      assert.equal(await page.locator('.metric-help').first().isVisible(), true);
      await page.locator('.metric-details > summary').first().click();
      await page.locator('.goal-settings > summary').click();
      for (const [mode, label] of [['expected', '預期分數'], ['stability', '保守 P10'], ['threshold', '達標率']]) {
        await page.locator(`[data-objective="${mode}"]`).click();
        await page.waitForFunction(() => document.querySelectorAll('[data-choose]').length === 3, null, { timeout: 120000 });
        assert.deepEqual(await ids(), ['fool', 'strength', 'moon']);
        assert.ok((await page.locator('.metric-main').first().innerText()).includes(label));
      }
      for (const width of [375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `results overflow at ${width}`);
        await page.screenshot({ path: path.join(out, `results-${width}.png`), fullPage: true });
      }
      await page.locator('#target').fill('-1');
      await page.locator('#target').press('Tab');
      assert.equal(await page.locator('#target').getAttribute('aria-invalid'), 'true');
      assert.equal(await page.locator('[data-choose]:enabled').count(), 0);
    });
    await fresh();
    await check('mobile-final-turn-exact-zero', async () => {
      await page.setViewportSize({ width: 375, height: 812 });
      for (const id of ['fool', 'magician', 'empress', 'strength']) await add(id);
      await page.locator('.goal-settings > summary').click();
      await page.locator('#target').fill('1000000');
      await page.locator('#target').press('Tab');
      for (const [i, id] of ['moon', 'tower', 'star'].entries()) await select(`[data-pick="${i}"]`, id);
      await page.waitForFunction(() => document.querySelectorAll('[data-choose]').length === 3);
      const metrics = await page.locator('.metric-main strong').evaluateAll(els => els.map(el => ({ text: el.innerText, detail: el.parentElement.querySelector('.sr-only')?.textContent })));
      assert.equal(metrics.filter(metric => metric.text === '0%' && metric.detail.includes('依目前模型為 0')).length, 3, JSON.stringify(metrics));
      assert.ok(!metrics.some(metric => metric.detail.includes('抽樣')), JSON.stringify(metrics));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(out, 'final-turn-mobile.png'), fullPage: true });
      await page.locator('[data-choose="moon"]').click();
      if (!await page.locator('dialog').count()) await page.getByRole('button', { name: /記錄.*結果/ }).last().click();
      await page.locator('[data-outcome="failure"]').click();
      await page.locator('[data-commit-outcome]').click();
      assert.equal(await page.locator('#completion-title').count(), 1);
      assert.equal((await stored()).state.selected.length, 5);
    });
    await fresh();
    await check('keyboard-picker-search-category-focus', async () => {
      await page.locator('[data-pick="0"]').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#card-search').evaluate(el => el === document.activeElement), true);
      await page.locator('#card-search').fill('月亮');
      await page.locator('[data-picker-card="moon"]').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('[data-picker-card="moon"]').evaluate(el => el === document.activeElement), true);
      await page.locator('[data-picker-color="purple"]').focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#card-search').inputValue(), '月亮');
      for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('dialog'))), true); }
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('[data-pick="0"]').evaluate(el => el === document.activeElement), true);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('[data-pick="0"]').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    });
    await fresh();
    await check('reset-during-worker-does-not-restore-old-results', async () => {
      await select('[data-pick="0"]', 'fool');
      await select('[data-pick="1"]', 'magician');
      await select('[data-pick="2"]', 'moon');
      await page.locator('#reset').click();
      await page.locator('[data-reset-confirm]').click();
      await page.waitForTimeout(1500); // Deliberately wait past the debounce and prior worker response.
      assert.equal(await page.locator('[data-choose]').count(), 0);
      assert.deepEqual((await stored()).candidates, [null, null, null]);
    });
    await fresh();
    await check('reset-confirmation-and-preferences', async () => {
      await select('[data-pick="0"]', 'moon');
      await page.locator('#reset').click();
      assert.equal(await page.locator('[data-reset-cancel]').evaluate(el => el === document.activeElement), true);
      assert.equal((await stored()).candidates[0].cardId, 'moon');
      await page.locator('[data-reset-cancel]').click();
      assert.equal((await stored()).candidates[0].cardId, 'moon');
      await page.locator('#reset').click();
      await page.locator('[data-reset-confirm]').click();
      assert.deepEqual((await stored()).candidates, [null, null, null]);
    });
    await check('malformed-storage-recovery', async () => {
      for (const selected of [[null], [{ cardId: 'toString', color: 'blue', activated: true }], [{ cardId: 'fool', color: 'blue', activated: true, removed: 'false' }]]) {
        await page.evaluate(selected => localStorage.setItem('yuria-web-session-v1', JSON.stringify({ state: { turn: 1, selected }, candidates: [null, null, null] })), selected);
        await page.reload();
        assert.equal(await page.locator('.history-row').count(), 0);
        assert.equal(await page.locator('[data-pick]').count(), 3);
      }
    });
    await fresh();
    await check('text-contrast-control-size', async () => {
      await page.setViewportSize({ width: 375, height: 900 });
      await page.locator('[data-pick="0"]').click();
      const visual = await page.evaluate(() => {
        const rgb = color => color.match(/[\d.]+/g).map(Number);
        const composite = (front, back) => { const alpha = front[3] ?? 1; return front.slice(0, 3).map((x, i) => x * alpha + back[i] * (1 - alpha)); };
        const luminance = color => color.slice(0, 3).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
        const contrast = element => {
          const chain = []; for (let el = element; el; el = el.parentElement) chain.unshift(el);
          let bg = [255, 255, 255]; for (const el of chain) bg = composite(rgb(getComputedStyle(el).backgroundColor), bg);
          const foreground = composite(rgb(getComputedStyle(element).color), bg);
          const values = [luminance(foreground), luminance(bg)].sort((a, b) => b - a);
          return (values[0] + .05) / (values[1] + .05);
        };
        const samples = ['h1', '.subhead', '.picker-card strong', '.picker-card small', '.picker-card span', '.picker-color', '.picker-categories button', '.picker-search label'].map(selector => ({ selector, ratio: contrast(document.querySelector(selector)) }));
        const smallControls = [...document.querySelectorAll('dialog button:not(:disabled)')].filter(el => el.getClientRects().length).map(el => ({ text: el.textContent.trim(), width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })).filter(el => el.width < 44 || el.height < 44);
        return { samples, smallControls };
      });
      assert.equal(visual.smallControls.length, 0, JSON.stringify(visual.smallControls));
      assert.ok(visual.samples.every(sample => sample.ratio >= 4.5), JSON.stringify(visual.samples));
      await page.keyboard.press('Escape');
      return visual;
    });
    await check('worker-error-retry-preserves-input', async () => {
      const fault = await browser.newPage();
      try {
        await fault.addInitScript(() => {
          const RealWorker = window.Worker;
          let failed = false;
          window.Worker = class extends EventTarget {
            constructor(...args) { super(); this.real = new RealWorker(...args); }
            addEventListener(...args) { return this.real.addEventListener(...args); }
            postMessage(...args) { if (failed) return this.real.postMessage(...args); failed = true; this.timer = setTimeout(() => this.real.dispatchEvent(new ErrorEvent('error', { message: 'Acceptance injected worker failure' })), 20); }
            terminate() { clearTimeout(this.timer); this.real.terminate(); }
          };
        });
        await fault.goto(url);
        for (const [i, id] of ['fool', 'magician', 'moon'].entries()) {
          await fault.locator(`[data-pick="${i}"]`).click();
          await fault.locator(`[data-picker-card="${id}"]`).click();
          await fault.locator('[data-picker-apply]').click();
        }
        await fault.locator('#retry-calculation').waitFor();
        assert.equal(await fault.locator('[data-pick]').count(), 3);
        await fault.locator('#retry-calculation').click();
        await fault.waitForFunction(() => document.querySelectorAll('[data-choose]').length === 3, null, { timeout: 120000 });
        return { injected: 'first Worker error; retry uses real Worker' };
      } finally { await fault.close(); }
    });
    assert.equal(errors.length, 0, `Uncaught page errors: ${errors.join('; ')}`);
  } catch (error) { report.failure = error.stack; process.exitCode = 1; }
  finally { fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); await browser.close(); }
})();
