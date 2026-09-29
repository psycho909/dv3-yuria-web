export type CardColor = "blue" | "purple" | "red";
export type CardCategory = "score" | "multiplier" | "special";
export type CardId =
  | "fool" | "magician" | "high_priestess" | "empress" | "emperor" | "hierophant"
  | "lovers" | "chariot" | "hermit" | "hanged_man" | "devil"
  | "strength" | "wheel_of_fortune" | "justice" | "death" | "temperance" | "judgement"
  | "tower" | "star" | "moon" | "sun" | "world";

export type SpecialEffect =
  | { kind: "tower"; procMultiplier: number; fallbackMultiplier: number }
  | { kind: "removeOtherCard"; multiplier: number }
  | { kind: "failedCardScore"; baseScore: number; perFailedCard: number }
  | { kind: "activeCountMultiplier"; baseMultiplier: number; perActiveCard: number }
  | { kind: "highestActiveScore"; factor: number };

export interface CardDefinition {
  id: CardId;
  name: string;
  category: CardCategory;
  activationProbability: number;
  scoreValue?: number;
  failedScoreBonus?: number;
  multiplierValue?: number;
  fallbackMultiplierValue?: number;
  specialEffect?: SpecialEffect;
}

export interface OfferedCard { cardId: CardId; color: CardColor; }
export interface SelectedCard extends OfferedCard { activated: boolean; removed?: boolean; towerProc?: boolean; }
export interface GameState { turn: 1 | 2 | 3 | 4 | 5; selected: SelectedCard[]; }

export type Objective =
  | { kind: "threshold"; target: number }
  | { kind: "expected" }
  | { kind: "stability" };

export interface Rules {
  failureScore: number;
  sunCountsSelf: boolean;
  redRollMode: "integerPercent" | "continuous";
  futureColorModel: "independentUniform" | "oneEach";
  starRemovalPolicy: "uniformPresent" | "uniformActive";
}

export const RULES: Rules = {
  failureScore: 20,
  sunCountsSelf: true,
  redRollMode: "integerPercent",
  futureColorModel: "oneEach",
  starRemovalPolicy: "uniformPresent"
};

export const CARDS: Record<CardId, CardDefinition> = {
  fool: { id: "fool", name: "愚者", category: "score", activationProbability: 1, scoreValue: 75 },
  magician: { id: "magician", name: "魔術師", category: "score", activationProbability: .95, scoreValue: 80 },
  high_priestess: { id: "high_priestess", name: "女祭司", category: "score", activationProbability: .9, scoreValue: 85 },
  empress: { id: "empress", name: "女皇", category: "score", activationProbability: .85, scoreValue: 90 },
  emperor: { id: "emperor", name: "皇帝", category: "score", activationProbability: .8, scoreValue: 95 },
  hierophant: { id: "hierophant", name: "教皇", category: "score", activationProbability: .75, scoreValue: 100 },
  lovers: { id: "lovers", name: "戀人", category: "score", activationProbability: .7, scoreValue: 110 },
  chariot: { id: "chariot", name: "戰車", category: "score", activationProbability: .65, scoreValue: 120 },
  hermit: { id: "hermit", name: "隱者", category: "score", activationProbability: .6, scoreValue: 130 },
  hanged_man: { id: "hanged_man", name: "吊人", category: "score", activationProbability: .55, scoreValue: 140 },
  devil: { id: "devil", name: "惡魔", category: "score", activationProbability: .5, scoreValue: 150 },
  strength: { id: "strength", name: "力量", category: "multiplier", activationProbability: 1, multiplierValue: .8 },
  wheel_of_fortune: { id: "wheel_of_fortune", name: "命運之輪", category: "multiplier", activationProbability: .9, multiplierValue: .9 },
  justice: { id: "justice", name: "正義", category: "multiplier", activationProbability: .8, multiplierValue: 1 },
  death: { id: "death", name: "死亡", category: "multiplier", activationProbability: .7, multiplierValue: 1.1 },
  temperance: { id: "temperance", name: "節制", category: "multiplier", activationProbability: .6, multiplierValue: 1.2 },
  judgement: { id: "judgement", name: "審判", category: "multiplier", activationProbability: .5, multiplierValue: 1.5 },
  tower: { id: "tower", name: "高塔", category: "special", activationProbability: 1, multiplierValue: 2, fallbackMultiplierValue: .25, specialEffect: { kind: "tower", procMultiplier: 2, fallbackMultiplier: .25 } },
  star: { id: "star", name: "星星", category: "special", activationProbability: 1, multiplierValue: 2.4, specialEffect: { kind: "removeOtherCard", multiplier: 2.4 } },
  moon: { id: "moon", name: "月亮", category: "special", activationProbability: .8, scoreValue: 20, failedScoreBonus: 100, specialEffect: { kind: "failedCardScore", baseScore: 20, perFailedCard: 100 } },
  sun: { id: "sun", name: "太陽", category: "special", activationProbability: .5, multiplierValue: .4, specialEffect: { kind: "activeCountMultiplier", baseMultiplier: .4, perActiveCard: .4 } },
  world: { id: "world", name: "世界", category: "special", activationProbability: .5, specialEffect: { kind: "highestActiveScore", factor: 2 } }
};

