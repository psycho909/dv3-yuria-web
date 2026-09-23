// Bounded offline policy prototype; not connected to the production worker.
// This searches one future offer. The remaining turns use a deterministic
// immediate-score rollout policy. It is deliberately NOT full expectimax.
import {
  CARDS, RULES, calculateScore, generateOffer, mulberry32, resolveSelection,
  type GameState, type Objective, type OfferedCard, type Rules, type SelectedCard
} from "./domain";

export interface WeightedScore { score: number; weight: number }
export interface PrototypeMetrics {
  expectedScore: number; targetProbability: number; p10: number; p50: number;
  p90: number; cvar10: number; minScore: number; maxScore: number;
}
export interface PrototypeResult {
  candidate: OfferedCard; rank: number; metrics: PrototypeMetrics;
  distribution: WeightedScore[]; method: "exact" | "bounded-two-step";
  simulations: number; lookaheadDepth: 1 | 2;
  diagnostics: { rootScenarios: number; pilotSamplesPerAction: number; maxPilotRollouts: number; seed: number };
}
export interface PrototypeConfig { scenarioCount: number; pilotSamples: number; seed: number; target: number; rules?: Rules }

const hash = (...parts: number[]) => {
  let h = 0x811c9dc5;
  for (const p of parts) { h ^= p >>> 0; h = Math.imul(h, 0x01000193); h ^= h >>> 16; }
  return h >>> 0;
};
const stream = (seed: number, scenario: number, turn: number, event: number) => mulberry32(hash(seed, scenario, turn, event));
const key = (card: OfferedCard) => `${card.cardId}:${card.color}`;

export function weightedMetrics(distribution: readonly WeightedScore[], target: number): PrototypeMetrics {
  if (!distribution.length || distribution.some(x => !Number.isFinite(x.score) || !Number.isFinite(x.weight) || x.weight < 0)) throw new Error("Invalid distribution");
  const sorted = [...distribution].filter(x => x.weight > 0).sort((a, b) => a.score - b.score);
  const total = sorted.reduce((s, x) => s + x.weight, 0);
  if (!(total > 0)) throw new Error("Empty distribution");
  const quantile = (q: number) => {
    let cumulative = 0;
    for (const item of sorted) { cumulative += item.weight / total; if (cumulative + 1e-12 >= q) return item.score; }
    return sorted.at(-1)!.score;
  };
  let remaining = total * .1;
  let tailSum = 0;
  for (const item of sorted) { const take = Math.min(remaining, item.weight); tailSum += take * item.score; remaining -= take; if (remaining <= 1e-12) break; }
  return {
    expectedScore: sorted.reduce((s, x) => s + x.score * x.weight, 0) / total,
    targetProbability: sorted.reduce((s, x) => s + (x.score >= target ? x.weight : 0), 0) / total,
    p10: quantile(.1), p50: quantile(.5), p90: quantile(.9), cvar10: tailSum / (total * .1),
    minScore: sorted[0]!.score, maxScore: sorted.at(-1)!.score
  };
}

export function comparePrototype(a: PrototypeResult, b: PrototypeResult, objective: Objective): number {
  const x = a.metrics, y = b.metrics;
  const priorities = objective.kind === "expected"
    ? [y.expectedScore - x.expectedScore, y.targetProbability - x.targetProbability, y.cvar10 - x.cvar10]
    : objective.kind === "stability"
      ? [y.cvar10 - x.cvar10, y.p10 - x.p10, y.expectedScore - x.expectedScore]
      : [y.targetProbability - x.targetProbability, y.expectedScore - x.expectedScore, y.cvar10 - x.cvar10];
  return priorities.find(delta => Math.abs(delta) > 1e-10) ?? key(a.candidate).localeCompare(key(b.candidate));
}

// Match domain.ts's integer-percent red roll, including the red color tiers.
function terminalScores(cards: SelectedCard[], rules: Rules): WeightedScore[] {
  const fixed = calculateScore(cards, () => 0, rules);
  const red = fixed.activeColorCounts.red;
  const range = red === 2 ? [10, 20] : red === 3 ? [20, 30] : red === 4 ? [40, 60] : red === 5 ? [60, 90] : [0, 0];
  if (rules.redRollMode !== "integerPercent") throw new Error("Prototype exact branch requires integerPercent red rolls");
  const rolls = range[1]! - range[0]! + 1;
  return Array.from({ length: rolls }, (_, i) => ({
    score: Math.floor(fixed.sum * fixed.multiplier * (1 + (range[0]! + i) / 100)), weight: 1 / rolls
  }));
}

