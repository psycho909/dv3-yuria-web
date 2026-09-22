import { expect, it } from "vitest";
import { calculateScore, DEFAULT_RULES } from "../src/domain/scoring.js";
import { finalTurnMetrics } from "../src/domain/distribution.js";
import { chooseFutureOffer, recommendCandidates } from "../src/domain/simulation.js";
import { formatRecommendation } from "../src/cli/format-recommendation.js";
import type { CardColor, CardId, SelectedCard } from "../src/domain/types.js";
import { CARDS } from "../src/domain/cards.js";

const ids: CardId[] = ["fool", "magician", "high_priestess", "empress", "emperor"];
it("retains the completed Justice details and the user-confirmed 1270 score", () => {
  expect(CARDS.justice).toMatchObject({ activationProbability: 0.8, multiplierValue: 1 });
  expect(CARDS.death.nameZh).toBe("死亡");
  expect(calculateScore([
    {cardId: "wheel_of_fortune", color: "blue", activated: false},
    {cardId: "lovers", color: "blue", activated: true},
    {cardId: "strength", color: "blue", activated: true},
    {cardId: "emperor", color: "blue", activated: true},
    {cardId: "judgement", color: "blue", activated: true}
  ], () => 0.5)).toMatchObject({sum: 385, multiplier: 3.3, finalScore: 1270});
});
it.each([2, 3, 4, 5])("applies all color tiers for %i active cards", n => {
  const board = (color: CardColor) => ids.slice(0, n).map(cardId => ({ cardId, color, activated: true }));
  const base = [75, 80, 85, 90, 95].slice(0, n).reduce((s, v) => s + v, 0);
  expect(calculateScore(board("blue"), () => 0).sum).toBe(base + [40, 80, 160, 250][n - 2]!);
  expect(calculateScore(board("purple"), () => 0).multiplier).toBeCloseTo(1 + [0.4, 0.8, 1.5, 2.4][n - 2]!);
  expect(calculateScore(board("red"), () => 0).redBonus).toBe([0.1, 0.2, 0.4, 0.6][n - 2]);
  expect(calculateScore(board("red"), () => 0.999999).redBonus).toBe([0.2, 0.3, 0.6, 0.9][n - 2]);
});
const board: SelectedCard[] = [
  { cardId: "hierophant", color: "purple", activated: true },
  { cardId: "world", color: "blue", activated: false },
  { cardId: "emperor", color: "red", activated: true },
  { cardId: "justice", color: "purple", activated: false }
];
it("enumerates the observed Star board and formats zero-hit fallback with scores", () => {
  const result = recommendCandidates({ state: { turn: 5, selected: board }, candidates: [
    { cardId: "sun", color: "blue" }, { cardId: "judgement", color: "purple" }, { cardId: "star", color: "red" }
  ], objective: { kind: "threshold_probability", threshold: 1500 }, simulations: 1 });
  expect(result.ranked[0]!.candidate.cardId).toBe("star");
  expect(result.ranked.map(m => m.meanScore)).toEqual([expect.closeTo(670.931818, 5), 468, 433]);
  expect(result.ranked[0]).toMatchObject({ calculationMethod: "exact", simulations: 0, minScore: 476, maxScore: 877, thresholdProbability: 0 });
  expect(formatRecommendation(result)).toContain("預期 670.9 分");
  expect(formatRecommendation(result)).toContain("改採預期分數");
  for (const id of ["world", "justice"]) expect(calculateScore([...board.map(c => c.cardId === id ? { ...c, removed: true } : c), { cardId: "star", color: "red", activated: true }], () => 0.5).finalScore).toBe(840);
});
it("final rollout follows target probability even when the alternative has higher mean", () => {
  const cards: SelectedCard[] = ids.slice(0, 4).map(cardId => ({ cardId, color: "blue", activated: true }));
  const offers = [{ cardId: "strength" as const, color: "blue" as const }, { cardId: "tower" as const, color: "purple" as const }];
  const safe = finalTurnMetrics(cards, offers[0]!, 1400, DEFAULT_RULES);
  const risky = finalTurnMetrics(cards, offers[1]!, 1400, DEFAULT_RULES);
  expect(safe.meanScore).toBeGreaterThan(risky.meanScore);
  expect(safe.thresholdProbability).toBe(0);
  expect(risky.thresholdProbability).toBe(0.5);
  expect(chooseFutureOffer(cards, offers, DEFAULT_RULES, { kind: "threshold_probability", threshold: 1400 }).cardId).toBe("tower");
  expect(chooseFutureOffer(cards, offers, DEFAULT_RULES, { kind: "expected_score" }).cardId).toBe("strength");
});
it("does not count failed or removed cards toward any color bonus", () => {
  for (const color of ["blue", "purple", "red"] as const) {
    const score = calculateScore([{cardId: "fool", color, activated: true}, {cardId: "magician", color, activated: false}, {cardId: "emperor", color, activated: true, removed: true}], () => 0.5);
    expect(score.finalScore).toBe(95);
    expect(score.activeColorCounts[color]).toBe(1);
  }
});
