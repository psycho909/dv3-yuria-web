import { performance } from "node:perf_hooks";
import { it } from "vitest";
import { recommend } from "../src/domain";
import { recommendCandidatesV21 } from "../src/recommendation-v21";

it("measures one V1 10,000-simulation turn-one recommendation", () => {
  const start = performance.now();
  recommend(
    { turn: 1, selected: [] },
    [
      { cardId: "devil", color: "red" },
      { cardId: "fool", color: "blue" },
      { cardId: "hermit", color: "purple" }
    ],
    { kind: "expected" },
    10_000,
    1
  );
  console.log("V1 default turn-one runtime", Math.round(performance.now() - start));
});

it("measures one default-budget turn-one V2.1 recommendation", () => {
  const start = performance.now();
  const result = recommendCandidatesV21(
    { turn: 1, selected: [] },
    [
      { cardId: "devil", color: "red" },
      { cardId: "fool", color: "blue" },
      { cardId: "hermit", color: "purple" }
    ],
    { kind: "expected" },
    { scenarioCount: 256, pilotSamples: 32, searchDepth: 2, seed: 1, target: 1500 }
  );
  console.log("V2.1 default turn-one runtime", JSON.stringify({ elapsedMs: Math.round(performance.now() - start), order: result.map(row => row.candidate.cardId), diagnostics: result[0]?.diagnostics }));
}, 60_000);
