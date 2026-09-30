// Read-only audit. Raw records remain at the caller's path; output contains aggregate evidence.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '..');
const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) throw new Error('Usage: node scripts/audit-real-games.cjs INPUT.json OUTPUT.json');
const bytes = fs.readFileSync(input);
const envelope = JSON.parse(bytes);
const bundled = buildSync({ stdin: { contents: 'export * from "./src/domain"; export * from "./src/real-game-record";', resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', write: false });
const engineModule = new Module(path.join(root, 'audit-engine.cjs'), module);
engineModule._compile(bundled.outputFiles[0].text, path.join(root, 'audit-engine.cjs'));
const E = engineModule.exports;
const games = envelope.games;
if (!Array.isArray(games)) throw new Error('Missing games array');
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
const quantile = (a, q) => { const sorted = [...a].sort((x, y) => x - y); return sorted.length ? sorted[Math.floor((sorted.length - 1) * q)] : null; };
const rng = E.mulberry32(20260930);
function ci(values, statistic = mean, samples = 10000) {
  if (!values.length) return null;
  const draws = Array.from({ length: samples }, () => statistic(Array.from({ length: values.length }, () => values[Math.floor(rng() * values.length)])));
  return [quantile(draws, .025), quantile(draws, .975)];
}
function wilson(success, n) {
  if (!n) return null;
  const p = success / n, z = 1.95996398454, d = 1 + z * z / n;
  const center = (p + z * z / (2 * n)) / d;
  const radius = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return [center - radius, center + radius];
}
const counts = values => values.reduce((o, v) => { o[v] = (o[v] || 0) + 1; return o; }, {});
const valid = games.filter(E.isValidGameRecord);
const actual = valid.filter(g => g.actualFinalScore !== null);
const model = valid.filter(g => g.actualFinalScore === null && g.modelFinalScore != null);
const groupBy = (list, key) => [...new Set(list.map(key))].map(k => [k, list.filter(g => key(g) === k)]);
const reconstruct = g => g.rounds.map(r => ({ ...r.chosen, activated: r.activated, towerProc: r.towerProc ?? undefined, removed: g.rounds.some(s => s.starRemovedCardId === r.chosen.cardId) }));
const scoreRows = actual.map(g => {
  const selected = reconstruct(g), summary = E.summarizeScore(selected, g.rulesSnapshot);
  const scores = Array.from({ length: 10001 }, (_, i) => E.calculateScore(selected, () => (i + .5) / 10001, g.rulesSnapshot).finalScore);
  const exactSet = new Set(scores);
  const nearest = Math.min(...[...exactSet].map(s => Math.abs(s - g.actualFinalScore)));
  return { engine: g.engineVersion, score: g.actualFinalScore, residual: g.actualFinalScore - summary.meanScore, min: summary.minScore, max: summary.maxScore,
    inRange: g.actualFinalScore >= summary.minScore && g.actualFinalScore <= summary.maxScore, exactMember: exactSet.has(g.actualFinalScore), nearest,
    red: selected.filter(c => c.activated && !c.removed && c.color === 'red').length, specials: selected.filter(c => c.activated && !c.removed && E.CARDS[c.cardId].category === 'special').map(c => c.cardId),
    evidence: g.evidenceLevel, ordinal: games.indexOf(g) + 1, modelStored: g.modelFinalScore ?? null };
});
function cohort(list) {
  const scores = list.map(g => g.actualFinalScore);
  const hits = scores.filter(s => s >= 1500).length;
  return { n: list.length, mean: mean(scores), meanCI95: ci(scores), median: quantile(scores, .5), p10: quantile(scores, .1), p90: quantile(scores, .9), min: Math.min(...scores), max: Math.max(...scores),
    hits1500: hits, hitRate1500: list.length ? hits / list.length : null, hitRateCI95: wilson(hits, list.length),
    hits3000: scores.filter(s => s >= 3000).length,
    targetHits: list.filter(g => g.actualFinalScore >= g.rounds[0].target).length,
    targets: counts(list.map(g => g.rounds[0]?.target)), objectives: counts(list.map(g => g.rounds[0]?.objective.kind)), simulations: counts(list.map(g => g.simulations)),
    firstAt: list.length ? list.map(g => g.createdAt).sort()[0] : null, lastAt: list.length ? list.map(g => g.createdAt).sort().at(-1) : null,
    allRecommendationsFollowed: list.filter(g => g.rounds.every(r => r.recommendedCardId && r.chosen.cardId === r.recommendedCardId)).length };
}
const roundRows = actual.flatMap(g => g.rounds.map(r => {
  const pred = r.predictions?.find(p => p.cardId === r.chosen.cardId);
  return { g, r, pred, hit: +(g.actualFinalScore >= r.target), follow: r.recommendedCardId === r.chosen.cardId };
}));
function predictionStats(rows) {
  const use = rows.filter(x => x.pred);
  const residuals = use.map(x => x.g.actualFinalScore - x.pred.meanScore);
  const hits = use.map(x => x.hit), ps = use.map(x => x.pred.thresholdProbability);
  return { n: use.length, actualMean: mean(use.map(x => x.g.actualFinalScore)), predictedMean: mean(use.map(x => x.pred.meanScore)), biasActualMinusPrediction: mean(residuals), biasCI95: ci(residuals),
    mae: mean(residuals.map(Math.abs)), rmse: use.length ? Math.sqrt(mean(residuals.map(x => x * x))) : null,
    actualHitRate: mean(hits), predictedHitRate: mean(ps), brier: mean(use.map(x => (x.hit - x.pred.thresholdProbability) ** 2)),
    p10p90Coverage: mean(use.map(x => +(x.g.actualFinalScore >= x.pred.p10 && x.g.actualFinalScore <= x.pred.p90))),
    followed: use.filter(x => x.follow).length };
}
const activation = Object.values(E.CARDS).map(c => {
  const rows = valid.flatMap(g => g.rounds).filter(r => r.chosen.cardId === c.id), n = rows.length, success = rows.filter(r => r.activated).length;
  return { card: c.id, name: c.name, n, success, observed: n ? success / n : null, catalog: c.activationProbability, CI95: wilson(success, n),
    expectedSuccess: n * c.activationProbability };
});
const offers = valid.flatMap(g => g.rounds.filter(r => r.offers).map(r => ({ g, r })));
function summarizeOffers(source) { return [1, 2, 3, 4, 5].map(turn => {
  const rows = source.filter(x => x.r.turn === turn);
  const categories = counts(rows.flatMap(x => x.r.offers.map(o => E.CARDS[o.cardId].category)));
  const expected = { score: 0, multiplier: 0, special: 0 }, cardObserved = {}, cardExpected = {};
  const sims = 1000;
  const gameDifferences = {score:[],multiplier:[],special:[]};
  for (const {g, r} of rows) {
    const before = {...expected};
    for (const o of r.offers) cardObserved[o.cardId] = (cardObserved[o.cardId] || 0) + 1;
    const prefix = reconstruct(g).slice(0, turn - 1).map(c => ({...c, removed: false}));
    for (let i = 0; i < sims; i++) for (const o of E.generateOffer(rng, prefix, turn, g.rulesSnapshot)) {
      expected[E.CARDS[o.cardId].category] += 1 / sims;
      cardExpected[o.cardId] = (cardExpected[o.cardId] || 0) + 1 / sims;
    }
    for (const category of Object.keys(expected)) gameDifferences[category].push(r.offers.filter(o=>E.CARDS[o.cardId].category===category).length-(expected[category]-before[category]));
  }
  return { turn, rounds: rows.length, oneEach: rows.filter(x => new Set(x.r.offers.map(o => o.color)).size === 3).length, categories, expectedCategories: expected,
    categoryDifferencePerRound:Object.fromEntries(Object.entries(gameDifferences).map(([key,values])=>[key,{mean:mean(values),CI95:ci(values)}])),
    cards: Object.values(E.CARDS).map(c => ({card:c.id, observed:cardObserved[c.id] || 0, expected:cardExpected[c.id] || 0})) };
}); }
const offerSummary = summarizeOffers(offers);
const latestOffers = summarizeOffers(offers.filter(x=>x.g.engineVersion===E.ENGINE_VERSION));
const current = actual.filter(g => g.engineVersion === E.ENGINE_VERSION), older = actual.filter(g => g.engineVersion !== E.ENGINE_VERSION);
function compare(a, b) {
  const draws = Array.from({length:10000}, () => mean(Array.from({length:a.length}, () => a[Math.floor(rng()*a.length)].actualFinalScore)) - mean(Array.from({length:b.length}, () => b[Math.floor(rng()*b.length)].actualFinalScore)));
  return {difference:mean(a.map(g=>g.actualFinalScore))-mean(b.map(g=>g.actualFinalScore)), CI95:[quantile(draws,.025),quantile(draws,.975)]};
}
let difference = null;
if (current.length && older.length) {
  const ds = Array.from({length:10000}, () => mean(Array.from({length:current.length}, () => current[Math.floor(rng()*current.length)].actualFinalScore)) - mean(Array.from({length:older.length}, () => older[Math.floor(rng()*older.length)].actualFinalScore)));
  difference = { currentMinusOlder: mean(current.map(g=>g.actualFinalScore)) - mean(older.map(g=>g.actualFinalScore)), CI95:[quantile(ds,.025),quantile(ds,.975)] };
}
const report = {
  provenance:{ exportedAt:envelope.exportedAt, sha256:crypto.createHash('sha256').update(bytes).digest('hex'), sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(), bootstrapSeed:20260930, bootstrapSamples:10000, offerSimulationsPerObservedRound:1000 },
  hygiene:{total:games.length, valid:valid.length, invalidOrdinals:games.map((g,i)=>E.isValidGameRecord(g)?null:i+1).filter(Boolean), uniqueIds:new Set(games.map(g=>g.id)).size,
    actual:actual.length, modelOnly:model.length, noScore:valid.length-actual.length-model.length, evidence:counts(actual.map(g=>g.evidenceLevel)), versions:counts(valid.map(g=>g.engineVersion)),
    rules:counts(valid.map(g=>JSON.stringify(Object.fromEntries(Object.entries(g.rulesSnapshot).sort(([a],[b])=>a.localeCompare(b)))))), revised:valid.filter(g=>g.revision>0).length, allOffers:valid.filter(g=>g.rounds.every(r=>r.offers)).length,
    allPredictions:valid.filter(g=>g.rounds.every(r=>r.predictions?.length===3)).length },
  cohorts:Object.fromEntries(groupBy(actual,g=>g.engineVersion).map(([k,list])=>[k,cohort(list)])), overall:cohort(actual), currentVsOlder:difference,
  currentVsPredecessor:compare(current,actual.filter(g=>g.engineVersion==='b-deterministic-2026-09-28-one-each-color')),
  target3000Comparison:compare(current.filter(g=>g.rounds[0].target===3000),actual.filter(g=>g.engineVersion==='b-deterministic-2026-09-28-one-each-color'&&g.rounds[0].target===3000)),
  objectives:Object.fromEntries(groupBy(actual,g=>g.rounds[0]?.objective.kind).map(([k,list])=>[k,cohort(list)])),
  scoreAudit:{n:scoreRows.length,inRange:scoreRows.filter(r=>r.inRange).length,exactMembers:scoreRows.filter(r=>r.exactMember).length,
    noRed:scoreRows.filter(r=>r.red<2).length,noRedExact:scoreRows.filter(r=>r.red<2&&r.exactMember).length,
    byEngine:Object.fromEntries(groupBy(scoreRows,r=>r.engine).map(([k,list])=>[k,{n:list.length,inRange:list.filter(r=>r.inRange).length,exact:list.filter(r=>r.exactMember).length,mae:mean(list.map(r=>Math.abs(r.residual)))}])),
    mismatches:scoreRows.filter(r=>!r.exactMember)},
  predictionsByTurn:[1,2,3,4,5].map(turn=>({turn,...predictionStats(roundRows.filter(x=>x.r.turn===turn))})),
  firstTurnByEngine:Object.fromEntries(groupBy(actual,g=>g.engineVersion).map(([k,list])=>[k,predictionStats(roundRows.filter(x=>x.r.turn===1&&list.includes(x.g)))])),
  calibrationFirstTurn:Array.from({length:10},(_,bin)=>{const rows=roundRows.filter(x=>x.r.turn===1&&x.pred&&Math.min(9,Math.floor(x.pred.thresholdProbability*10))===bin); return {lo:bin/10,hi:(bin+1)/10,...predictionStats(rows)};}),
  recommendationFollowing:{known:roundRows.filter(x=>x.r.recommendedCardId).length,followed:roundRows.filter(x=>x.r.recommendedCardId&&x.follow).length},
  activation, offers:offerSummary, latestOffers,
  tower:{n:valid.flatMap(g=>g.rounds).filter(r=>r.chosen.cardId==='tower'&&r.activated).length,high:valid.flatMap(g=>g.rounds).filter(r=>r.chosen.cardId==='tower'&&r.activated&&r.towerProc).length},
};
fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({hygiene:report.hygiene,cohorts:report.cohorts,currentVsOlder:report.currentVsOlder,scoreAudit:{...report.scoreAudit,mismatches:report.scoreAudit.mismatches.slice(0,12)},predictions:report.predictionsByTurn,follow:report.recommendationFollowing},null,2));