export const REWARD_THRESHOLDS = [0, 200, 500, 900, 1400, 2000, 2700] as const;
export const CATEGORY_WEIGHTS = {
  early: { score: 10, multiplier: 10, special: 5 },
  final: { score: 5, multiplier: 10, special: 20 }
} as const;

const COLORS: CardColor[] = ["blue", "purple", "red"];
const BLUE: Record<number, number> = { 2: 40, 3: 80, 4: 160, 5: 250 };
const PURPLE: Record<number, number> = { 2: .4, 3: .8, 4: 1.5, 5: 2.4 };
const RED: Record<number, [number, number]> = { 2: [.1, .2], 3: [.2, .3], 4: [.4, .6], 5: [.6, .9] };
const integerRedRollCount = (redCount: number) => {
  const range = RED[redCount];
  return range ? Math.round((range[1] - range[0]) * 100) + 1 : 1;
};
const WEIGHTS = { early: { score: 10, multiplier: 10, special: 5 }, final: { score: 5, multiplier: 10, special: 20 } } as const;
type Rng = () => number;

export const colorLabel: Record<CardColor, string> = { blue: "藍", purple: "紫", red: "紅" };
export const colorClass: Record<CardColor, string> = { blue: "blue", purple: "purple", red: "red" };

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const randomInt = (rng: Rng, min: number, max: number) => Math.floor(rng() * (max - min + 1)) + min;
const pick = <T>(rng: Rng, items: T[]) => items[Math.min(items.length - 1, Math.floor(rng() * items.length))]!;

export interface ScoreBreakdown { sum: number; multiplier: number; redBonus: number; finalScore: number; activeColorCounts: Record<CardColor, number>; failedCount: number; }

