import { describe, expect, it } from "vitest";
import { RULES, recommend, type GameState, type OfferedCard, type SelectedCard } from "../src/domain";
import {
  comparePrototype, exactFinalDistribution, recommendCandidatesPrototype, weightedMetrics,
  type PrototypeResult
} from "../src/recommendation-v2";
import { evaluatePairedPolicies, v1Policy, type TrialPolicy } from "./experiments/v1-baseline.test";

const selected: SelectedCard[] = [
  { cardId: "fool", color: "blue", activated: true },
  { cardId: "magician", color: "purple", activated: true },
  { cardId: "strength", color: "red", activated: true }
];
const offers: OfferedCard[] = [
  { cardId: "hierophant", color: "blue" },
  { cardId: "empress", color: "red" },
  { cardId: "tower", color: "purple" }
];
const config = { scenarioCount: 8, pilotSamples: 4, seed: 20260922, target: 1500 };

describe("bounded V2 method prototype", () => {
  it("calculates fractional weighted CVaR10 exactly", () => {
    const metrics = weightedMetrics([
      { score: 500, weight: .05 }, { score: 900, weight: .1 }, { score: 1500, weight: .85 }
    ], 1000);
    expect(metrics.cvar10).toBeCloseTo(700);
    expect(metrics.p10).toBe(900);
    expect(metrics.targetProbability).toBeCloseTo(.85);
  });

  it("uses the objective at every comparator call, with stable led by CVaR", () => {
    const make = (cardId: OfferedCard["cardId"], mean: number, hit: number, tail: number, p10: number): PrototypeResult => ({
      candidate: { cardId, color: "blue" }, rank: 0,
      metrics: { expectedScore: mean, targetProbability: hit, cvar10: tail, p10, p50: mean, p90: mean, minScore: tail, maxScore: mean },
      distribution: [], method: "bounded-two-step", simulations: 1, lookaheadDepth: 2,
      diagnostics: { rootScenarios: 1, pilotSamplesPerAction: 1, maxPilotRollouts: 3, seed: 1 }
    });
    const a = make("fool", 1900, .35, 700, 1000);
    const b = make("magician", 1800, .55, 920, 990);
    expect(comparePrototype(a, b, { kind: "expected" })).toBeLessThan(0);
    expect(comparePrototype(a, b, { kind: "threshold", target: 2000 })).toBeGreaterThan(0);
    expect(comparePrototype(a, b, { kind: "stability" })).toBeGreaterThan(0);
  });

  it("is seeded, candidate-order independent, and reports its bounded depth", () => {
    const state: GameState = { turn: 4, selected };
    const a = recommendCandidatesPrototype(state, offers, { kind: "expected" }, config);
    const b = recommendCandidatesPrototype(state, [...offers].reverse(), { kind: "expected" }, config);
    expect(a).toEqual(recommendCandidatesPrototype(state, offers, { kind: "expected" }, config));
    expect(a).toEqual(b);
    expect(a.every(row => row.method === "bounded-two-step" && row.lookaheadDepth === 2)).toBe(true);
    expect(a.every(row => Math.abs(row.distribution.reduce((s, x) => s + x.weight, 0) - 1) < 1e-9)).toBe(true);
  });

  it("matches V1 Round 5 exact metrics, including special branches", () => {
    const state: GameState = { turn: 5, selected: [...selected, { cardId: "chariot", color: "blue", activated: false }] };
    const candidates: OfferedCard[] = [
      { cardId: "tower", color: "purple" }, { cardId: "star", color: "red" }, { cardId: "world", color: "blue" }
    ];
    const prototype = recommendCandidatesPrototype(state, candidates, { kind: "expected" }, config);
    const v1 = recommend(state, candidates, { kind: "expected" }, 10, config.seed, RULES, config.target).ranked;
    for (const row of prototype) {
      const old = v1.find(x => x.candidate.cardId === row.candidate.cardId)!;
      expect(row.method).toBe("exact");
      expect(row.simulations).toBe(0);
      expect(row.metrics.expectedScore).toBeCloseTo(old.meanScore);
      expect(row.metrics.targetProbability).toBeCloseTo(old.thresholdProbability);
      expect(row.metrics.p10).toBe(old.p10);
      expect(exactFinalDistribution(state.selected, row.candidate).reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1);
    }
  });

  it("rejects unbounded work and invalid current offers", () => {
    expect(() => recommendCandidatesPrototype({ turn: 4, selected }, offers, { kind: "expected" }, { ...config, scenarioCount: 10000 })).toThrow("Out-of-budget");
    expect(() => recommendCandidatesPrototype({ turn: 4, selected }, [offers[0]!, offers[0]!, offers[2]!], { kind: "expected" }, config)).toThrow("Exactly three");
  });

  const experiment = process.env.RUN_POLICY_EXPERIMENT === "1" ? it : it.skip;
  experiment("runs a paired 30-game feasibility pilot without treating it as evidence of gain", { timeout: 180_000 }, () => {
    const prototypePolicy: TrialPolicy = {
      name: "v2-bounded-expected",
      choose(state, offer, planningSeed) {
        return recommendCandidatesPrototype(state, offer, { kind: "expected" }, { ...config, seed: planningSeed }).at(0)!.candidate;
      }
    };
    const seeds = Array.from({ length: 30 }, (_, index) => 20260922 + index * 7919);
    const started = performance.now();
    const result = evaluatePairedPolicies([v1Policy({ kind: "expected" }, 32), prototypePolicy], seeds);
    console.log("V2 bounded paired pilot", JSON.stringify({ summaries: result.summaries, durationMs: Math.round(performance.now() - started), config }));
    expect(result.trials).toHaveLength(60);
  });
});
