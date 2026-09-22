import { CARDS } from "./cards.js";
import { randomIntInclusive } from "./random.js";
export const DEFAULT_RULES = {
    failureScore: 20,
    sunCountsSelf: true,
    redRollMode: "integerPercent",
    blessingMode: "disabled",
    futureOfferModel: "categoryWeight_uniformWithinCategory"
};
const BLUE_BONUS = { 2: 40, 3: 80, 4: 160, 5: 250 };
const PURPLE_BONUS = { 2: 0.4, 3: 0.8, 4: 1.5, 5: 2.4 };
const RED_RANGE = {
    2: [0.10, 0.20],
    3: [0.20, 0.30],
    4: [0.40, 0.60],
    5: [0.60, 0.90]
};
function colorCounts(cards) {
    const counts = { blue: 0, purple: 0, red: 0 };
    for (const c of cards) {
        if (c.activated && !c.removed)
            counts[c.color] += 1;
    }
    return counts;
}
function rollRedBonus(rng, redCount, rules) {
    const range = RED_RANGE[redCount];
    if (!range)
        return 0;
    const [min, max] = range;
    if (rules.redRollMode === "continuous")
        return min + rng() * (max - min);
    return randomIntInclusive(rng, Math.round(min * 100), Math.round(max * 100)) / 100;
}
export function calculateScore(cards, rng, rules = DEFAULT_RULES) {
    const present = cards.filter((c) => !c.removed);
    const active = present.filter((c) => c.activated);
    const failed = present.filter((c) => !c.activated);
    const counts = colorCounts(present);
    let sum = failed.length * rules.failureScore;
    const activeScoreValues = [];
    for (const selected of active) {
        const def = CARDS[selected.cardId];
        if (def.category === "score" && def.scoreValue != null) {
            sum += def.scoreValue;
            activeScoreValues.push(def.scoreValue);
        }
    }
    sum += BLUE_BONUS[counts.blue] ?? 0;
    const moon = active.find((c) => c.cardId === "moon");
    if (moon)
        sum += 20 + failed.length * 80;
    const world = active.find((c) => c.cardId === "world");
    if (world && activeScoreValues.length > 0) {
        sum += Math.max(...activeScoreValues) * 2;
    }
    let multiplierAdd = 0;
    for (const selected of active) {
        const def = CARDS[selected.cardId];
        if (def.category === "multiplier" && def.multiplierValue != null) {
            multiplierAdd += def.multiplierValue;
        }
    }
    const tower = active.find((c) => c.cardId === "tower");
    if (tower?.towerProc)
        multiplierAdd += 2.0;
    if (active.some((c) => c.cardId === "star"))
        multiplierAdd += 2.5;
    const sun = active.find((c) => c.cardId === "sun");
    if (sun) {
        const activeCount = active.length - (rules.sunCountsSelf ? 0 : 1);
        multiplierAdd += 0.3 + Math.max(0, activeCount) * 0.4;
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
