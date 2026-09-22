import { CARDS } from "../domain/cards.js";
import { recommendCandidates } from "../domain/simulation.js";
const state = {
    turn: 3,
    selected: [
        { cardId: "lovers", color: "blue", activated: true },
        { cardId: "strength", color: "purple", activated: true }
    ]
};
const candidates = [
    { cardId: "hermit", color: "blue" },
    { cardId: "justice", color: "purple" },
    { cardId: "devil", color: "red" }
];
const result = recommendCandidates({
    state,
    candidates,
    objective: { kind: "threshold_probability", threshold: 2700 },
    simulations: 4_000,
    seed: 20260922
});
for (const [index, metric] of result.ranked.entries()) {
    console.log(`${index + 1}. ${CARDS[metric.candidate.cardId].nameZh}: mean=${metric.meanScore.toFixed(1)}, Lv7=${(metric.thresholdProbability * 100).toFixed(2)}%`);
}
