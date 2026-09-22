import { describe, expect, it } from "vitest";
import { CARDS } from "../src/domain/cards.js";
import { calculateScore, DEFAULT_RULES } from "../src/domain/scoring.js";
import { recommendCandidates } from "../src/domain/simulation.js";
import type { SelectedCard } from "../src/domain/types.js";

// User-transcribed card details, 2026-09-22: the latest Emperor observation
// is 80%; Sun base +40%, plus +40% per active card. These are not
// screenshot-verified frequencies. The earlier 55% Emperor observation is
// retained only in historical evidence.
describe("current user-supplied card details", () => {
  const sunBoard: SelectedCard[] = [
    { cardId: "fool", color: "blue", activated: true },
    { cardId: "devil", color: "red", activated: false },
    { cardId: "hierophant", color: "blue", activated: true, removed: true },
    { cardId: "sun", color: "purple", activated: true }
  ];

  it("applies Sun base 40% and counts only present active cards", () => {
    const score = calculateScore(sunBoard, () => 0.5);
    expect(score.sum).toBe(95);
    expect(score.multiplier).toBeCloseTo(2.2);
    expect(score.finalScore).toBe(209);
  });

  it("retains the alternative that Sun excludes itself", () => {
    const score = calculateScore(sunBoard, () => 0.5, { ...DEFAULT_RULES, sunCountsSelf: false });
    expect(score.multiplier).toBeCloseTo(1.8);
    expect(score.finalScore).toBe(171);
  });

  it("uses the latest supplied 80% Emperor probability in actual rollouts", () => {
    const metric = recommendCandidates({
      state: { turn: 5, selected: [
        { cardId: "devil", color: "blue", activated: false },
        { cardId: "hierophant", color: "blue", activated: false },
        { cardId: "high_priestess", color: "blue", activated: false },
        { cardId: "chariot", color: "blue", activated: false }
      ] }, candidates: [{ cardId: "emperor", color: "red" }],
      threshold: 175, simulations: 10_000, seed: 20260922
    }).ranked[0]!;
    expect(metric.thresholdProbability).toBeGreaterThan(0.78);
    expect(metric.thresholdProbability).toBeLessThan(0.83);
    expect(metric.meanScore).toBeGreaterThan(158);
    expect(metric.meanScore).toBeLessThan(163);
  });

  it("uses Moon's supplied +20 base and +100 per failed card", () => {
    const score = calculateScore([
      { cardId: "devil", color: "blue", activated: false },
      { cardId: "hierophant", color: "red", activated: false },
      { cardId: "moon", color: "blue", activated: true }
    ], () => 0.5);
    expect(score.sum).toBe(260);
    expect(score.finalScore).toBe(260);
  });

  it("uses the supplied Wheel of Fortune +90% multiplier", () => {
    const score = calculateScore([
      { cardId: "fool", color: "blue", activated: true },
      { cardId: "wheel_of_fortune", color: "red", activated: true }
    ], () => 0.5);
    expect(score.multiplier).toBeCloseTo(1.9);
    expect(score.finalScore).toBe(142);
  });

  it("uses the supplied Death +110% multiplier and 70% success", () => {
    const score = calculateScore([
      { cardId: "fool", color: "blue", activated: true },
      { cardId: "death", color: "purple", activated: true }
    ], () => 0.5);
    expect(CARDS.death.activationProbability).toBe(0.7);
    expect(score.multiplier).toBeCloseTo(2.1);
    expect(score.finalScore).toBe(157);
  });

  it("uses Tower's supplied +200% proc and +25% fallback", () => {
    const board = [
      { cardId: "high_priestess" as const, color: "blue" as const, activated: false },
      { cardId: "star" as const, color: "blue" as const, activated: true },
      { cardId: "magician" as const, color: "blue" as const, activated: true }
    ];
    const proc = calculateScore([...board, { cardId: "tower", color: "blue", activated: true, towerProc: true }], () => 0.5);
    const fallback = calculateScore([...board, { cardId: "tower", color: "blue", activated: true, towerProc: false }], () => 0.5);
    expect(proc.sum).toBe(180);
    expect(proc.multiplier).toBeCloseTo(5.4);
    expect(proc.finalScore).toBe(972);
    expect(fallback.multiplier).toBeCloseTo(3.65);
    expect(fallback.finalScore).toBe(657);
  });
});
