// Run against a built preview: node tests/real-game-flow.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const url = process.env.ACCEPTANCE_URL || 'http://127.0.0.1:4174';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const records = () => page.evaluate(async () => new Promise((resolve, reject) => {
    const open = indexedDB.open('yuria-real-games', 1);
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction('games', 'readonly').objectStore('games').getAll();
      read.onsuccess = () => { resolve(read.result); db.close(); };
      read.onerror = () => reject(read.error);
    };
    open.onerror = () => reject(open.error);
  }));
  const add = async (id, color = 'blue', outcome = 'success') => {
    await page.locator('#add-history').click();
    await page.locator(`[data-picker-card="${id}"]`).click();
    await page.locator(`[data-picker-color="${color}"]`).click();
    await page.locator('[data-picker-apply]').click();
    await page.locator(`[data-outcome="${outcome}"]`).click();
    await page.locator('[data-commit-outcome]').click();
  };
  try {
    await page.goto(url);
    for (const [id, color, outcome] of [['fool', 'blue', 'success'], ['magician', 'purple', 'failure'], ['empress', 'red', 'success'], ['emperor', 'blue', 'success'], ['hermit', 'purple', 'failure']]) await add(id, color, outcome);
    assert.equal((await records()).length, 0, 'completion alone must not archive');
    assert.match(await page.locator('.real-score-panel').innerText(), /紀錄本局/);
    await page.reload();
    assert.equal(await page.locator('.history-row').count(), 5);
    assert.equal((await records()).length, 0, 'reload must not archive');
    await page.locator('#actual-score-form button[type=submit]').click();
    await page.waitForFunction(async () => new Promise(resolve => {
      const open = indexedDB.open('yuria-real-games', 1);
      open.onsuccess = () => {
        const db = open.result;
        const read = db.transaction('games', 'readonly').objectStore('games').count();
        read.onsuccess = () => { resolve(read.result === 1); db.close(); };
      };
    }));
    let saved = await records();
    assert.equal(saved[0].status, 'recorded');
    assert.equal(saved[0].actualFinalScore, null);
    assert.equal(saved[0].rounds.length, 5);
    assert.equal(saved[0].rounds[0].chosen.cardId, 'fool');
    assert.equal(saved[0].rounds[1].activated, false);
    assert.equal(saved[0].rounds[0].offers, null, 'manual history does not invent offers');
    await page.locator('#edit-actual-score').click();
    await page.locator('#actual-final-score').fill('840');
    await page.locator('#actual-score-form button[type=submit]').click();
    await page.waitForFunction(async () => new Promise(resolve => {
      const open = indexedDB.open('yuria-real-games', 1);
      open.onsuccess = () => {
        const db = open.result;
        const read = db.transaction('games', 'readonly').objectStore('games').getAll();
        read.onsuccess = () => { resolve(read.result[0]?.actualFinalScore === 840); db.close(); };
      };
    }));
    saved = await records();
    assert.equal(saved[0].revision, 1);
    assert.equal(saved[0].actualFinalScore, 840);
    assert.equal(saved[0].revisions[0].previousScore, null);
    await page.locator('.real-archive > summary').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#export-real-games').click()]);
    const fs = require('node:fs');
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    assert.equal(exported.games.length, 1);
    await page.locator('#import-real-games').setInputFiles({ name: 'games.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
    await page.getByText('略過重複 1 局').waitFor();
    assert.equal((await records()).length, 1);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#reset').click();
    assert.equal((await records()).length, 1, 'new run must retain archive');
    for (const [index, id, color] of [[0, 'fool', 'blue'], [1, 'magician', 'purple'], [2, 'empress', 'red']]) {
      await page.locator(`[data-pick="${index}"]`).click();
      await page.locator(`[data-picker-card="${id}"]`).click();
      await page.locator(`[data-picker-color="${color}"]`).click();
      await page.locator('[data-picker-apply]').click();
    }
    await page.locator('[data-choose="fool"]').waitFor();
    await page.locator('[data-choose="fool"]').click();
    await page.locator('[data-outcome="success"]').click();
    await page.locator('[data-commit-outcome]').click();
    await add('emperor', 'blue');
    await add('hermit', 'purple');
    await add('justice', 'red');
    await add('chariot', 'blue');
    await page.locator('#actual-final-score').fill('972');
    await page.locator('#actual-score-form button[type=submit]').click();
    await page.waitForFunction(async () => new Promise(resolve => {
      const open = indexedDB.open('yuria-real-games', 1);
      open.onsuccess = () => {
        const db = open.result;
        const read = db.transaction('games', 'readonly').objectStore('games').count();
        read.onsuccess = () => { resolve(read.result === 2); db.close(); };
      };
    }));
    const second = (await records()).find(game => game.actualFinalScore === 972);
    assert.equal(second.rounds[0].offers.length, 3);
    assert.equal(second.rounds[0].predictions.length, 3);
    assert.equal(second.rounds[0].offers[0].catalogProbability, 1);
    assert.equal(second.rounds[0].offers[0].observedProbability, null);
    assert.deepEqual(errors, []);
    console.log('PASS real-game-flow: no premature save, optional score, correction, JSON roundtrip, reset retention, candidate snapshot, 0 page errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
