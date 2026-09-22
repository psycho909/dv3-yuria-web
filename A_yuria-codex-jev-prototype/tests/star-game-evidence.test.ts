import { describe, expect, it } from "vitest";
import { calculateScore, DEFAULT_RULES } from "../src/domain/scoring.js";
import { approximateImmediateValue, recommendCandidates } from "../src/domain/simulation.js";
import type { SelectedCard } from "../src/domain/types.js";

// User's 2026-09-22 screenshot shows Hierophant crossed out, Star +240%,
// SUM 220, multiplier 340%, final 748. The preceding turn confirms
// Hierophant had already failed before Star was selected.
const beforeStar: SelectedCard[] = [
  { cardId: "devil", color: "blue", activated: false },
  { cardId: "high_priestess", color: "blue", activated: true },
  { cardId: "fool", color: "blue", activated: true },
  { cardId: "hierophant", color: "blue", activated: false }
];
const star = { cardId: "star", color: "purple" } as const;

describe("Star screenshot regression", () => {
  it("reproduces all three displayed score fields with failed Hierophant removed", () => {
    const result = calculateScore([
      ...beforeStar.map(card => card.cardId === "hierophant" ? { ...card, removed: true } : card),
      { ...star, activated: true }
    ], () => { throw new Error("This screenshot has no random red bonus"); });
    expect(result.sum).toBe(220);
    expect(result.multiplier).toBeCloseTo(3.4);
    expect(result.finalScore).toBe(748);
    expect(result.failedCount).toBe(1);
    expect(result.activeColorCounts).toEqual({ blue: 2, purple: 1, red: 0 });
  });

  // Equal removal probabilities are an explicit modeling assumption, NOT
  // established by one screenshot. These tests validate its implementation.
  it("includes failed-card removals in the assumed uniform rollout expectation", () => {
    // Removing Devil/High Priestess/Fool/Hierophant gives 748/391/425/748.
    expect(approximateImmediateValue(beforeStar, star, DEFAULT_RULES)).toBe(578);
  });

  it("uses the same failed-card eligibility in actual seeded simulations", () => {
    const metric = recommendCandidates({
      state: { turn: 5, selected: beforeStar }, candidates: [star],
      threshold: 700, simulations: 10_000, seed: 748
    }).ranked[0]!;
    expect(metric.meanScore).toBeGreaterThan(568);
    expect(metric.meanScore).toBeLessThan(588);
    expect(metric.thresholdProbability).toBeGreaterThan(0.47);
    expect(metric.thresholdProbability).toBeLessThan(0.53);
    expect(metric.p10).toBe(391);
    expect(metric.p90).toBe(748);
  });

  it("allows comparison with the explicit former active-only assumption", () => {
    const rules = { ...DEFAULT_RULES, starRemovalPolicy: "uniformActive" as const };
    expect(approximateImmediateValue(beforeStar, star, rules)).toBe(408);
    const metric = recommendCandidates({
      state: { turn: 5, selected: beforeStar }, candidates: [star], rules,
      threshold: 700, simulations: 1000, seed: 748
    }).ranked[0]!;
    expect(metric.thresholdProbability).toBe(0);
    expect(metric.p10).toBe(391);
    expect(metric.p90).toBe(425);
  });

  it("retains Star's own multiplier and color when there are no eligible targets", () => {
    const metric = recommendCandidates({
      state: { turn: 5, selected: beforeStar.map(card => ({ ...card, removed: true })) },
      candidates: [star], simulations: 20, seed: 748
    }).ranked[0]!;
    expect(metric.meanScore).toBe(0);
    // No target means no removal; fixed scoring can inspect the retained Star.
    const score = calculateScore([{ ...star, activated: true }], () => 0);
    expect(score.multiplier).toBe(3.4);
    expect(score.activeColorCounts.purple).toBe(1);
  });
});