export function calculateScore(cards: SelectedCard[], rng: Rng, rules: Rules = RULES): ScoreBreakdown {
  // One pass without temporary arrays (this is the hottest function in simulations). Multipliers are
  // added in the same order as before (active cards in order, then Tower, Star, Sun, purple tier), so
  // floating-point results are unchanged.
  const counts: Record<CardColor, number> = { blue: 0, purple: 0, red: 0 };
  let failedCount = 0;
  let activeCount = 0;
  let scoreSum = 0;
  let highestScore = 0;
  let hasScoreCard = false;
  let multiplierAdd = 0;
  let moon = false;
  let world = false;
  let star = false;
  let sun = false;
  let tower: SelectedCard | undefined;
  for (const card of cards) {
    if (card.removed) continue;
    if (!card.activated) { failedCount++; continue; }
    activeCount++;
    counts[card.color]++;
    const def = CARDS[card.cardId];
    if (def.category === "score" && def.scoreValue != null) {
      scoreSum += def.scoreValue;
      if (!hasScoreCard || def.scoreValue > highestScore) highestScore = def.scoreValue;
      hasScoreCard = true;
    }
    if (def.category === "multiplier" && def.multiplierValue != null) multiplierAdd += def.multiplierValue;
    if (card.cardId === "moon") moon = true;
    else if (card.cardId === "world") world = true;
    else if (card.cardId === "star") star = true;
    else if (card.cardId === "sun") sun = true;
    else if (card.cardId === "tower" && !tower) tower = card;
  }
  let sum = failedCount * rules.failureScore + scoreSum;
  sum += BLUE[counts.blue] ?? 0;
  if (moon && CARDS.moon.specialEffect?.kind === "failedCardScore") sum += CARDS.moon.specialEffect.baseScore + failedCount * CARDS.moon.specialEffect.perFailedCard;
  if (world && hasScoreCard && CARDS.world.specialEffect?.kind === "highestActiveScore") sum += highestScore * CARDS.world.specialEffect.factor;
  if (tower && CARDS.tower.specialEffect?.kind === "tower") multiplierAdd += tower.towerProc ? CARDS.tower.specialEffect.procMultiplier : CARDS.tower.specialEffect.fallbackMultiplier;
  if (star) multiplierAdd += CARDS.star.specialEffect?.kind === "removeOtherCard" ? CARDS.star.specialEffect.multiplier : 0;
  if (sun && CARDS.sun.specialEffect?.kind === "activeCountMultiplier") { const sunCount = activeCount - (rules.sunCountsSelf ? 0 : 1); multiplierAdd += CARDS.sun.specialEffect.baseMultiplier + Math.max(0, sunCount) * CARDS.sun.specialEffect.perActiveCard; }
  multiplierAdd += PURPLE[counts.purple] ?? 0;
  const range = RED[counts.red];
  const redBonus = range ? rules.redRollMode === "continuous" ? range[0] + rng() * (range[1] - range[0]) : randomInt(rng, Math.round(range[0] * 100), Math.round(range[1] * 100)) / 100 : 0;
  const multiplier = 1 + multiplierAdd;
  return { sum, multiplier, redBonus, finalScore: Math.floor(sum * multiplier * (1 + redBonus)), activeColorCounts: counts, failedCount };
}

function category(rng: Rng, turn: number): CardCategory {
  const weights = turn === 5 ? CATEGORY_WEIGHTS.final : CATEGORY_WEIGHTS.early;
  const roll = rng() * (weights.score + weights.multiplier + weights.special);
  if (roll <= weights.score) return "score";
  if (roll <= weights.score + weights.multiplier) return "multiplier";
  return "special";
}

const CARD_DEFINITIONS = Object.values(CARDS);
const CARDS_BY_CATEGORY: Record<CardCategory, CardDefinition[]> = {
  score: CARD_DEFINITIONS.filter(card => card.category === "score"),
  multiplier: CARD_DEFINITIONS.filter(card => card.category === "multiplier"),
  special: CARD_DEFINITIONS.filter(card => card.category === "special")
};

export function generateOffer(rng: Rng, selected: SelectedCard[], turn: number, rules: Rules = RULES): OfferedCard[] {
  const used = new Set(selected.map(c => c.cardId)); const offered = new Set<CardId>(); const result: OfferedCard[] = [];
  const colors = [...COLORS];
  if (rules.futureColorModel === "oneEach") for (let i = colors.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [colors[i], colors[j]] = [colors[j]!, colors[i]!]; }
  for (let i = 0; i < 3; i++) { const color = rules.futureColorModel === "oneEach" ? colors[i]! : pick(rng, COLORS); let pool: CardDefinition[] = []; for (let attempt = 0; attempt < 20; attempt++) { const kind = category(rng, turn); pool = CARDS_BY_CATEGORY[kind].filter(c => !used.has(c.id) && !offered.has(c.id)); if (pool.length) break; } if (!pool.length) pool = CARD_DEFINITIONS.filter(c => !used.has(c.id) && !offered.has(c.id)); const card = pick(rng, pool); offered.add(card.id); result.push({ cardId: card.id, color }); }
  return result;
}

