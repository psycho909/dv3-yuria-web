import { describe, expect, it } from "vitest";
import { CARDS, RULES, calculateScore, type GameState, type OfferedCard, type SelectedCard } from "../src/domain";
import { evaluateCutoffActionsV21, recommendCandidatesV21, type V21Config } from "../src/recommendation-v21";
import { exactFinalDistribution, weightedMetrics } from "../src/recommendation-v2";

const config: V21Config = {
  scenarioCount: 8,
  pilotSamples: 16,
  searchDepth: 2,
  seed: 20260924,
  target: 1500,
  rules: RULES
};

function immediateExpectedScore(selected: SelectedCard[], candidate: OfferedCard): number {
  const probability = CARDS[candidate.cardId].activationProbability;
  const score = (activated: boolean) => calculateScore(
    [...selected, { ...candidate, activated }],
    () => .5,
    RULES
  ).finalScore;
  return probability * score(true) + (1 - probability) * score(false);
}

describe("experimental V2.1 correctness fixtures", () => {
  it("chooses the delayed-blue option over the better immediate option", () => {
    const state: GameState = {
      turn: 4,
      selected: [
        { cardId: "fool", color: "blue", activated: true },
        { cardId: "magician", color: "purple", activated: true },
        { cardId: "strength", color: "red", activated: true }
      ]
    };
    const immediateWinner: OfferedCard = { cardId: "high_priestess", color: "blue" };
    const delayedWinner: OfferedCard = { cardId: "empress", color: "red" };
    const offers = [immediateWinner, delayedWinner, { cardId: "judgement", color: "red" } satisfies OfferedCard];

    expect(immediateExpectedScore(state.selected, immediateWinner)).toBeGreaterThan(immediateExpectedScore(state.selected, delayedWinner));
    const results = recommendCandidatesV21(state, offers, { kind: "expected" }, { ...config, seed: 4 });
    expect(results[0]!.candidate.cardId).toBe("empress");
    expect(results[0]!.metrics.expectedScore).toBeGreaterThan(results.find(row => row.candidate.cardId === "high_priestess")!.metrics.expectedScore);

    const reversed = recommendCandidatesV21(state, [...offers].reverse(), { kind: "expected" }, { ...config, seed: 4 });
    expect(reversed.map(row => row.candidate.cardId)).toEqual(results.map(row => row.candidate.cardId));
    expect(Object.fromEntries(reversed.map(row => [row.candidate.cardId, row.metrics])))
      .toEqual(Object.fromEntries(results.map(row => [row.candidate.cardId, row.metrics])));
  });

  it("chooses the delayed-purple option over the better immediate option", () => {
    const state: GameState = {
      turn: 3,
      selected: [
        { cardId: "fool", color: "blue", activated: true },
        { cardId: "strength", color: "purple", activated: true }
      ]
    };
    const immediateWinner: OfferedCard = { cardId: "empress", color: "red" };
    const delayedWinner: OfferedCard = { cardId: "justice", color: "purple" };
    const offers = [immediateWinner, delayedWinner, { cardId: "moon", color: "red" } satisfies OfferedCard];

    expect(immediateExpectedScore(state.selected, immediateWinner)).toBeGreaterThan(immediateExpectedScore(state.selected, delayedWinner));
    const results = recommendCandidatesV21(state, offers, { kind: "expected" }, { ...config, seed: 3 });
    expect(results[0]!.candidate.cardId).toBe("justice");
    expect(results[0]!.metrics.expectedScore).toBeGreaterThan(results.find(row => row.candidate.cardId === "empress")!.metrics.expectedScore);
  });

  it("adds World synergy when an activated high-score card is present", () => {
    const world: OfferedCard = { cardId: "world", color: "purple" };
    const withHighScore: GameState = {
      turn: 3,
      selected: [
        { cardId: "devil", color: "red", activated: true },
        { cardId: "strength", color: "purple", activated: true }
      ]
    };
    const withoutScore: GameState = {
      turn: 3,
      selected: [
        { cardId: "strength", color: "purple", activated: true },
        { cardId: "justice", color: "blue", activated: true }
      ]
    };
    const withScoreValue = evaluateCutoffActionsV21(withHighScore, [world], config)[0]!;
    const withoutScoreValue = evaluateCutoffActionsV21(withoutScore, [world], config)[0]!;

    expect(withScoreValue.specialPotential).toBeCloseTo(330);
    expect(withScoreValue.specialPotential).toBeGreaterThan(withoutScoreValue.specialPotential);
  });

  it("matches the existing exact Round 5 distribution, including special-card branches", () => {
    const state: GameState = {
      turn: 5,
      selected: [
        { cardId: "fool", color: "blue", activated: true },
        { cardId: "magician", color: "purple", activated: true },
        { cardId: "strength", color: "red", activated: true },
        { cardId: "chariot", color: "blue", activated: false }
      ]
    };
    const offers: OfferedCard[] = [
      { cardId: "tower", color: "purple" },
      { cardId: "star", color: "red" },
      { cardId: "world", color: "blue" }
    ];
    const results = recommendCandidatesV21(state, offers, { kind: "expected" }, config);

    for (const result of results) {
      const expected = weightedMetrics(exactFinalDistribution(state.selected, result.candidate, RULES), config.target);
      expect(result.method).toBe("exact");
      expect(result.simulations).toBe(0);
      expect(result.metrics).toEqual(expected);
    }
  });

});