export function exactFinalDistribution(selected: SelectedCard[], offer: OfferedCard, rules: Rules = RULES): WeightedScore[] {
  const p = CARDS[offer.cardId].activationProbability;
  const branches: { cards: SelectedCard[]; weight: number }[] = [];
  if (p < 1) branches.push({ cards: [...selected, { ...offer, activated: false }], weight: 1 - p });
  if (p > 0) {
    if (offer.cardId === "tower") {
      for (const towerProc of [false, true]) branches.push({ cards: [...selected, { ...offer, activated: true, towerProc }], weight: p / 2 });
    } else if (offer.cardId === "star") {
      const targets = selected.flatMap((card, index) =>
        !card.removed && (rules.starRemovalPolicy === "uniformPresent" || card.activated) ? [index] : []);
      if (!targets.length) branches.push({ cards: [...selected, { ...offer, activated: true }], weight: p });
      for (const target of targets) branches.push({
        cards: [...selected.map((card, index) => index === target ? { ...card, removed: true } : card), { ...offer, activated: true }],
        weight: p / targets.length
      });
    } else branches.push({ cards: [...selected, { ...offer, activated: true }], weight: p });
  }
  const mass = new Map<number, number>();
  for (const branch of branches) for (const x of terminalScores(branch.cards, rules)) {
    mass.set(x.score, (mass.get(x.score) ?? 0) + branch.weight * x.weight);
  }
  return [...mass].map(([score, weight]) => ({ score, weight })).sort((a, b) => a.score - b.score);
}

// This tail follows V1's one-step expected-score estimate in rounds 1-4.
// It remains a rollout forecast beyond the searched future offer, not full V2.
function immediatePolicy(selected: SelectedCard[], offers: OfferedCard[], rules: Rules): OfferedCard {
  const estimate = (offer: OfferedCard) => {
    const p = CARDS[offer.cardId].activationProbability;
    const score = (cards: SelectedCard[]) => calculateScore(cards, () => .5, rules).finalScore;
    let success = score([...selected, { ...offer, activated: true }]);
    if (offer.cardId === "tower") {
      success = (score([...selected, { ...offer, activated: true, towerProc: false }]) +
        score([...selected, { ...offer, activated: true, towerProc: true }])) / 2;
    } else if (offer.cardId === "star") {
      const targets = selected.flatMap((card, index) =>
        !card.removed && (rules.starRemovalPolicy === "uniformPresent" || card.activated) ? [index] : []);
      if (targets.length) success = targets.reduce((sum, target) => sum + score([
        ...selected.map((card, index) => index === target ? { ...card, removed: true } : card),
        { ...offer, activated: true }
      ]), 0) / targets.length;
    }
    const failure = calculateScore([...selected, { ...offer, activated: false }], () => .5, rules).finalScore;
    return p * success + (1 - p) * failure;
  };
  return [...offers].sort((a, b) => estimate(b) - estimate(a) || key(a).localeCompare(key(b)))[0]!;
}
function completeGreedy(selected: SelectedCard[], fromTurn: number, seed: number, scenario: number, rules: Rules, objective: Objective, target: number): number {
  let cards = selected;
  for (let turn = fromTurn; turn <= 5; turn++) {
    const offers = generateOffer(stream(seed, scenario, turn, 1), cards, turn, rules);
    const chosen = turn === 5 ? [...offers].sort((a, b) => {
      const make = (candidate: OfferedCard): PrototypeResult => ({
        candidate, rank: 0, distribution: [], metrics: weightedMetrics(exactFinalDistribution(cards, candidate, rules), target),
        method: "exact", simulations: 0, lookaheadDepth: 1,
        diagnostics: { rootScenarios: 0, pilotSamplesPerAction: 0, maxPilotRollouts: 0, seed }
      });
      return comparePrototype(make(a), make(b), objective);
    })[0]! : immediatePolicy(cards, offers, rules);
    cards = resolveSelection(stream(seed, scenario, turn, 2), cards, chosen, rules);
  }
  return calculateScore(cards, stream(seed, scenario, 5, 3), rules).finalScore;
}
function pilotMetrics(selected: SelectedCard[], offer: OfferedCard, nextTurn: number, config: PrototypeConfig, scenario: number, objective: Objective): PrototypeMetrics {
  const rules = config.rules ?? RULES;
  const samples: WeightedScore[] = [];
  for (let pilot = 0; pilot < config.pilotSamples; pilot++) {
    const pilotCoordinate = hash(scenario, pilot, 0x50494c4f);
    const after = resolveSelection(stream(config.seed, pilotCoordinate, nextTurn, 12), selected, offer, rules);
    samples.push({ score: completeGreedy(after, nextTurn + 1, config.seed, pilotCoordinate, rules, objective, config.target), weight: 1 });
  }
  return weightedMetrics(samples, config.target);
}
function chooseFuture(selected: SelectedCard[], offers: OfferedCard[], nextTurn: number, objective: Objective, config: PrototypeConfig, scenario: number): OfferedCard {
  const target = objective.kind === "threshold" ? objective.target : config.target;
  const alternatives = offers.map(candidate => ({
    candidate, rank: 0,
    metrics: nextTurn === 5 ? weightedMetrics(exactFinalDistribution(selected, candidate, config.rules ?? RULES), target)
      : pilotMetrics(selected, candidate, nextTurn, { ...config, target }, scenario, objective),
    distribution: [], method: nextTurn === 5 ? "exact" as const : "bounded-two-step" as const,
    simulations: nextTurn === 5 ? 0 : config.pilotSamples,
    lookaheadDepth: 2 as const,
    diagnostics: { rootScenarios: config.scenarioCount, pilotSamplesPerAction: config.pilotSamples, maxPilotRollouts: 0, seed: config.seed }
  }));
  return alternatives.sort((a, b) => comparePrototype(a, b, objective))[0]!.candidate;
}

