import { calculateScore, DEFAULT_RULES } from "../src/domain/scoring.js";
import { recommendCandidates } from "../src/domain/simulation.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`SELFTEST FAILED: ${message}`);
}

const fixedMid = () => 0.5;
const a = calculateScore([
  { cardId: "fool", color: "red", activated: true },
  { cardId: "strength", color: "blue", activated: true }
], fixedMid, DEFAULT_RULES);
assert(a.sum === 75, "base SUM");
assert(Math.abs(a.multiplier - 1.8) < 1e-9, "multiplier addition");
assert(a.finalScore === 135, "floor final score");

const b = calculateScore([
  { cardId: "fool", color: "blue", activated: true },
  { cardId: "magician", color: "blue", activated: true }
], fixedMid, DEFAULT_RULES);
assert(b.sum === 195, "blue tier bonus");

const input = {
  state: {
    turn: 5 as const,
    selected: [
      { cardId: "fool" as const, color: "blue" as const, activated: true },
      { cardId: "strength" as const, color: "purple" as const, activated: true },
      { cardId: "lovers" as const, color: "blue" as const, activated: true },
      { cardId: "justice" as const, color: "red" as const, activated: true }
    ]
  },
  candidates: [
    { cardId: "hermit" as const, color: "blue" as const },
    { cardId: "judgement" as const, color: "purple" as const },
    { cardId: "devil" as const, color: "red" as const }
  ],
  simulations: 500,
  seed: 12345
};
const r1 = recommendCandidates(input);
const r2 = recommendCandidates(input);
assert(r1.ranked.length === 3, "three candidates returned");
assert(JSON.stringify(r1.ranked.map((x) => x.meanScore)) === JSON.stringify(r2.ranked.map((x) => x.meanScore)), "seed reproducibility");
console.log("SELFTEST PASS");
