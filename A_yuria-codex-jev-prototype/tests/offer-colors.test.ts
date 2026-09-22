import { describe, expect, it } from "vitest";
import { generateOffer, recommendCandidates } from "../src/domain/simulation.js";
import { DEFAULT_RULES } from "../src/domain/scoring.js";

describe("explicit future-color assumptions", () => {
  it("can generate repeated colors without repeating card identities", () => {
    const offer = generateOffer(() => 0.5, [], 3);
    expect(offer.map(card => card.color)).toEqual(["purple", "purple", "purple"]);
    expect(new Set(offer.map(card => card.cardId)).size).toBe(3);
  });

  it("keeps the former one-of-each-color assumption as an explicit comparison mode", () => {
    const offer = generateOffer(() => 0.5, [], 3, { ...DEFAULT_RULES, futureColorModel: "oneEach" });
    expect(offer.map(card => card.color)).toEqual(["blue", "purple", "red"]);
  });

  it("preserves two same-colored current candidates and their exact final-turn scores", () => {
    const result = recommendCandidates({
      state: { turn: 5, selected: [
        { cardId: "chariot", color: "blue", activated: false },
        { cardId: "sun", color: "blue", activated: false },
        { cardId: "devil", color: "red", activated: false },
        { cardId: "hierophant", color: "red", activated: false }
      ] }, candidates: [
        { cardId: "strength", color: "purple" },
        { cardId: "fool", color: "purple" }
      ], simulations: 10
    });
    expect(result.ranked.map(card => card.candidate.color)).toEqual(["purple", "purple"]);
    expect(result.ranked.find(card => card.candidate.cardId === "strength")?.meanScore).toBe(144);
    expect(result.ranked.find(card => card.candidate.cardId === "fool")?.meanScore).toBe(155);
  });
});