export function recommendCandidatesPrototype(state: GameState, candidates: readonly OfferedCard[], objective: Objective, config: PrototypeConfig): PrototypeResult[] {
  if (candidates.length !== 3 || new Set(candidates.map(c => c.cardId)).size !== 3) throw new Error("Exactly three distinct candidates required");
  if (candidates.some(c => state.selected.some(s => s.cardId === c.cardId))) throw new Error("Candidate was already selected");
  if (!Number.isInteger(config.scenarioCount) || config.scenarioCount < 1 || config.scenarioCount > 256 ||
      !Number.isInteger(config.pilotSamples) || config.pilotSamples < 1 || config.pilotSamples > 32) throw new Error("Out-of-budget prototype config");
  const rules = config.rules ?? RULES;
  const target = objective.kind === "threshold" ? objective.target : config.target;
  const exact = state.turn === 5;
  const results = candidates.map(candidate => {
    const distribution = exact ? exactFinalDistribution(state.selected, candidate, rules) :
      Array.from({ length: config.scenarioCount }, (_, scenario) => {
        const after = resolveSelection(stream(config.seed, scenario, state.turn, 2), state.selected, candidate, rules);
        const nextTurn = state.turn + 1;
        const offers = generateOffer(stream(config.seed, scenario, nextTurn, 1), after, nextTurn, rules);
        // Pilot seeds are disjoint from holdout transition/offer/terminal seeds.
        const chosen = chooseFuture(after, offers, nextTurn, objective, config, scenario);
        const next = resolveSelection(stream(config.seed, scenario, nextTurn, 2), after, chosen, rules);
        return { score: completeGreedy(next, nextTurn + 1, config.seed, scenario, rules, objective, target), weight: 1 / config.scenarioCount };
      });
    return {
      candidate, rank: 0, metrics: weightedMetrics(distribution, target), distribution,
      method: exact ? "exact" as const : "bounded-two-step" as const,
      simulations: exact ? 0 : config.scenarioCount,
      lookaheadDepth: exact ? 1 as const : 2 as const,
      diagnostics: { rootScenarios: exact ? 0 : config.scenarioCount, pilotSamplesPerAction: exact ? 0 : config.pilotSamples,
        maxPilotRollouts: exact ? 0 : candidates.length * config.scenarioCount * 3 * config.pilotSamples, seed: config.seed }
    };
  });
  return results.sort((a, b) => comparePrototype(a, b, objective)).map((result, index) => ({ ...result, rank: index + 1 }));
}
