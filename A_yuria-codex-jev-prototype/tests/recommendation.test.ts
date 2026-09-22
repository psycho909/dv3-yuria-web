import { describe, expect, it } from "vitest";
import { recommendCandidates } from "../src/domain/simulation.js";

describe("recommendation engine", () => {
  it("returns all candidates and deterministic results for the same seed", () => {
    const input = {
      state: {
        turn: 5 as const,
        selected: [
          { cardId: "fool" as const, color: "blue" as const, activated: true },
          { cardId: "strength" as const, color: "purple" as const, activated: true },
          { cardId: "lovers" as const, color: "blue" as const, activated: true },
          { cardId: "justice" as const, color: "red" as const, activated: true }
        ]
      },
      candidates: [
        { cardId: "hermit" as const, color: "blue" as const },
        { cardId: "judgement" as const, color: "purple" as const },
        { cardId: "devil" as const, color: "red" as const }
      ],
      simulations: 2_000,
      seed: 12345
    };

    const a = recommendCandidates(input);
    const b = recommendCandidates(input);
    expect(a.ranked).toHaveLength(3);
    expect(a.ranked.map((x) => x.meanScore)).toEqual(b.ranked.map((x) => x.meanScore));
    expect(a.ranked.every((x) => x.thresholdProbability >= 0 && x.thresholdProbability <= 1)).toBe(true);
  });
});
