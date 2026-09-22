import { CARDS } from "./cards.js";
import { randomIntInclusive, type Rng } from "./random.js";
import type { CardColor, RuleConfig, ScoreBreakdown, SelectedCard } from "./types.js";

export const DEFAULT_RULES: RuleConfig = {
  failureScore: 20,
  sunCountsSelf: true,
  redRollMode: "integerPercent",
  blessingMode: "disabled",
  futureOfferModel: "categoryWeight_uniformWithinCategory",
  futureColorModel: "independentUniform",
  starRemovalPolicy: "uniformPresent"
};

const BLUE_BONUS: Record<number, number> = { 2: 40, 3: 80, 4: 160, 5: 250 };
const PURPLE_BONUS: Record<number, number> = { 2: 0.4, 3: 0.8, 4: 1.5, 5: 2.4 };
export const RED_RANGE: Record<number, [number, number]> = {
  2: [0.10, 0.20],
  3: [0.20, 0.30],
  4: [0.40, 0.60],
  5: [0.60, 0.90]
};

function colorCounts(cards: SelectedCard[]): Record<CardColor, number> {
  const counts: Record<CardColor, number> = { blue: 0, purple: 0, red: 0 };
  for (const c of cards) {
    if (c.activated && !c.removed) counts[c.color] += 1;
  }
  return counts;
}

function rollRedBonus(rng: Rng, redCount: number, rules: RuleConfig): number {
  const range = RED_RANGE[redCount];
  if (!range) return 0;
  const [min, max] = range;
  if (rules.redRollMode === "continuous") return min + rng() * (max - min);
  return randomIntInclusive(rng, Math.round(min * 100), Math.round(max * 100)) / 100;
}

export function calculateScore(cards: SelectedCard[], rng: Rng, rules: RuleConfig = DEFAULT_RULES): ScoreBreakdown {
  const present = cards.filter((c) => !c.removed);
  const active = present.filter((c) => c.activated);
  const failed = present.filter((c) => !c.activated);
  const counts = colorCounts(present);

  let sum = failed.length * rules.failureScore;

  const activeScoreValues: number[] = [];
  for (const selected of active) {
    const def = CARDS[selected.cardId];
    if (def.category === "score" && def.scoreValue != null) {
      sum += def.scoreValue;
      activeScoreValues.push(def.scoreValue);
    }
  }

  sum += BLUE_BONUS[counts.blue] ?? 0;

  const moon = active.find((c) => c.cardId === "moon");
  if (moon) {
    const effect = CARDS[moon.cardId].specialEffect;
    if (effect?.kind === "failedCardScore") sum += effect.baseScore + failed.length * effect.perFailedCard;
  }

  const world = active.find((c) => c.cardId === "world");
  const worldEffect = world ? CARDS[world.cardId].specialEffect : undefined;
  if (world && worldEffect?.kind === "highestActiveScore" && activeScoreValues.length > 0) {
    sum += Math.max(...activeScoreValues) * worldEffect.factor;
  }

  let multiplierAdd = 0;
  for (const selected of active) {
    const def = CARDS[selected.cardId];
    if (def.category === "multiplier" && def.multiplierValue != null) {
      multiplierAdd += def.multiplierValue;
    }
  }

  const tower = active.find((c) => c.cardId === "tower");
  if (tower) {
    const effect = CARDS[tower.cardId].specialEffect;
    if (effect?.kind === "tower") multiplierAdd += tower.towerProc ? effect.procMultiplier : effect.fallbackMultiplier;
  }

  const star = active.find((c) => c.cardId === "star");
  const starEffect = star ? CARDS[star.cardId].specialEffect : undefined;
  if (starEffect?.kind === "removeOtherCard") multiplierAdd += starEffect.multiplier;

  const sun = active.find((c) => c.cardId === "sun");
  const sunEffect = sun ? CARDS[sun.cardId].specialEffect : undefined;
  if (sunEffect?.kind === "activeCountMultiplier") {
    const activeCount = active.length - (rules.sunCountsSelf ? 0 : 1);
    multiplierAdd += sunEffect.baseMultiplier + Math.max(0, activeCount) * sunEffect.perActiveCard;
  }

  multiplierAdd += PURPLE_BONUS[counts.purple] ?? 0;
  const multiplier = 1 + multiplierAdd;
  const redBonus = rollRedBonus(rng, counts.red, rules);
  const finalScore = Math.floor(sum * multiplier * (1 + redBonus));

  return {
    sum,
    multiplier,
    redBonus,
    finalScore,
    activeColorCounts: counts,
    failedCount: failed.length
  };
}
