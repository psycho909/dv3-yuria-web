import { describe, expect, it } from "vitest";
import {
  CARDS,
  RULES,
  calculateScore,
  generateOffer,
  LEGACY_V1_OPTIONS,
  mulberry32,
  recommend,
  resolveSelection,
  summarizeScore,
  type OfferedCard,
  type SelectedCard
} from "../src/domain";

const active = (cardId: SelectedCard["cardId"], color: SelectedCard["color"]): SelectedCard => ({ cardId, color, activated: true });
const failed = (cardId: SelectedCard["cardId"], color: SelectedCard["color"]): SelectedCard => ({ cardId, color, activated: false });

describe("deterministic score engine", () => {
  it("offers one of each color in varying positions without repeating cards", () => {
    expect(RULES.futureColorModel).toBe("oneEach");
    const orders = new Set<string>();
    for (let seed = 0; seed < 20; seed++) for (let turn = 1; turn <= 5; turn++) {
      const offer = generateOffer(mulberry32(seed), [active("fool", "blue")], turn);
      expect(offer.map(card => card.color).sort()).toEqual(["blue", "purple", "red"]);
      expect(new Set(offer.map(card => card.cardId)).size).toBe(3);
      expect(offer.some(card => card.cardId === "fool")).toBe(false);
      orders.add(offer.map(card => card.color).join(","));
    }
    expect(orders.size).toBeGreaterThan(1);
    expect(generateOffer(() => 0, [], 1, { ...RULES, futureColorModel: "independentUniform" }).map(card => card.color)).toEqual(["blue", "blue", "blue"]);
  });
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
    const beforeFinish = resolveSelection(
      () => 0,
      [active("fool", "blue")],
      { cardId: "star", color: "blue" },
      RULES
    );
    expect(beforeFinish.find(card => card.cardId === "fool")?.removed).not.toBe(true);
    const withFourth = resolveSelection(() => 0, [...beforeFinish, active("magician", "purple")], { cardId: "empress", color: "red" }, RULES);
    const selected = resolveSelection(() => 0, withFourth, { cardId: "emperor", color: "blue" }, RULES);
    const result = calculateScore(selected, () => 0, RULES);

    expect(selected.find(card => card.cardId === "fool")?.removed).toBe(true);
    expect(result.activeColorCounts.blue).toBe(2);
    expect(result.sum).toBeGreaterThan(0);
    expect(result.multiplier).toBe(3.4); // base 1 + Star 2.4
  });

  it("includes the fifth card when resolving an earlier Star", () => {
    const selected = [active("fool", "blue"), active("star", "blue"), active("magician", "blue"), active("empress", "blue")];
    const candidate = { cardId: "emperor" as const, color: "blue" as const };
    const metric = recommend({ turn: 5, selected }, [candidate], { kind: "expected" }, 80, 42).ranked[0]!;
    const meanAfterStar = (activated: boolean) => {
      const completed = [...selected, { ...candidate, activated }];
      return [0, 2, 3, 4].reduce((sum, index) => sum + calculateScore(completed.map((card, i) => i === index ? { ...card, removed: true } : card), () => 0, RULES).finalScore, 0) / 4;
    };
    const expected = CARDS.emperor.activationProbability * meanAfterStar(true) + (1 - CARDS.emperor.activationProbability) * meanAfterStar(false);
    expect(metric.method).toBe("exact");
    expect(metric.meanScore).toBeCloseTo(expected, 9);
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

  it("keeps a three-red auto score identifiable as an estimate", () => {
    const summary = summarizeScore([
      active("fool", "red"), active("hanged_man", "red"), active("chariot", "red"),
      failed("temperance", "red"), failed("wheel_of_fortune", "red")
    ], RULES);
    expect([summary.minScore, summary.maxScore]).toEqual([450, 487]);
    expect(Math.round(summary.meanScore)).toBe(468);
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
  it("replays the 2026-09-28 engine exactly with legacy options", () => {
    const result = recommend(
      { turn: 1, selected: [] },
      [
        { cardId: "magician", color: "purple" },
        { cardId: "death", color: "blue" },
        { cardId: "lovers", color: "red" }
      ],
      { kind: "threshold", target: 1500 },
      120,
      42,
      RULES,
      1500,
      LEGACY_V1_OPTIONS
    );

    expect(result.mode).toBe("objective");
    expect(result.ranked.map(metric => ({
      cardId: metric.candidate.cardId,
      meanScore: metric.meanScore,
      p10: metric.p10,
      p50: metric.p50,
      p90: metric.p90,
      thresholdProbability: metric.thresholdProbability
    }))).toEqual([
      { cardId: "magician", meanScore: 1103.1916666666666, p10: 494, p50: 996, p90: 1681, thresholdProbability: 30 / 120 },
      { cardId: "lovers", meanScore: 1077.625, p10: 500, p50: 979, p90: 1688, thresholdProbability: 25 / 120 },
      { cardId: "death", meanScore: 1001.225, p10: 476, p50: 924, p90: 1548, thresholdProbability: 16 / 120 }
    ]);
  });

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

  it("gives each candidate the same metrics regardless of candidate order", () => {
    const candidates: OfferedCard[] = [
      { cardId: "magician", color: "purple" },
      { cardId: "death", color: "blue" },
      { cardId: "lovers", color: "red" }
    ];
    const byId = (order: OfferedCard[]) => new Map(recommend({ turn: 1, selected: [] }, order, { kind: "threshold", target: 1500 }, 120, 42).ranked.map(metric => [metric.candidate.cardId, metric]));
    const forward = byId(candidates);
    const backward = byId([...candidates].reverse());
    for (const candidate of candidates) expect(backward.get(candidate.cardId)).toEqual(forward.get(candidate.cardId));
    expect([...forward.values()].every(metric => metric.method === "monte_carlo" && metric.simulations === 120)).toBe(true);
  });

  it("keeps the exact final step consistent with sampling the fifth card", () => {
    const state = { turn: 4 as const, selected: [active("fool", "blue"), active("strength", "purple"), active("magician", "blue")] };
    const candidate: OfferedCard = { cardId: "empress", color: "blue" };
    const objective = { kind: "threshold" as const, target: 800 };
    const sampled = recommend(state, [candidate], objective, 8000, 11, RULES, 800, LEGACY_V1_OPTIONS).ranked[0]!;
    const exact = recommend(state, [candidate], objective, 8000, 11).ranked[0]!;
    // Same rollout policy; only the estimator differs, so both estimate the same quantities.
    expect(Math.abs(exact.meanScore - sampled.meanScore)).toBeLessThan(sampled.meanScore * .03);
    expect(Math.abs(exact.thresholdProbability - sampled.thresholdProbability)).toBeLessThan(.03);
    expect(exact.thresholdProbability).toBeGreaterThan(0);
    expect(exact.thresholdProbability).toBeLessThan(1);
  });

  it("picks the rollout's fifth card by the screen objective", () => {
    const state = { turn: 3 as const, selected: [active("fool", "blue"), active("strength", "purple")] };
    const candidates: OfferedCard[] = [
      { cardId: "magician", color: "blue" },
      { cardId: "justice", color: "red" },
      { cardId: "hermit", color: "purple" }
    ];
    const byObjective = recommend(state, candidates, { kind: "expected" }, 500, 5, RULES, 1500);
    const byTarget = recommend(state, candidates, { kind: "expected" }, 500, 5, RULES, 1500, { finalChoice: "threshold" });
    // Rollouts share every random draw, so choosing the best mean at the last step can only raise the mean.
    for (const metric of byObjective.ranked) {
      const legacy = byTarget.ranked.find(item => item.candidate.cardId === metric.candidate.cardId)!;
      expect(metric.meanScore).toBeGreaterThanOrEqual(legacy.meanScore - 1e-6);
    }
  });

  it("offers experimental zero-target fallbacks without changing the default", () => {
    const state = { turn: 5 as const, selected: [active("devil", "purple")] };
    const candidates: OfferedCard[] = [
      { cardId: "magician", color: "blue" },
      { cardId: "fool", color: "red" },
      { cardId: "strength", color: "purple" }
    ];
    const objective = { kind: "threshold" as const, target: 1_000_000 };
    const order = (options: Parameters<typeof recommend>[7]) => recommend(state, candidates, objective, 80, 7, RULES, 1500, options);
    expect(order({}).mode).toBe("highest_expected_score_fallback");
    const upperTail = order({ zeroTargetFallback: "upperTail" });
    expect(upperTail.mode).toBe("zero_target_fallback");
    expect(upperTail.ranked.map(metric => metric.candidate.cardId)).toEqual(["strength", "magician", "fool"]);
    // 200 is the highest reward tier any option can reach: Fool and Strength always do, Magician 95%.
    expect(order({ zeroTargetFallback: "rewardTier" }).ranked.map(metric => metric.candidate.cardId)).toEqual(["strength", "fool", "magician"]);
  });

  it("keeps the seeded RNG stable across calls", () => {
    const firstRng = mulberry32(20260922);
    const secondRng = mulberry32(20260922);
    const first = Array.from({ length: 5 }, () => firstRng());
    const second = Array.from({ length: 5 }, () => secondRng());
    expect(second).toEqual(first);
  });
});
