import { describe, expect, it } from "vitest";
import { approximateImmediateValue, compareCandidateMetrics, recommendCandidates } from "../src/domain/simulation.js";
import { DEFAULT_RULES } from "../src/domain/scoring.js";
import type { CandidateMetrics, GameState, OfferedCard, SelectedCard } from "../src/domain/types.js";

describe("rollout special-card expectations", () => {
  it("averages Tower's +200% proc and +25% fallback outcomes", () => {
    expect(approximateImmediateValue([{ cardId: "fool", color: "blue", activated: true }], { cardId: "tower", color: "purple" }, DEFAULT_RULES)).toBe(159);
  });

  it("averages Star removal outcomes, including lost score and color bonuses", () => {
    const selected: SelectedCard[] = [
      { cardId: "fool", color: "blue", activated: true },
      { cardId: "strength", color: "blue", activated: true }
    ];
    // Remove Fool: 0. Remove Strength: floor(75 * 3.4) = 255.
    expect(approximateImmediateValue(selected, { cardId: "star", color: "red" }, DEFAULT_RULES)).toBe(127.5);
    expect(selected.every((card) => !card.removed)).toBe(true);
  });

  it("lets Star remove a failed card, but never an already removed card", () => {
    expect(approximateImmediateValue([
      { cardId: "fool", color: "blue", activated: true, removed: true },
      { cardId: "magician", color: "purple", activated: false }
    ], { cardId: "star", color: "red" }, DEFAULT_RULES)).toBe(0);
  });
});

describe("ranking priority", () => {
  const metric: CandidateMetrics = {
    candidate: { cardId: "fool", color: "blue" }, meanScore: 1000,
    p10: 10, p50: 1000, p90: 2000, standardDeviation: 300,
    threshold: 2700, thresholdProbability: 0.000001, simulations: 2_000_000
  };

  it("never trades a higher threshold probability for a higher mean", () => {
    const lowerProbability = { ...metric, thresholdProbability: 0, meanScore: 2000 };
    expect(compareCandidateMetrics(metric, lowerProbability, { kind: "threshold_probability", threshold: 2700 })).toBeLessThan(0);
  });

  it("uses mean only when threshold probabilities tie", () => {
    expect(compareCandidateMetrics(metric, { ...metric, meanScore: 900 }, { kind: "threshold_probability", threshold: 2700 })).toBeLessThan(0);
  });

  it("keeps the lower-tail priority even with a large secondary score", () => {
    expect(compareCandidateMetrics(metric, { ...metric, p10: 9, meanScore: 2_000_000 }, { kind: "stability" })).toBeLessThan(0);
  });
});

describe("simulation contract", () => {
  const state: GameState = { turn: 3, selected: [
    { cardId: "lovers", color: "blue", activated: true },
    { cardId: "strength", color: "purple", activated: true }
  ] };
  const candidates: OfferedCard[] = [
    { cardId: "hermit", color: "blue" },
    { cardId: "justice", color: "purple" },
    { cardId: "devil", color: "red" }
  ];
  const input = { state, candidates, simulations: 100, seed: 12345 };

  it("preserves each candidate's complete metrics when the offer is reordered", () => {
    const before = structuredClone(input);
    const first = recommendCandidates(input);
    const reversed = recommendCandidates({ ...input, candidates: [...candidates].reverse() });
    for (const metric of first.ranked) {
      expect(reversed.ranked.find((other) => other.candidate.cardId === metric.candidate.cardId)).toEqual(metric);
    }
    expect(input).toEqual(before);
  });

  it.each([0, -1, 1.5, NaN, Infinity])("rejects invalid simulation count %s", (simulations) => {
    expect(() => recommendCandidates({ ...input, simulations })).toThrow(/simulations/);
  });

  it.each([-1, NaN, Infinity])("rejects invalid threshold %s", (threshold) => {
    expect(() => recommendCandidates({ ...input, threshold })).toThrow(/threshold/);
  });

  it("rejects a turn inconsistent with the selected-card history", () => {
    expect(() => recommendCandidates({ ...input, state: { ...state, turn: 5 } })).toThrow(/turn/);
  });

  it("rejects repeated card identities", () => {
    expect(() => recommendCandidates({ ...input, candidates: [candidates[0]!, candidates[0]!] })).toThrow(/unique/);
    expect(() => recommendCandidates({ ...input, candidates: [{ cardId: "lovers", color: "red" }] })).toThrow(/unique/);
  });

  it("matches an exact final-turn distribution for a guaranteed score card", () => {
    const result = recommendCandidates({
      state: { turn: 5, selected: [
        { cardId: "magician", color: "blue", activated: false },
        { cardId: "lovers", color: "blue", activated: false },
        { cardId: "justice", color: "purple", activated: false },
        { cardId: "strength", color: "purple", activated: false }
      ] }, candidates: [{ cardId: "fool", color: "red" }], simulations: 100, threshold: 155
    }).ranked[0]!;
    expect(result.meanScore).toBe(155);
    expect(result.thresholdProbability).toBe(1);
    expect(result.standardDeviation).toBe(0);
    expect([result.p10, result.p50, result.p90]).toEqual([155, 155, 155]);
  });

  it("falls back to the highest expected score when every threshold probability is zero", () => {
    const result = recommendCandidates({
      state,
      candidates,
      objective: { kind: "threshold_probability", threshold: 1_000_000 },
      simulations: 100,
      seed: 12345
    });
    expect(result.selectionMode).toBe("highest_expected_score_fallback");
    expect(result.ranked[0]!.meanScore).toBe(
      Math.max(...result.ranked.map((metric) => metric.meanScore))
    );
    expect(result.ranked.every((metric) => metric.thresholdProbability === 0)).toBe(true);
  });
});