function starTargets(cards: SelectedCard[], rules: Rules): number[] { return cards.flatMap((card, i) => card.cardId !== "star" && !card.removed && (rules.starRemovalPolicy === "uniformPresent" || card.activated) ? [i] : []); }
export function resolveSelection(rng: Rng, selected: SelectedCard[], offered: OfferedCard, rules: Rules = RULES): SelectedCard[] { const next = selected.map(c => ({ ...c })); const active = rng() < CARDS[offered.cardId].activationProbability; const card: SelectedCard = { ...offered, activated: active }; if (active && offered.cardId === "tower") card.towerProc = rng() < .5; next.push(card); if (next.length === 5 && next.some(c => c.cardId === "star" && c.activated) && !next.some(c => c.removed)) { const targets = starTargets(next, rules); if (targets.length) { const i = pick(rng, targets); next[i] = { ...next[i]!, removed: true }; } } return next; }

function mean(values: number[]) { return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length); }
function percentile(values: number[], q: number) { return values[Math.min(values.length - 1, Math.floor((values.length - 1) * q))]!; }
/** Expected value of taking `offer`, averaging activation, the Tower proc, and Star targets over `evaluate`. */
function offerValue(selected: SelectedCard[], offer: OfferedCard, rules: Rules, evaluate: (cards: SelectedCard[]) => number): number {
  const def = CARDS[offer.cardId];
  const active = [...selected, { ...offer, activated: true }];
  let activeScore = evaluate(active);
  if (offer.cardId === "tower") {
    activeScore = (evaluate([...selected, { ...offer, activated: true, towerProc: false }]) + evaluate([...selected, { ...offer, activated: true, towerProc: true }])) / 2;
  } else if (offer.cardId === "star") {
    const targets = starTargets(selected, rules);
    if (targets.length) activeScore = mean(targets.map(target => evaluate(active.map((card, index) => index === target ? { ...card, removed: true } : card))));
  }
  const failureScore = evaluate([...selected, { ...offer, activated: false }]);
  return def.activationProbability * activeScore + (1 - def.activationProbability) * failureScore;
}
/** Production rollout value: the score right after taking the card, with the red roll at its midpoint. */
function immediate(selected: SelectedCard[], offer: OfferedCard, rules: Rules): number {
  return offerValue(selected, offer, rules, cards => calculateScore(cards, () => .5, rules).finalScore);
}

// Experimental "projected" rollout: representative future picks (a mid score card and a mid multiplier
// card in each color). Only their relative gains matter; they are not a prediction of the card pool.
const PROJECTION_PICKS: OfferedCard[] = COLORS.flatMap(color => [{ cardId: "emperor" as const, color }, { cardId: "justice" as const, color }]);
/** Current score plus `remaining` copies of the best expected gain one more pick could add from here. */
function projectedValue(cards: SelectedCard[], remaining: number, rules: Rules): number {
  const score = (list: SelectedCard[]) => calculateScore(list, () => .5, rules).finalScore;
  const base = score(cards);
  if (remaining <= 0) return base;
  let bestGain = 0;
  for (const pick of PROJECTION_PICKS) {
    const probability = CARDS[pick.cardId].activationProbability;
    const gain = probability * score([...cards, { ...pick, activated: true }]) + (1 - probability) * score([...cards, { ...pick, activated: false }]) - base;
    if (gain > bestGain) bestGain = gain;
  }
  return base + remaining * bestGain;
}
function projected(selected: SelectedCard[], offer: OfferedCard, rules: Rules): number {
  const remaining = 4 - selected.length; // picks still to come after this one
  return offerValue(selected, offer, rules, cards => projectedValue(cards, remaining, rules));
}

