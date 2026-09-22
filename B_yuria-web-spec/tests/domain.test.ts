import { describe, expect, it } from "vitest";
import {
  CARDS,
  RULES,
  calculateScore,
  mulberry32,
  recommend,
  resolveSelection,
  summarizeScore,
  type SelectedCard
} from "../src/domain";

const active = (cardId: SelectedCard["cardId"], color: SelectedCard["color"]): SelectedCard => ({ cardId, color, activated: true });
const failed = (cardId: SelectedCard["cardId"], color: SelectedCard["color"]): SelectedCard => ({ cardId, color, activated: false });

describe("deterministic score engine", () => {
  it("applies the blue two-card tier once", () => {
    const result = calculateScore([active("fool", "blue"), active("magician", "blue")], () => 0, RULES);

    expect(result.sum).toBe(195);
    expect(result.activeColorCounts.blue).toBe(2);
    expect(result.finalScore).toBe(195);
  });

  it("keeps failed cards in SUM and applies purple as additive multiplier", () => {
    const result = calculateScore([
      failed("fool", "purple"),
      active("magician", "purple"),
      active("strength", "purple")
    ], () => 0, RULES);

    // 20 failure points + 80 score, then +0.4 purple tier and +0.8 Strength.
    expect(result.sum).toBe(100);
    expect(result.multiplier).toBeCloseTo(2.2);
    expect(result.finalScore).toBe(220);
  });

  it("removes a star target from both score and color counts", () => {
    const selected = resolveSelection(
      () => 0,
      [active("fool", "blue")],
      { cardId: "star", color: "blue" },
      RULES
    );
    const result = calculateScore(selected, () => 0, RULES);

    expect(selected.find(card => card.cardId === "fool")?.removed).toBe(true);
    expect(result.activeColorCounts.blue).toBe(1);
    expect(result.sum).toBe(0);
    expect(result.multiplier).toBe(3.4); // base 1 + Star 2.4
  });

  it("records Tower proc and special cards as executable rules", () => {
    const selected = resolveSelection(
      () => 0,
      [],
      { cardId: "tower", color: "purple" },
      RULES
    );
    const result = calculateScore(selected, () => 0, RULES);

    expect(CARDS.tower.specialEffect?.kind).toBe("tower");
    expect(selected[0]?.towerProc).toBe(true);
    expect(result.multiplier).toBe(3); // base 1 + Tower 2; one purple card has no tier bonus
  });

  it("uses Moon, World, and Sun effects in the same deterministic breakdown", () => {
    const result = calculateScore([
      failed("fool", "red"),
      active("magician", "red"),
      active("world", "blue"),
      active("sun", "purple"),
      active("moon", "blue")
    ], () => 0, RULES);

    // SUM: failure 20 + Magician 80 + blue tier 40 + Moon 20 + one failed card bonus 100 + World 160.
    expect(result.sum).toBe(420);
    // Sun: +0.4 base + 4 active cards * 0.4; no purple tier because only one purple card.
    expect(result.multiplier).toBeCloseTo(3);
    expect(result.finalScore).toBe(1260);
  });

  it("samples red integer bonus from the configured range", () => {
    const result = calculateScore([
      active("fool", "red"),
      active("magician", "red")
    ], () => 0, RULES);

    expect(result.redBonus).toBe(0.1);
    expect(result.finalScore).toBe(170);
  });

  it("reproduces the recorded 1648 score under the continuous-red hypothesis", () => {
    const result = calculateScore([
      active("lovers", "red"),
      active("devil", "purple"),
      active("strength", "purple"),
      active("magician", "purple"),
      active("judgement", "red")
    ], () => .8221, { ...RULES, redRollMode: "continuous" });

    expect(result.sum).toBe(340);
    expect(result.multiplier).toBeCloseTo(4.1);
    expect(result.finalScore).toBe(1648);
  });

  it("enumerates the configured integer-red range for score summaries", () => {
    const summary = summarizeScore([active("fool", "red"), active("magician", "red")], RULES);

    expect(summary.method).toBe("exact");
    expect(summary.minScore).toBe(170);
    expect(summary.maxScore).toBe(186);
    expect(summary.meanScore).toBeCloseTo(177.8182, 3);
    expect([summary.p10, summary.p50, summary.p90]).toEqual([172, 178, 184]);
  });

  it("marks a no-red integer summary as exact without duplicate samples", () => {
    expect(summarizeScore([active("fool", "blue")], RULES)).toEqual({
      meanScore: 75,
      p10: 75,
      p50: 75,
      p90: 75,
      minScore: 75,
      maxScore: 75,
      method: "exact"
    });
  });

  it("keeps the final-turn exact metrics aligned with score summaries", () => {
    const selected = [
      active("magician", "red"),
      active("strength", "blue"),
      active("justice", "purple"),
      active("moon", "blue")
    ];
    const candidate = { cardId: "fool" as const, color: "red" as const };
    const summary = summarizeScore([...selected, active(candidate.cardId, candidate.color)], RULES);
    const metric = recommend(
      { turn: 5, selected },
      [candidate],
      { kind: "expected" },
      10_000,
      42
    ).ranked[0]!;

    expect(metric.method).toBe("exact");
    expect(metric.simulations).toBe(0);
    expect(metric.meanScore).toBeCloseTo(summary.meanScore, 10);
    expect([metric.p10, metric.p50, metric.p90, metric.minScore, metric.maxScore]).toEqual([
      summary.p10,
      summary.p50,
      summary.p90,
      summary.minScore,
      summary.maxScore
    ]);
  });
});

describe("recommendation reproducibility", () => {
  it("returns identical results for the same seed and input", () => {
    const state = { turn: 1 as const, selected: [] };
    const candidates = [
      { cardId: "magician" as const, color: "purple" as const },
      { cardId: "death" as const, color: "blue" as const },
      { cardId: "lovers" as const, color: "red" as const }
    ];
    const first = recommend(state, candidates, { kind: "threshold", target: 1500 }, 120, 42);
    const second = recommend(state, candidates, { kind: "threshold", target: 1500 }, 120, 42);

    expect(second).toEqual(first);
  });

  it("keeps the best expected-score option when the target is unreachable", () => {
    const result = recommend(
      { turn: 5, selected: [active("devil", "purple")] },
      [
        { cardId: "magician", color: "blue" },
        { cardId: "fool", color: "red" },
        { cardId: "strength", color: "purple" }
      ],
      { kind: "threshold", target: 1_000_000 },
      80,
      7
    );

    expect(result.mode).toBe("highest_expected_score_fallback");
    expect(result.ranked[0]?.meanScore).toBeGreaterThanOrEqual(result.ranked[1]?.meanScore ?? 0);
    expect(result.ranked.every(metric => metric.thresholdProbability === 0)).toBe(true);
  });

  it("keeps the seeded RNG stable across calls", () => {
    const firstRng = mulberry32(20260922);
    const secondRng = mulberry32(20260922);
    const first = Array.from({ length: 5 }, () => firstRng());
    const second = Array.from({ length: 5 }, () => secondRng());
    expect(second).toEqual(first);
  });
});
