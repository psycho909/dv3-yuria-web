// Regression replay of the user's screenshot (see docs/evidence/score-748.md).
// Run: node --import tsx scripts/repro-score-748.ts
import assert from "node:assert/strict";
import { calculateScore } from "../src/domain/scoring.js";
import type { SelectedCard } from "../src/domain/types.js";

const reportedScore = 748;
const selected: SelectedCard[] = [
  { cardId: "devil", color: "blue", activated: false },
  { cardId: "high_priestess", color: "blue", activated: true },
  { cardId: "fool", color: "blue", activated: true },
  { cardId: "hierophant", color: "blue", activated: false, removed: true },
  { cardId: "star", color: "purple", activated: true }
];
const result = calculateScore(selected, () => {
  throw new Error("No random score roll is expected in this board");
});
console.log(JSON.stringify({ reportedScore, ...result }, null, 2));
assert.equal(result.sum, 220, "Screenshot SUM must match");
assert.equal(result.multiplier, 3.4, "Screenshot multiplier must match");
assert.equal(result.finalScore, reportedScore, "Screenshot final score must match");
console.log("SCREENSHOT 748 REGRESSION PASS");
