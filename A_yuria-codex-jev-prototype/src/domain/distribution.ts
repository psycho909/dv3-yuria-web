import { CARDS } from "./cards.js";
import { calculateScore, RED_RANGE } from "./scoring.js";
import type { CandidateMetrics, OfferedCard, RuleConfig, SelectedCard } from "./types.js";

// Exhaustive under the configured integer-percent and uniform-removal model.
export function finalTurnMetrics(selected: SelectedCard[], candidate: OfferedCard, threshold: number, rules: RuleConfig): CandidateMetrics {
  if (rules.redRollMode !== "integerPercent") throw new Error("Exact distribution requires integerPercent red rolls");
  const p = CARDS[candidate.cardId].activationProbability;
  const branches: { cards: SelectedCard[]; probability: number }[] = [];
  if (p < 1) branches.push({ cards: [...selected, { ...candidate, activated: false }], probability: 1 - p });
  const active: SelectedCard[] = [...selected, { ...candidate, activated: true }];
  if (p > 0) {
    if (candidate.cardId === "tower") {
      for (const towerProc of [false, true]) branches.push({ cards: [...selected, { ...candidate, activated: true, towerProc }], probability: p / 2 });
    } else if (candidate.cardId === "star") {
      const targets = selected.flatMap((c, i) => c.cardId !== "star" && !c.removed && (rules.starRemovalPolicy === "uniformPresent" || c.activated) ? [i] : []);
      if (!targets.length) branches.push({ cards: active, probability: p });
      for (const target of targets) branches.push({ cards: active.map((c, i) => i === target ? { ...c, removed: true } : c), probability: p / targets.length });
    } else branches.push({ cards: active, probability: p });
  }
  const mass = new Map<number, number>();
  for (const branch of branches) {
    const redCount = branch.cards.filter(c => c.activated && !c.removed && c.color === "red").length;
    const range = RED_RANGE[redCount];
    const rolls = range ? Math.round((range[1] - range[0]) * 100) + 1 : 1;
    for (let i = 0; i < rolls; i++) {
      const score = calculateScore(branch.cards, () => (i + 0.5) / rolls, rules).finalScore;
      mass.set(score, (mass.get(score) ?? 0) + branch.probability / rolls);
    }
  }
  const outcomes = [...mass].sort((a, b) => a[0] - b[0]);
  const total = outcomes.reduce((s, [, w]) => s + w, 0);
  const meanScore = outcomes.reduce((s, [v, w]) => s + v * w, 0) / total;
  const quantile = (q: number) => {
    let cumulative = 0;
    for (const [v, w] of outcomes) { cumulative += w / total; if (cumulative + 1e-12 >= q) return v; }
    return outcomes.at(-1)![0];
  };
  return {
    candidate, meanScore, p10: quantile(0.1), p50: quantile(0.5), p90: quantile(0.9),
    standardDeviation: Math.sqrt(outcomes.reduce((s, [v, w]) => s + (v - meanScore) ** 2 * w, 0) / total),
    threshold, thresholdProbability: outcomes.reduce((s, [v, w]) => s + (v >= threshold ? w : 0), 0) / total,
    simulations: 0, calculationMethod: "exact", minScore: outcomes[0]![0], maxScore: outcomes.at(-1)![0]
  };
}
