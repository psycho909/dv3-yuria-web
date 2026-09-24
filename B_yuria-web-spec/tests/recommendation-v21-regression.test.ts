import { describe, expect, it } from "vitest";
import { RULES, calculateScore, recommend, type GameState, type OfferedCard, type SelectedCard } from "../src/domain";
import { exactFinalDistribution, weightedMetrics } from "../src/recommendation-v2";
import {
  evaluateCutoffActionsV21,
  expectedFinalActionScoreV21,
  expectedScoreForStateV21,
  recommendCandidatesV21,
  type V21Config
} from "../src/recommendation-v21";

const config: V21Config = {
  scenarioCount: 8,
  pilotSamples: 16,
  searchDepth: 2,
  seed: 20260923,
  target: 1500
};

describe("isolated V2.1 recommendation engine", () => {
  it("includes the blue threshold when evaluating an activation outcome", () => {
    const state: GameState = {
      turn: 2,
      selected: [{ cardId: "fool", color: "blue", activated: true }]
    };
    const blue = evaluateCutoffActionsV21(state, [{ cardId: "magician", color: "blue" }], config)[0]!;
    const purple = evaluateCutoffActionsV21(state, [{ cardId: "magician", color: "purple" }], config)[0]!;

    expect(blue.colorPotential).toBeCloseTo(38); // 95% activation × 40 points
    expect(purple.colorPotential).toBe(0);
    expect(blue.value).toBeGreaterThan(purple.value);
  });

  it("includes purple multiplier thresholds and World score synergy", () => {
    const purpleState: GameState = {
      turn: 2,
      selected: [{ cardId: "fool", color: "purple", activated: true }]
    };
    const purple = evaluateCutoffActionsV21(purpleState, [{ cardId: "strength", color: "purple" }], config)[0]!;
    expect(purple.colorPotential).toBeCloseTo(30); // 40% multiplier × 75 base points

    const worldState: GameState = {
      turn: 2,
      selected: [{ cardId: "devil", color: "blue", activated: true }]
    };
    const world = evaluateCutoffActionsV21(worldState, [{ cardId: "world", color: "red" }], config)[0]!;
    expect(world.specialPotential).toBeCloseTo(150); // 50% activation × 2 × 150
  });

  it("computes color and special score parts exactly for a final selected state", () => {
    const cards: SelectedCard[] = [
      { cardId: "devil", color: "blue", activated: true },
      { cardId: "world", color: "purple", activated: true },
      { cardId: "strength", color: "purple", activated: true },
      { cardId: "lovers", color: "red", activated: true },
      { cardId: "emperor", color: "red", activated: true }
    ];
    const rollCount = 11; // two active red cards produce integer rolls from 10% to 20%
    const expected = Array.from({ length: rollCount }, (_, index) =>
      calculateScore(cards, () => (index + 0.5) / rollCount, RULES).finalScore
    ).reduce((sum, score) => sum + score, 0) / rollCount;

    expect(expectedScoreForStateV21(cards)).toBe(expected);
  });

  it("matches the exact terminal score distribution for stochastic and special final actions", () => {
    const selected: SelectedCard[] = [
      { cardId: "devil", color: "blue", activated: true },
      { cardId: "strength", color: "purple", activated: true },
      { cardId: "chariot", color: "red", activated: false },
      { cardId: "emperor", color: "blue", activated: true }
    ];
    const candidates: OfferedCard[] = [
      { cardId: "tower", color: "purple" },
      { cardId: "star", color: "red" },
      { cardId: "world", color: "blue" },
      { cardId: "hermit", color: "red" }
    ];

    for (const candidate of candidates) {
      const exact = weightedMetrics(exactFinalDistribution(selected, candidate, RULES), config.target).expectedScore;
      expect(expectedFinalActionScoreV21(selected, candidate, RULES)).toBeCloseTo(exact, 10);
    }
  });

  it("matches the shared exact Round 5 distribution including Tower, Star, World and failure branches", () => {
    const selected: SelectedCard[] = [
      { cardId: "fool", color: "blue", activated: true },
      { cardId: "strength", color: "purple", activated: true },
      { cardId: "devil", color: "red", activated: true },
      { cardId: "chariot", color: "blue", activated: false }
    ];
    const candidates: OfferedCard[] = [
      { cardId: "tower", color: "purple" },
      { cardId: "star", color: "red" },
      { cardId: "world", color: "blue" }
    ];
    const state: GameState = { turn: 5, selected };
    const expected = recommend(state, candidates, { kind: "expected" }, 16, config.seed, RULES, config.target).ranked;
    const actual = recommendCandidatesV21(state, candidates, { kind: "expected" }, config);

    expect(actual.map(result => result.candidate.cardId)).toEqual(expected.map(result => result.candidate.cardId));
    for (const result of actual) {
      const baseline = expected.find(row => row.candidate.cardId === result.candidate.cardId)!;
      expect(result.method).toBe("exact");
      expect(result.simulations).toBe(0);
      expect(result.metrics.expectedScore).toBeCloseTo(baseline.meanScore);
      expect(result.metrics.targetProbability).toBeCloseTo(baseline.thresholdProbability);
    }
  });

  it("is seeded, order-independent, and limits its API to expected-score search", () => {
    const state: GameState = { turn: 4, selected: [
      { cardId: "fool", color: "blue", activated: true },
      { cardId: "strength", color: "purple", activated: true },
      { cardId: "devil", color: "red", activated: true }
    ] };
    const offers: OfferedCard[] = [
      { cardId: "hierophant", color: "blue" },
      { cardId: "empress", color: "red" },
      { cardId: "tower", color: "purple" }
    ];
    const result = recommendCandidatesV21(state, offers, { kind: "expected" }, config);

    expect(recommendCandidatesV21(state, offers, { kind: "expected" }, config)).toEqual(result);
    expect(recommendCandidatesV21(state, [...offers].reverse(), { kind: "expected" }, config)).toEqual(result);
    expect(result.every(row => row.method === "monte-carlo-v21" && row.simulations === config.scenarioCount)).toBe(true);
    expect(() => recommendCandidatesV21(state, offers, { kind: "stability" }, config)).toThrow("Expected Score objective only");
    expect(() => recommendCandidatesV21(state, offers, { kind: "expected" }, { ...config, scenarioCount: 257 })).toThrow("scenarioCount");
    expect(() => recommendCandidatesV21(state, offers, { kind: "expected" }, { ...config, pilotSamples: 4 })).toThrow("pilotSamples must be 16, 32, or 64");
  });
});
