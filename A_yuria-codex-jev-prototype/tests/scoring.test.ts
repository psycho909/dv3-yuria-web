import { describe, expect, it } from "vitest";
import { calculateScore, DEFAULT_RULES } from "../src/domain/scoring.js";

const fixedMid = () => 0.5;

describe("score formula", () => {
  it("adds score and multiplier instead of multiplying multiplier cards together", () => {
    const result = calculateScore([
      { cardId: "fool", color: "red", activated: true },
      { cardId: "strength", color: "blue", activated: true },
      { cardId: "death", color: "purple", activated: true }
    ], fixedMid, DEFAULT_RULES);
    expect(result.sum).toBe(75);
    expect(result.multiplier).toBeCloseTo(2.9);
    expect(result.finalScore).toBe(217);
  });

  it("gives failed cards 20 base points", () => {
    const result = calculateScore([
      { cardId: "judgement", color: "red", activated: false }
    ], fixedMid, DEFAULT_RULES);
    expect(result.sum).toBe(20);
    expect(result.finalScore).toBe(20);
  });

  it("applies only the current blue color tier", () => {
    const result = calculateScore([
      { cardId: "fool", color: "blue", activated: true },
      { cardId: "magician", color: "blue", activated: true }
    ], fixedMid, DEFAULT_RULES);
    expect(result.sum).toBe(75 + 80 + 40);
  });

  it("removed active cards do not count toward score or color", () => {
    const result = calculateScore([
      { cardId: "fool", color: "blue", activated: true, removed: true },
      { cardId: "magician", color: "blue", activated: true }
    ], fixedMid, DEFAULT_RULES);
    expect(result.sum).toBe(80);
    expect(result.activeColorCounts.blue).toBe(1);
  });
});