function chooseEarly(selected: SelectedCard[], offers: OfferedCard[], rules: Rules, policy: RolloutPolicy): OfferedCard {
  const value = policy === "projected" ? (offer: OfferedCard) => projected(selected, offer, rules) : (offer: OfferedCard) => immediate(selected, offer, rules);
  let best = offers[0]!;
  let bestScore = value(best);
  for (let i = 1; i < offers.length; i++) {
    const score = value(offers[i]!);
    if (score > bestScore) { best = offers[i]!; bestScore = score; }
  }
  return best;
}
/** Picks the rollout's fifth card by exact distributions; ties keep the earlier offer. */
function chooseFinal(selected: SelectedCard[], offers: OfferedCard[], rules: Rules, objective: Objective, target: number, fallback: ZeroTargetFallback): OfferedCard {
  if (fallback === "expected" && objective.kind !== "stability") {
    // Fast path: only the mean and target rate decide, so no distribution is built.
    let best = offers[0]!;
    let bestStats = finalTurnStats(selected, best, target, rules);
    for (let i = 1; i < offers.length; i++) {
      const stats = finalTurnStats(selected, offers[i]!, target, rules);
      const better = objective.kind === "expected" ? stats.meanScore > bestStats.meanScore
        : stats.thresholdProbability > bestStats.thresholdProbability || (stats.thresholdProbability === bestStats.thresholdProbability && stats.meanScore > bestStats.meanScore);
      if (better) { best = offers[i]!; bestStats = stats; }
    }
    return best;
  }
  const items = offers.map(offer => {
    const outcomes = finalTurnOutcomes(selected, offer, rules);
    return { metrics: outcomeMetrics(offer, outcomes, target, 0, "exact"), outcomes };
  });
  return rankEvaluated(items, objective, fallback).ordered[0]!.metrics.candidate;
}

interface RolloutStreams { offer: Rng; activation: Rng; red: Rng }
// Per-simulation seeds so every candidate faces the same random future (common random numbers).
const streamSeed = (seed: number, simulation: number, stream: number) =>
  (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(simulation + 1, 0xc2b2ae35) ^ Math.imul(stream, 0x27d4eb2f)) >>> 0;

/**
 * One rollout. With `mixture`, the chosen fifth card's exact distribution is added there (total weight 1)
 * and null is returned; otherwise the fifth card is sampled and one final score is returned.
 */
function simulateOne(streams: RolloutStreams, state: GameState, candidate: OfferedCard, rules: Rules, finalObjective: Objective, target: number, engine: Required<RecommendOptions>, mixture: Map<number, number> | null): number | null {
  let selected = resolveSelection(streams.activation, state.selected, candidate, rules);
  for (let turn = state.turn + 1; turn <= 5; turn++) {
    const offers = generateOffer(streams.offer, selected, turn, rules);
    if (selected.length === 4 && rules.redRollMode === "integerPercent") {
      const chosen = chooseFinal(selected, offers, rules, finalObjective, target, engine.zeroTargetFallback);
      if (mixture) {
        forEachFinalOutcome(selected, chosen, rules, (score, probability) => mixture.set(score, (mixture.get(score) ?? 0) + probability));
        return null;
      }
      selected = resolveSelection(streams.activation, selected, chosen, rules);
    } else {
      selected = resolveSelection(streams.activation, selected, chooseEarly(selected, offers, rules, engine.rolloutPolicy), rules);
    }
  }
  return calculateScore(selected, streams.red, rules).finalScore;
}

type Outcomes = Array<[score: number, probability: number]>;

/** Exact final-score distribution when `candidate` is the fifth card, under integer red rolls; sorted by score. */
function finalTurnOutcomes(selected: SelectedCard[], candidate: OfferedCard, rules: Rules): Outcomes {
  const mass = new Map<number, number>();
  forEachFinalOutcome(selected, candidate, rules, (score, probability) => mass.set(score, (mass.get(score) ?? 0) + probability));
  return [...mass].sort((a, b) => a[0] - b[0]);
}

