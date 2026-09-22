import { describe, expect, it } from "vitest";
import { CARDS } from "../src/domain/cards.js";

describe("special-card effect registry", () => {
  it("records every known special effect as executable data", () => {
    expect(CARDS.tower.specialEffect).toEqual({ kind: "tower", procMultiplier: 2, fallbackMultiplier: 0.25 });
    expect(CARDS.star.specialEffect).toEqual({ kind: "removeOtherCard", multiplier: 2.4 });
    expect(CARDS.moon.specialEffect).toEqual({ kind: "failedCardScore", baseScore: 20, perFailedCard: 100 });
    expect(CARDS.sun.specialEffect).toEqual({ kind: "activeCountMultiplier", baseMultiplier: 0.4, perActiveCard: 0.4 });
    expect(CARDS.world.specialEffect).toEqual({ kind: "highestActiveScore", factor: 2 });
  });
});
