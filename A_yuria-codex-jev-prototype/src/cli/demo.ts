import { resolveObjective } from "../ai/jev.js";
import { recommendCandidates } from "../domain/simulation.js";
import type { GameState, OfferedCard } from "../domain/types.js";
import { formatRecommendation } from "./format-recommendation.js";

const useJev = process.argv.includes("--jev");
const goalText = "我想提高 Lv.7 2700 分的達標機率";
const objectiveResolution = await resolveObjective(goalText, useJev, { threshold: 2700 });

const state: GameState = {
  turn: 3,
  selected: [
    { cardId: "lovers", color: "blue", activated: true },
    { cardId: "strength", color: "purple", activated: true }
  ]
};

const candidates: OfferedCard[] = [
  { cardId: "hermit", color: "blue" },
  { cardId: "justice", color: "purple" },
  { cardId: "devil", color: "red" }
];

const result = recommendCandidates({
  state,
  candidates,
  objective: objectiveResolution.objective,
  simulations: 12_000,
  seed: 20260922
});

console.log(`Objective source: ${objectiveResolution.source}`);
console.log(`Objective: ${JSON.stringify(objectiveResolution.objective)}`);
console.log(`Selection mode: ${result.selectionMode}`);
console.log(formatRecommendation(result));
console.log("\nAssumptions:");
for (const item of result.assumptions) console.log(`- ${item}`);
