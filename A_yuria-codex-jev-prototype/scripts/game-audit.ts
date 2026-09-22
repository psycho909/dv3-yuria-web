import { writeFileSync } from "node:fs";
import { recommendCandidates } from "../src/domain/simulation.js";
import { formatRecommendation } from "../src/cli/format-recommendation.js";

const scores = [748, 972, 1270, 840];
const result = recommendCandidates({ state: { turn: 5, selected: [
  { cardId: "hierophant", color: "purple", activated: true },
  { cardId: "world", color: "blue", activated: false },
  { cardId: "emperor", color: "red", activated: true },
  { cardId: "justice", color: "purple", activated: false }
] }, candidates: [ { cardId: "sun", color: "blue" }, { cardId: "judgement", color: "purple" }, { cardId: "star", color: "red" } ], objective: { kind: "threshold_probability", threshold: 1500 } });
const report = {
  scores, completedGames: scores.length, average: scores.reduce((a, b) => a + b, 0) / scores.length,
  minimum: Math.min(...scores), maximum: Math.max(...scores), atLeast1000: scores.filter(x => x >= 1000).length,
  atLeast1500: scores.filter(x => x >= 1500).length,
  limitations: ["Only user-reported completed games counted; partial games excluded.", "Not a controlled policy comparison; do not infer calibrated success rates from four games.", "972 final card/branch and 840 removal/red branch are model-consistent reconstructions, not directly observed details."],
  lastGameRecommendation: result
};
writeFileSync(new URL("../docs/evidence/optimization-audit.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({scores, average: report.average, atLeast1000: report.atLeast1000, atLeast1500: report.atLeast1500}));
console.log(formatRecommendation(result));
