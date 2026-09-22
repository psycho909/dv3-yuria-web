import { writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { CARDS } from "../src/domain/cards.js";
import { calculateScore, DEFAULT_RULES } from "../src/domain/scoring.js";
import { generateOffer, recommendCandidates, resolveSelection } from "../src/domain/simulation.js";
import { mulberry32 } from "../src/domain/random.js";
import type { GameState, SelectedCard, RecommendationResult } from "../src/domain/types.js";

const seed = 202609220;
const games = [];
for (let game = 1; game <= 30; game++) {
  // Game outcomes cannot consume the recommendation's internal RNG stream.
  const gameSeed = seed + game * 1009;
  const rng = mulberry32(gameSeed);
  let selected: SelectedCard[] = [];
  const turns: {turn: number; recommendationSeed: number; recommendation: RecommendationResult; selectedAfter: SelectedCard[]}[] = [];
  for (let turn = 1; turn <= 5; turn++) {
    const candidates = generateOffer(rng, selected, turn, DEFAULT_RULES);
    const recommendationSeed = 100000000 + game * 100003 + turn * 997;
    const recommendation = recommendCandidates({
      state: {turn: turn as GameState["turn"], selected}, candidates,
      objective: {kind: "threshold_probability", threshold: 1500},
      simulations: 20000, seed: recommendationSeed
    });
    selected = resolveSelection(rng, selected, recommendation.ranked[0]!.candidate, DEFAULT_RULES);
    turns.push({turn, recommendationSeed, recommendation, selectedAfter: structuredClone(selected)});
  }
  const score = calculateScore(selected, rng, DEFAULT_RULES);
  games.push({game, gameSeed, turns, score});
  console.log(`Game ${game}/30: ${score.finalScore}`);
}
const scores = games.map(g => g.score.finalScore);
const sorted = [...scores].sort((a, b) => a - b);
const summary = {
  count: games.length, scores, mean: scores.reduce((s, v) => s + v, 0) / scores.length,
  median: (sorted[14]! + sorted[15]!) / 2, min: sorted[0], max: sorted.at(-1),
  atLeast1000: scores.filter(s => s >= 1000).length,
  atLeast1500: scores.filter(s => s >= 1500).length,
  hitRate: scores.filter(s => s >= 1500).length / scores.length
};
const sourceHashes = Object.fromEntries(["simulation", "scoring", "distribution", "cards", "random"].map(name => [name, createHash("sha256").update(readFileSync(new URL(`../src/domain/${name}.ts`, import.meta.url))).digest("hex")]));
writeFileSync(new URL("../docs/evidence/simulated-30-games.json", import.meta.url), JSON.stringify({
  kind: "synthetic_model_self_play_not_real_game_validation", seed,
  recommendationStreamCaveat: "Some game/candidate pairs reuse recommendation streams because both seed offsets use 100003. Actual-game RNG is separate. Report descriptive statistics only, not independent-replicate confidence intervals.",
  decisionSamplesPerCandidate: 20000, finalTurnMethod: "exact", objectiveSource: "explicit_user_target_no_Jev_call_needed",
  rules: DEFAULT_RULES, cards: CARDS, sourceHashes, summary, games
}, null, 2) + "\n");
writeFileSync(new URL("../docs/SIMULATED_30_GAMES.md", import.meta.url), `# 30 場模型模擬（非真實遊玩）\n\n目標 1500 分；每回合重新推薦；每候選 20,000 次抽樣，終局精確列舉。遊戲與推薦亂數分離，固定種子 ${seed}。無新增 Jev 呼叫；目標已明確，由數學引擎執行。\n\n平均 ${summary.mean.toFixed(1)}、中位數 ${summary.median}、最低 ${summary.min}、最高 ${summary.max}；1000 分以上 ${summary.atLeast1000}/30；1500 分以上 ${summary.atLeast1500}/30（${(summary.hitRate * 100).toFixed(1)}%）。\n\n| 場次 | 最終分數 | 達1500 |\n| --- | ---: | --- |\n${games.map(g => `| ${g.game} | ${g.score.finalScore} | ${g.score.finalScore >= 1500 ? "是" : "否"} |`).join("\n")}\n\n此結果僅描述目前規則假設下的一批模擬，不是遊戲真實達標率，也不是舊新策略對照。出牌分布、星移除等機率、太陽自計數仍是假設；祝福未建模。未來預測採近似策略，與每回合重新規劃的自動遊玩策略不完全相同。\n\n完整每回合候選、推薦值、成功失敗、移除狀態、結算與原始碼雜湊：evidence/simulated-30-games.json。\n\n重現：\n\n\`node --import tsx scripts/simulate-30-games.ts\`\n`);
console.log(JSON.stringify(summary));