/** Exact mean and target rate for `candidate` as the fifth card, without building the distribution. */
function finalTurnStats(selected: SelectedCard[], candidate: OfferedCard, target: number, rules: Rules): { meanScore: number; thresholdProbability: number } {
  let total = 0;
  let weighted = 0;
  let hit = 0;
  forEachFinalOutcome(selected, candidate, rules, (score, probability) => { total += probability; weighted += score * probability; if (score >= target) hit += probability; });
  return { meanScore: weighted / total, thresholdProbability: hit / total };
}

/** Visits every exact final outcome (not merged by score) when `candidate` is the fifth card, under integer red rolls. */
function forEachFinalOutcome(selected: SelectedCard[], candidate: OfferedCard, rules: Rules, visit: (score: number, probability: number) => void): void {
  const activation = CARDS[candidate.cardId].activationProbability;
  const branches: { cards: SelectedCard[]; probability: number }[] = [];
  const addBranch = (cards: SelectedCard[], probability: number) => {
    const targets = cards.some(card => card.cardId === "star" && card.activated) && !cards.some(card => card.removed) ? starTargets(cards, rules) : [];
    if (!targets.length) branches.push({ cards, probability });
    else for (const target of targets) branches.push({ cards: cards.map((card, index) => index === target ? { ...card, removed: true } : card), probability: probability / targets.length });
  };
  if (activation < 1) addBranch([...selected, { ...candidate, activated: false }], 1 - activation);
  if (activation > 0) {
    if (candidate.cardId === "tower") {
      addBranch([...selected, { ...candidate, activated: true, towerProc: false }], activation / 2);
      addBranch([...selected, { ...candidate, activated: true, towerProc: true }], activation / 2);
    } else {
      addBranch([...selected, { ...candidate, activated: true }], activation);
    }
  }

  for (const branch of branches) {
    // The red roll is the only random part of the final score for this branch.
    // Keep the exact integer-percent enumeration, but derive its fixed SUM and
    // multiplier once instead of rescanning the cards for every possible roll.
    const fixed = calculateScore(branch.cards, () => 0, rules);
    const redCount = fixed.activeColorCounts.red;
    const rolls = integerRedRollCount(redCount);
    const redStart = RED[redCount] ? Math.round(RED[redCount]![0] * 100) : 0;
    for (let i = 0; i < rolls; i++) {
      const redBonus = redCount >= 2 ? (redStart + i) / 100 : 0;
      visit(Math.floor(fixed.sum * fixed.multiplier * (1 + redBonus)), branch.probability / rolls);
    }
  }
}

function outcomeMetrics(candidate: OfferedCard, outcomes: Outcomes, threshold: number, simulations: number, method: Metrics["method"]): Metrics {
  const total = outcomes.reduce((sum, [, weight]) => sum + weight, 0);
  const meanScore = outcomes.reduce((sum, [score, weight]) => sum + score * weight, 0) / total;
  const quantile = (q: number) => { let cumulative = 0; for (const [score, weight] of outcomes) { cumulative += weight / total; if (cumulative + 1e-12 >= q) return score; } return outcomes.at(-1)![0]; };
  return {
    candidate, meanScore, p10: quantile(.1), p50: quantile(.5), p90: quantile(.9), threshold,
    thresholdProbability: outcomes.reduce((sum, [score, weight]) => sum + (score >= threshold ? weight : 0), 0) / total,
    minScore: outcomes[0]![0], maxScore: outcomes.at(-1)![0],
    standardDeviation: Math.sqrt(outcomes.reduce((sum, [score, weight]) => sum + (score - meanScore) ** 2 * weight, 0) / total),
    simulations, method
  };
}

export interface Metrics { candidate: OfferedCard; meanScore: number; p10: number; p50: number; p90: number; threshold: number; thresholdProbability: number; minScore: number; maxScore: number; standardDeviation: number; simulations: number; method: "exact" | "monte_carlo"; }

