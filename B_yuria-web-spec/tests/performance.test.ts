import { cpus, release } from "node:os";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { recommend, type GameState, type OfferedCard } from "../src/domain";

const simulations = 10_000;
const samples = 5;
const turn1: GameState = { turn: 1, selected: [] };
const turn1Candidates: OfferedCard[] = [
  { cardId: "magician", color: "purple" },
  { cardId: "death", color: "blue" },
  { cardId: "lovers", color: "red" }
];
const turn5: GameState = {
  turn: 5,
  selected: [
    { cardId: "magician", color: "red", activated: true },
    { cardId: "strength", color: "blue", activated: true },
    { cardId: "justice", color: "purple", activated: true },
    { cardId: "moon", color: "blue", activated: true }
  ]
};
const turn5Candidates: OfferedCard[] = [
  { cardId: "fool", color: "red" },
  { cardId: "tower", color: "purple" },
  { cardId: "star", color: "blue" }
];

function measure(state: GameState, candidates: OfferedCard[], seed: number) {
  const start = performance.now();
  const result = recommend(state, candidates, { kind: "expected" }, simulations, seed);
  const elapsedMs = performance.now() - start;
  expect(result.ranked).toHaveLength(candidates.length);
  expect(result.ranked.every(metric => Number.isFinite(metric.meanScore))).toBe(true);
  return { elapsedMs, result };
}

describe("recommend performance evidence", () => {
  it("measures five full 10,000-simulation samples per candidate", { timeout: 120_000 }, () => {
    measure(turn1, turn1Candidates, 20260922);
    measure(turn5, turn5Candidates, 20260922);

    const turn1Ms: number[] = [];
    const turn5Ms: number[] = [];
    for (let sample = 0; sample < samples; sample++) {
      const turn1Run = measure(turn1, turn1Candidates, 20260922 + sample);
      const turn5Run = measure(turn5, turn5Candidates, 20260922 + sample);
      expect(turn1Run.result.ranked.every(metric => metric.method === "monte_carlo" && metric.simulations === simulations)).toBe(true);
      expect(turn5Run.result.ranked.every(metric => metric.method === "exact" && metric.simulations === 0)).toBe(true);
      turn1Ms.push(Number(turn1Run.elapsedMs.toFixed(3)));
      turn5Ms.push(Number(turn5Run.elapsedMs.toFixed(3)));
    }

    console.log(JSON.stringify({
      environment: {
        node: process.version,
        v8: process.versions.v8,
        platform: process.platform,
        release: release(),
        arch: process.arch,
        cpu: cpus()[0]?.model ?? "unknown",
        cpuCount: cpus().length
      },
      candidates: turn1Candidates.length,
      simulationsPerCandidate: simulations,
      measuredSamples: samples,
      warmupRuns: 2,
      turn1Ms,
      turn5Ms
    }, null, 2));
  });
});