/** Engine switches. Defaults are the production engine; LEGACY_V1_OPTIONS replays the 2026-09-28 engine for paired comparisons. */
export interface RecommendOptions {
  /** Inside rollouts, use the exact fifth-card distribution instead of sampling its activation and red roll. */
  exactFinalStep?: boolean;
  /** Every candidate uses the same per-simulation offer, activation, and red streams. */
  commonRandomNumbers?: boolean;
  /** How a rollout picks its fifth card: by the screen objective, or always by target rate (legacy). */
  finalChoice?: "objective" | "threshold";
  /** Ranking when every option has a zero target rate. Only "expected" is wired to the UI. */
  zeroTargetFallback?: "expected" | "upperTail" | "rewardTier";
  /** Rollout policy before the fifth card. "projected" is experimental. */
  rolloutPolicy?: "immediate" | "projected";
}
type ZeroTargetFallback = NonNullable<RecommendOptions["zeroTargetFallback"]>;
type RolloutPolicy = NonNullable<RecommendOptions["rolloutPolicy"]>;
export type RecommendMode = "objective" | "highest_expected_score_fallback" | "zero_target_fallback";
export const LEGACY_V1_OPTIONS: Readonly<RecommendOptions> = { exactFinalStep: false, commonRandomNumbers: false, finalChoice: "threshold" };
const DEFAULT_OPTIONS: Required<RecommendOptions> = { exactFinalStep: true, commonRandomNumbers: true, finalChoice: "objective", zeroTargetFallback: "expected", rolloutPolicy: "immediate" };

type Evaluated = { metrics: Metrics; outcomes: Outcomes };
function reachProbability(outcomes: Outcomes, level: number) {
  let total = 0;
  let hit = 0;
  for (const [score, weight] of outcomes) { total += weight; if (score >= level) hit += weight; }
  return total ? hit / total : 0;
}
const compareKeys = (x: number[], y: number[]) => { for (let i = 0; i < x.length; i++) { const difference = x[i]! - y[i]!; if (difference) return difference; } return 0; };
/** Orders options by the objective (stable for ties) and reports whether the zero-target fallback applied. */
function rankEvaluated(items: Evaluated[], objective: Objective, fallback: ZeroTargetFallback): { ordered: Evaluated[]; zeroTarget: boolean } {
  const zeroTarget = objective.kind === "threshold" && items.every(item => item.metrics.thresholdProbability === 0);
  let key = (item: Evaluated): number[] => objective.kind === "expected" ? [item.metrics.meanScore]
    : objective.kind === "stability" ? [item.metrics.p10, item.metrics.meanScore]
    : [item.metrics.thresholdProbability, item.metrics.meanScore];
  if (zeroTarget && fallback === "upperTail") key = item => [item.metrics.p90, item.metrics.meanScore];
  if (zeroTarget && fallback === "rewardTier") {
    // Aim for the highest reward tier below the target that any option can still reach.
    const target = items[0]?.metrics.threshold ?? 0;
    const level = [...REWARD_THRESHOLDS].reverse().find(tier => tier < target && items.some(item => reachProbability(item.outcomes, tier) > 0)) ?? 0;
    key = item => [reachProbability(item.outcomes, level), item.metrics.meanScore];
  }
  const keyed = items.map(item => ({ item, key: key(item) }));
  keyed.sort((a, b) => compareKeys(b.key, a.key));
  return { ordered: keyed.map(entry => entry.item), zeroTarget };
}
function countOutcomes(sortedScores: number[]): Outcomes {
  const outcomes: Outcomes = [];
  for (const score of sortedScores) {
    const last = outcomes.at(-1);
    if (last && last[0] === score) last[1]++;
    else outcomes.push([score, 1]);
  }
  return outcomes;
}

export function recommend(state: GameState, candidates: OfferedCard[], objective: Objective, simulations = 10000, seed = 20260922, rules: Rules = RULES, fallbackTarget = 1500, options: RecommendOptions = {}): { ranked: Metrics[]; mode: RecommendMode } {
  const engine: Required<RecommendOptions> = { ...DEFAULT_OPTIONS, ...options };
  const target = objective.kind === "threshold" ? objective.target : fallbackTarget;
  const finalObjective: Objective = engine.finalChoice === "objective" ? objective : { kind: "threshold", target };
  const evaluated = candidates.map((candidate): Evaluated => {
    if (state.turn === 5 && rules.redRollMode === "integerPercent") {
      const outcomes = finalTurnOutcomes(state.selected, candidate, rules);
      return { metrics: outcomeMetrics(candidate, outcomes, target, 0, "exact"), outcomes };
    }
    const cardKey = Object.keys(CARDS).indexOf(candidate.cardId) * COLORS.length + COLORS.indexOf(candidate.color);
    const shared = engine.commonRandomNumbers ? null : mulberry32(seed + cardKey * 100003);
    const scores: number[] = [];
    const mixture = engine.exactFinalStep && rules.redRollMode === "integerPercent" ? new Map<number, number>() : null;
    for (let i = 0; i < simulations; i++) {
      const streams: RolloutStreams = shared ? { offer: shared, activation: shared, red: shared }
        : { offer: mulberry32(streamSeed(seed, i, 1)), activation: mulberry32(streamSeed(seed, i, 2)), red: mulberry32(streamSeed(seed, i, 3)) };
      const result = simulateOne(streams, state, candidate, rules, finalObjective, target, engine, mixture);
      if (result !== null) scores.push(result);
    }
    if (mixture?.size) {
      // Each rollout contributes its exact remaining distribution (weight 1 in total).
      const outcomes: Outcomes = [...mixture].sort((a, b) => a[0] - b[0]);
      return { metrics: outcomeMetrics(candidate, outcomes, target, simulations, "monte_carlo"), outcomes };
    }
    scores.sort((a, b) => a - b); const avg = mean(scores); const hit = scores.filter(s => s >= target).length / simulations;
    const metrics: Metrics = { candidate, meanScore: avg, p10: percentile(scores, .1), p50: percentile(scores, .5), p90: percentile(scores, .9), threshold: target, thresholdProbability: hit, minScore: scores[0]!, maxScore: scores.at(-1)!, standardDeviation: Math.sqrt(mean(scores.map(s => (s - avg) ** 2))), simulations, method: "monte_carlo" };
    return { metrics, outcomes: countOutcomes(scores) };
  });
  const { ordered, zeroTarget } = rankEvaluated(evaluated, objective, engine.zeroTargetFallback);
  const mode: RecommendMode = !zeroTarget ? "objective" : engine.zeroTargetFallback === "expected" ? "highest_expected_score_fallback" : "zero_target_fallback";
  return { ranked: ordered.map(item => item.metrics), mode };
}

export interface ScoreSummary {
  meanScore: number;
  p10: number;
  p50: number;
  p90: number;
  minScore: number;
  maxScore: number;
  method: "exact" | "sampled";
}

export function summarizeScore(cards: SelectedCard[], rules: Rules = RULES): ScoreSummary {
  const colorCounts = calculateScore(cards, () => .5, rules).activeColorCounts;
  const exact = rules.redRollMode === "integerPercent";
  const rolls = exact ? integerRedRollCount(colorCounts.red) : 101;
  const scores = Array.from({ length: rolls }, (_, index) => calculateScore(cards, () => (index + .5) / rolls, rules).finalScore).sort((a, b) => a - b);
  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const at = (q: number) => scores[Math.min(scores.length - 1, Math.floor((scores.length - 1) * q))]!;
  return { meanScore: average, p10: at(.1), p50: at(.5), p90: at(.9), minScore: scores[0]!, maxScore: scores.at(-1)!, method: exact ? "exact" : "sampled" };
}
