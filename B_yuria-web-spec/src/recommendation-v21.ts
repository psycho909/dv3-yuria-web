// Experimental V2.1 planner. The production worker remains on V1.
import {
  CARDS, CATEGORY_WEIGHTS, RULES, calculateScore, generateOffer, mulberry32, resolveSelection,
  type CardColor, type GameState, type Objective, type OfferedCard, type Rules, type SelectedCard
} from "./domain";
import { exactFinalDistribution, weightedMetrics } from "./recommendation-v2";

export interface V21Config {
  scenarioCount: number;
  pilotSamples: number;
  searchDepth: number;
  seed: number;
  target: number;
  rules?: Rules;
}

export interface V21Evaluation {
  expectedScore: number;
  targetProbability: number;
  p10: number;
  p50: number;
  p90: number;
  cvar10: number;
  minScore: number;
  maxScore: number;
}

export interface V21Result {
  candidate: OfferedCard;
  rank: number;
  metrics: V21Evaluation;
  method: "exact" | "monte-carlo-v21";
  simulations: number;
  diagnostics: {
    scenarioCount: number;
    pilotSamples: number;
    searchDepth: number;
    seed: number;
    cutoffStates: number;
    roundFiveStates: number;
    cacheHits: number;
  };
}

export interface V21CutoffEstimate {
  baseExpectedScore: number;
  colorPotential: number;
  multiplierPotential: number;
  specialPotential: number;
  remainingRoundPotential: number;
  remainingSelections: number;
  value: number;
}

export interface V21ActionValue extends V21CutoffEstimate {
  candidate: OfferedCard;
}

interface ScoreParts {
  baseSum: number;
  multiplierAdd: number;
  colors: Record<CardColor, number>;
}

interface ValueParts {
  remainingRoundPotential: number;
  colorPotential: number;
  multiplierPotential: number;
  specialPotential: number;
}

interface PlannerContext {
  config: V21Config;
  rules: Rules;
  configKey: string;
  decisionCache: Map<string, number>;
  actionCache: Map<string, number>;
  actionPartsCache: Map<string, ValueParts>;
  cutoffCache: Map<string, V21CutoffEstimate>;
  roundFiveCache: Map<string, number>;
  exactCache: Map<string, number>;
  cutoffStates: number;
  roundFiveStates: number;
  cacheHits: number;
  profile: { actionPartsMs: number; exactMs: number; cutoffMs: number; roundFiveMs: number; actionMs: number };
}

const RULES_VERSION = "yuria-rules-20260922-a";
const CATALOG_VERSION = "major-arcana-22-v1";
const BLUE_BONUS: Record<number, number> = { 2: 40, 3: 80, 4: 160, 5: 250 };
const PURPLE_BONUS: Record<number, number> = { 2: .4, 3: .8, 4: 1.5, 5: 2.4 };
const RED_RANGE: Record<number, [number, number]> = {
  2: [10, 20], 3: [20, 30], 4: [40, 60], 5: [60, 90]
};

function hash(...parts: number[]): number {
  let value = 0x811c9dc5;
  for (const part of parts) {
    value ^= part >>> 0;
    value = Math.imul(value, 0x01000193);
    value ^= value >>> 16;
  }
  return value >>> 0;
}

function stream(seed: number, scenario: number, turn: number, event: number) {
  return mulberry32(hash(seed, scenario, turn, event));
}

function cardKey(card: OfferedCard): string { return `${card.cardId}:${card.color}`; }

function selectedKey(state: GameState): string {
  const cards = state.selected.map(card =>
    `${card.cardId}:${card.color}:${Number(card.activated)}:${Number(Boolean(card.removed))}:${card.towerProc === undefined ? "u" : Number(card.towerProc)}`
  ).join(",");
  return `${RULES_VERSION}/${CATALOG_VERSION}/${JSON.stringify(state.turn)}/${cards}`;
}

function makeContext(config: V21Config): PlannerContext {
  const rules = config.rules ?? RULES;
  const configKey = JSON.stringify({ ...config, rules, rulesVersion: RULES_VERSION, catalogVersion: CATALOG_VERSION });
  return {
    config, rules, configKey,
    decisionCache: new Map(), actionCache: new Map(), actionPartsCache: new Map(),
    cutoffCache: new Map(), roundFiveCache: new Map(), exactCache: new Map(),
    cutoffStates: 0, roundFiveStates: 0, cacheHits: 0,
    profile: { actionPartsMs: 0, exactMs: 0, cutoffMs: 0, roundFiveMs: 0, actionMs: 0 }
  };
}

function validateConfig(config: V21Config, objective?: Objective): void {
  if (!Number.isInteger(config.scenarioCount) || config.scenarioCount < 1 || config.scenarioCount > 256) {
    throw new Error("V2.1 scenarioCount must be an integer from 1 to 256");
  }
  if (![16, 32, 64].includes(config.pilotSamples)) {
    throw new Error("V2.1 pilotSamples must be 16, 32, or 64");
  }
  if (![1, 2].includes(config.searchDepth)) throw new Error("V2.1 searchDepth must be 1 or 2");
  if (!Number.isInteger(config.seed) || !Number.isFinite(config.target) || config.target < 0) {
    throw new Error("V2.1 requires an integer seed and a non-negative finite target");
  }
  if ((config.rules ?? RULES).redRollMode !== "integerPercent") {
    throw new Error("V2.1 exact terminal evaluation currently requires integerPercent red rolls");
  }
  if (objective && objective.kind !== "expected") {
    throw new Error("V2.1 supports Expected Score objective only");
  }
}

function scoreParts(cards: readonly SelectedCard[], rules: Rules): ScoreParts {
  const present = cards.filter(card => !card.removed);
  const active = present.filter(card => card.activated);
  const failed = present.filter(card => !card.activated);
  const colors: Record<CardColor, number> = { blue: 0, purple: 0, red: 0 };
  for (const card of active) colors[card.color]++;

  const scores = active.flatMap(card => {
    const def = CARDS[card.cardId];
    return def.category === "score" && def.scoreValue != null ? [def.scoreValue] : [];
  });
  let baseSum = failed.length * rules.failureScore + scores.reduce((sum, score) => sum + score, 0);
  const moon = active.find(card => card.cardId === "moon");
  if (moon && CARDS.moon.specialEffect?.kind === "failedCardScore") {
    baseSum += CARDS.moon.specialEffect.baseScore + failed.length * CARDS.moon.specialEffect.perFailedCard;
  }
  const world = active.find(card => card.cardId === "world");
  if (world && scores.length && CARDS.world.specialEffect?.kind === "highestActiveScore") {
    baseSum += Math.max(...scores) * CARDS.world.specialEffect.factor;
  }

  let multiplierAdd = active.reduce((sum, card) => {
    const def = CARDS[card.cardId];
    return sum + (def.category === "multiplier" ? def.multiplierValue ?? 0 : 0);
  }, 0);
  const tower = active.find(card => card.cardId === "tower");
  if (tower && CARDS.tower.specialEffect?.kind === "tower") {
    multiplierAdd += tower.towerProc ? CARDS.tower.specialEffect.procMultiplier : CARDS.tower.specialEffect.fallbackMultiplier;
  }
  if (active.some(card => card.cardId === "star") && CARDS.star.specialEffect?.kind === "removeOtherCard") {
    multiplierAdd += CARDS.star.specialEffect.multiplier;
  }
  const sun = active.find(card => card.cardId === "sun");
  if (sun && CARDS.sun.specialEffect?.kind === "activeCountMultiplier") {
    const count = active.length - (rules.sunCountsSelf ? 0 : 1);
    multiplierAdd += CARDS.sun.specialEffect.baseMultiplier + Math.max(0, count) * CARDS.sun.specialEffect.perActiveCard;
  }
  return { baseSum, multiplierAdd, colors };
}

function scoreFromParts(parts: ScoreParts, rules: Rules): number {
  const sum = parts.baseSum + (BLUE_BONUS[parts.colors.blue] ?? 0);
  const multiplierAdd = parts.multiplierAdd + (PURPLE_BONUS[parts.colors.purple] ?? 0);
  const multiplier = 1 + multiplierAdd;
  const range = RED_RANGE[parts.colors.red];
  if (!range) return Math.floor(sum * multiplier);
  let total = 0;
  const rollCount = range[1] - range[0] + 1;
  for (let bonus = range[0]; bonus <= range[1]; bonus++) {
    total += Math.floor(sum * multiplier * (1 + bonus / 100));
  }
  return total / rollCount;
}

export function expectedScoreForStateV21(cards: readonly SelectedCard[], rules: Rules = RULES): number {
  if (rules.redRollMode !== "integerPercent") throw new Error("V2.1 exact terminal evaluation requires integerPercent red rolls");
  return scoreFromParts(scoreParts(cards, rules), rules);
}

export function expectedFinalActionScoreV21(
  selected: readonly SelectedCard[],
  candidate: OfferedCard,
  rules: Rules = RULES
): number {
  if (rules.redRollMode !== "integerPercent") throw new Error("V2.1 exact terminal evaluation requires integerPercent red rolls");
  return selectionOutcomes(selected, candidate, rules).reduce(
    (sum, branch) => sum + branch.weight * scoreFromParts(scoreParts(branch.cards, rules), rules),
    0
  );
}

function selectionOutcomes(selected: readonly SelectedCard[], offer: OfferedCard, rules: Rules): Array<{ cards: SelectedCard[]; weight: number }> {
  const probability = CARDS[offer.cardId].activationProbability;
  const outcomes: Array<{ cards: SelectedCard[]; weight: number }> = [];
  if (probability < 1) outcomes.push({ cards: [...selected.map(card => ({ ...card })), { ...offer, activated: false }], weight: 1 - probability });
  if (probability > 0 && offer.cardId === "tower") {
    outcomes.push({ cards: [...selected.map(card => ({ ...card })), { ...offer, activated: true, towerProc: false }], weight: probability / 2 });
    outcomes.push({ cards: [...selected.map(card => ({ ...card })), { ...offer, activated: true, towerProc: true }], weight: probability / 2 });
  } else if (probability > 0 && offer.cardId === "star") {
    const targets = selected.flatMap((card, index) =>
      !card.removed && (rules.starRemovalPolicy === "uniformPresent" || card.activated) ? [index] : []);
    if (!targets.length) outcomes.push({ cards: [...selected.map(card => ({ ...card })), { ...offer, activated: true }], weight: probability });
    for (const target of targets) {
      outcomes.push({
        cards: [...selected.map((card, index) => index === target ? { ...card, removed: true } : { ...card }), { ...offer, activated: true }],
        weight: probability / targets.length
      });
    }
  } else if (probability > 0) {
    outcomes.push({ cards: [...selected.map(card => ({ ...card })), { ...offer, activated: true }], weight: probability });
  }
  return outcomes;
}

function exactActionValue(state: GameState, candidate: OfferedCard, ctx: PlannerContext): number {
  const cacheKey = `${ctx.configKey}|exact|${selectedKey(state)}|${cardKey(candidate)}`;
  const cached = ctx.exactCache.get(cacheKey);
  if (cached !== undefined) { ctx.cacheHits++; return cached; }
  const started = performance.now();
  const value = expectedFinalActionScoreV21(state.selected, candidate, ctx.rules);
  ctx.profile.exactMs += performance.now() - started;
  ctx.exactCache.set(cacheKey, value);
  return value;
}

function actionParts(state: GameState, candidate: OfferedCard, ctx: PlannerContext, includeRoundFiveTail: boolean): ValueParts {
  const key = `${ctx.configKey}|parts|${selectedKey(state)}|${cardKey(candidate)}|${Number(includeRoundFiveTail)}`;
  const cached = ctx.actionPartsCache.get(key);
  if (cached) { ctx.cacheHits++; return cached; }
  const started = performance.now();

  const before = scoreParts(state.selected, ctx.rules);
  const baseline = scoreFromParts(before, ctx.rules);
  const total: ValueParts = { remainingRoundPotential: 0, colorPotential: 0, multiplierPotential: 0, specialPotential: 0 };
  for (const branch of selectionOutcomes(state.selected, candidate, ctx.rules)) {
    const after = scoreParts(branch.cards, ctx.rules);
    const afterValue = scoreFromParts(after, ctx.rules);
    const colorOnlyValue = scoreFromParts({ ...before, colors: after.colors }, ctx.rules);
    const branchParts: ValueParts = {
      remainingRoundPotential: 0,
      colorPotential: colorOnlyValue - baseline,
      multiplierPotential: 0,
      specialPotential: 0
    };
    const activated = branch.cards.at(-1)!.activated;
    const def = CARDS[candidate.cardId];
    const directScore = activated
      ? def.category === "score" ? def.scoreValue ?? 0 : 0
      : ctx.rules.failureScore;
    if (directScore) {
      branchParts.remainingRoundPotential = scoreFromParts({ ...before, baseSum: before.baseSum + directScore }, ctx.rules) - baseline;
    }
    const directMultiplier = activated && def.category === "multiplier" ? def.multiplierValue ?? 0 : 0;
    if (directMultiplier) {
      branchParts.multiplierPotential = scoreFromParts({ ...before, multiplierAdd: before.multiplierAdd + directMultiplier }, ctx.rules) - baseline;
    }
    branchParts.specialPotential = afterValue - baseline - branchParts.colorPotential - branchParts.multiplierPotential - branchParts.remainingRoundPotential;

    if (includeRoundFiveTail && state.turn === 4 && branch.cards.length === 4) {
      const tailState: GameState = { turn: 5, selected: branch.cards };
      const tail = roundFiveContinuationValue(tailState, ctx) - afterValue;
      branchParts.remainingRoundPotential += tail;
    }
    total.remainingRoundPotential += branch.weight * branchParts.remainingRoundPotential;
    total.colorPotential += branch.weight * branchParts.colorPotential;
    total.multiplierPotential += branch.weight * branchParts.multiplierPotential;
    total.specialPotential += branch.weight * branchParts.specialPotential;
  }
  ctx.actionPartsCache.set(key, total);
  ctx.profile.actionPartsMs += performance.now() - started;
  return total;
}

function partsTotal(parts: ValueParts): number {
  return parts.remainingRoundPotential + parts.colorPotential + parts.multiplierPotential + parts.specialPotential;
}

function actionPotentialValue(state: GameState, candidate: OfferedCard, ctx: PlannerContext, includeRoundFiveTail: boolean): number {
  return scoreFromParts(scoreParts(state.selected, ctx.rules), ctx.rules) + partsTotal(actionParts(state, candidate, ctx, includeRoundFiveTail));
}

function roundFiveContinuationValue(state: GameState, ctx: PlannerContext): number {
  const key = `${ctx.configKey}|round5|${selectedKey(state)}`;
  const cached = ctx.roundFiveCache.get(key);
  if (cached !== undefined) { ctx.cacheHits++; return cached; }
  const started = performance.now();
  ctx.roundFiveStates++;
  let sum = 0;
  for (let sample = 0; sample < ctx.config.pilotSamples; sample++) {
    const offer = generateOffer(stream(ctx.config.seed, sample, 5, 0x21f5), state.selected, 5, ctx.rules);
    sum += Math.max(...offer.map(candidate => exactActionValue(state, candidate, ctx)));
  }
  const value = sum / ctx.config.pilotSamples;
  ctx.roundFiveCache.set(key, value);
  ctx.profile.roundFiveMs += performance.now() - started;
  return value;
}

function estimateStateInternal(state: GameState, ctx: PlannerContext): V21CutoffEstimate {
  const key = `${ctx.configKey}|cutoff|${selectedKey(state)}`;
  const cached = ctx.cutoffCache.get(key);
  if (cached) { ctx.cacheHits++; return cached; }
  const started = performance.now();
  ctx.cutoffStates++;
  const baseExpectedScore = scoreFromParts(scoreParts(state.selected, ctx.rules), ctx.rules);
  const sum: ValueParts = { remainingRoundPotential: 0, colorPotential: 0, multiplierPotential: 0, specialPotential: 0 };

  // The cutoff averages each remaining card category once, then evaluates the
  // category triples using the same early/final weights as generateOffer().
  // Future actions on searched nodes still use pilot samples; this avoids
  // nesting another pilot loop inside every leaf of the bounded search.
  const categories = ["score", "multiplier", "special"] as const;
  const used = new Set(state.selected.map(card => card.cardId));
  const categoryValues = new Map<(typeof categories)[number], ValueParts>();
  for (const category of categories) {
    const cards = Object.values(CARDS).filter(card => card.category === category && !used.has(card.id));
    const average: ValueParts = { remainingRoundPotential: 0, colorPotential: 0, multiplierPotential: 0, specialPotential: 0 };
    let count = 0;
    for (const card of cards) for (const color of ["blue", "purple", "red"] as const) {
      const parts = actionParts(state, { cardId: card.id, color }, ctx, false);
      average.remainingRoundPotential += parts.remainingRoundPotential;
      average.colorPotential += parts.colorPotential;
      average.multiplierPotential += parts.multiplierPotential;
      average.specialPotential += parts.specialPotential;
      count++;
    }
    if (count) {
      average.remainingRoundPotential /= count;
      average.colorPotential /= count;
      average.multiplierPotential /= count;
      average.specialPotential /= count;
      categoryValues.set(category, average);
    }
  }

  for (let turn = state.turn; turn <= 5; turn++) {
    const weights = turn === 5 ? CATEGORY_WEIGHTS.final : CATEGORY_WEIGHTS.early;
    const totalWeight = categories.reduce((total, category) => total + (categoryValues.has(category) ? weights[category] : 0), 0);
    if (!totalWeight) continue;
    const probability = (category: (typeof categories)[number]) => categoryValues.has(category) ? weights[category] / totalWeight : 0;
    for (const first of categories) for (const second of categories) for (const third of categories) {
      const offerProbability = probability(first) * probability(second) * probability(third);
      if (!offerProbability) continue;
      const offerValues = [categoryValues.get(first)!, categoryValues.get(second)!, categoryValues.get(third)!];
      const bestIndex = offerValues.reduce((best, value, index) =>
        partsTotal(value) > partsTotal(offerValues[best]!) ? index : best, 0);
      const chosen = offerValues[bestIndex]!;
      sum.remainingRoundPotential += offerProbability * chosen.remainingRoundPotential;
      sum.colorPotential += offerProbability * chosen.colorPotential;
      sum.multiplierPotential += offerProbability * chosen.multiplierPotential;
      sum.specialPotential += offerProbability * chosen.specialPotential;
    }
  }

  const estimate: V21CutoffEstimate = {
    baseExpectedScore,
    ...sum,
    remainingSelections: Math.max(0, 5 - state.selected.length),
    value: baseExpectedScore + partsTotal(sum)
  };
  ctx.cutoffCache.set(key, estimate);
  ctx.profile.cutoffMs += performance.now() - started;
  return estimate;
}

function actionValue(state: GameState, candidate: OfferedCard, depthRemaining: number, ctx: PlannerContext): number {
  const boundedDepth = Math.min(depthRemaining, 6 - state.turn);
  const key = `${ctx.configKey}|action|${selectedKey(state)}|${cardKey(candidate)}|${boundedDepth}`;
  const cached = ctx.actionCache.get(key);
  if (cached !== undefined) { ctx.cacheHits++; return cached; }
  const started = performance.now();

  if (state.turn === 5) {
    const value = exactActionValue(state, candidate, ctx);
    ctx.actionCache.set(key, value);
    return value;
  }

  let expected = 0;
  for (const branch of selectionOutcomes(state.selected, candidate, ctx.rules)) {
    const nextState: GameState = { turn: (state.turn + 1) as GameState["turn"], selected: branch.cards };
    let branchValue: number;
    if (nextState.turn === 5) {
      branchValue = roundFiveContinuationValue(nextState, ctx);
    } else if (boundedDepth > 1) {
      let pilotSum = 0;
      for (let sample = 0; sample < ctx.config.pilotSamples; sample++) {
        const futureOffers = generateOffer(stream(ctx.config.seed, sample, nextState.turn, 0x21d0 + boundedDepth), nextState.selected, nextState.turn, ctx.rules);
        pilotSum += chooseBestValue(nextState, futureOffers, boundedDepth - 1, ctx);
      }
      branchValue = pilotSum / ctx.config.pilotSamples;
    } else {
      branchValue = estimateStateInternal(nextState, ctx).value;
    }
    expected += branch.weight * branchValue;
  }
  ctx.actionCache.set(key, expected);
  ctx.profile.actionMs += performance.now() - started;
  return expected;
}

function chooseBestValue(state: GameState, offers: readonly OfferedCard[], depthRemaining: number, ctx: PlannerContext): number {
  const ordered = [...offers].sort((a, b) => cardKey(a).localeCompare(cardKey(b)));
  if (state.turn === 5) return Math.max(...ordered.map(candidate => exactActionValue(state, candidate, ctx)));
  if (!ordered.length) throw new Error("V2.1 requires a non-empty future offer");
  const key = `${ctx.configKey}|decision|${selectedKey(state)}|${ordered.map(cardKey).join(";")}|${Math.min(depthRemaining, 6 - state.turn)}`;
  const cached = ctx.decisionCache.get(key);
  if (cached !== undefined) { ctx.cacheHits++; return cached; }
  const value = Math.max(...ordered.map(candidate => actionValue(state, candidate, depthRemaining, ctx)));
  ctx.decisionCache.set(key, value);
  return value;
}

function chooseBestAction(state: GameState, offers: readonly OfferedCard[], depthRemaining: number, ctx: PlannerContext): OfferedCard {
  if (state.turn === 5) {
    return [...offers].sort((a, b) => exactActionValue(state, b, ctx) - exactActionValue(state, a, ctx) || cardKey(a).localeCompare(cardKey(b)))[0]!;
  }
  return [...offers].sort((a, b) => actionValue(state, b, depthRemaining, ctx) - actionValue(state, a, depthRemaining, ctx) || cardKey(a).localeCompare(cardKey(b)))[0]!;
}

function simulateRootCandidate(state: GameState, candidate: OfferedCard, ctx: PlannerContext, scenario: number): number {
  let selected = resolveSelection(stream(ctx.config.seed, scenario, state.turn, 2), state.selected, candidate, ctx.rules);
  for (let turn = state.turn + 1; turn <= 5; turn++) {
    const nextState: GameState = { turn: turn as GameState["turn"], selected };
    const offer = generateOffer(stream(ctx.config.seed, scenario, turn, 1), selected, turn, ctx.rules);
    const futureNodes = Math.max(0, ctx.config.searchDepth - (turn - state.turn - 1));
    const chosen = chooseBestAction(nextState, offer, Math.min(futureNodes, 6 - turn), ctx);
    selected = resolveSelection(stream(ctx.config.seed, scenario, turn, 2), selected, chosen, ctx.rules);
  }
  return calculateScore(selected, stream(ctx.config.seed, scenario, 5, 3), ctx.rules).finalScore;
}

function metrics(scores: readonly number[], target: number): V21Evaluation {
  const distribution = scores.map(score => ({ score, weight: 1 }));
  return weightedMetrics(distribution, target);
}

function compareExpected(a: V21Result, b: V21Result): number {
  return b.metrics.expectedScore - a.metrics.expectedScore ||
    b.metrics.targetProbability - a.metrics.targetProbability ||
    b.metrics.cvar10 - a.metrics.cvar10 ||
    a.candidate.cardId.localeCompare(b.candidate.cardId);
}

export function recommendCandidatesV21(
  state: GameState,
  candidates: readonly OfferedCard[],
  objective: Objective,
  config: V21Config
): V21Result[] {
  validateConfig(config, objective);
  if (state.turn !== state.selected.length + 1 || state.selected.length >= 5) throw new Error("V2.1 state turn must match the selected-card count");
  if (candidates.length !== 3 || new Set(candidates.map(card => card.cardId)).size !== 3) throw new Error("Exactly three distinct candidates required");
  if (candidates.some(candidate => state.selected.some(card => card.cardId === candidate.cardId))) throw new Error("Candidate was already selected");
  const ctx = makeContext(config);
  const orderedCandidates = [...candidates].sort((a, b) => cardKey(a).localeCompare(cardKey(b)));
  const results = orderedCandidates.map(candidate => {
    if (state.turn === 5) {
      const distribution = exactFinalDistribution(state.selected, candidate, ctx.rules);
      const exact = weightedMetrics(distribution, config.target);
      return {
        candidate, rank: 0,
        metrics: { expectedScore: exact.expectedScore, targetProbability: exact.targetProbability, p10: exact.p10, p50: exact.p50, p90: exact.p90, cvar10: exact.cvar10, minScore: exact.minScore, maxScore: exact.maxScore },
        method: "exact" as const, simulations: 0,
        diagnostics: { scenarioCount: 0, pilotSamples: 0, searchDepth: 0, seed: config.seed, cutoffStates: 0, roundFiveStates: 0, cacheHits: 0 }
      };
    }
    const scores = Array.from({ length: config.scenarioCount }, (_, scenario) => simulateRootCandidate(state, candidate, ctx, scenario));
    const summary = metrics(scores, config.target);
    return {
      candidate, rank: 0, metrics: summary, method: "monte-carlo-v21" as const, simulations: config.scenarioCount,
      diagnostics: { scenarioCount: config.scenarioCount, pilotSamples: config.pilotSamples, searchDepth: config.searchDepth, seed: config.seed, cutoffStates: ctx.cutoffStates, roundFiveStates: ctx.roundFiveStates, cacheHits: ctx.cacheHits }
    };
  });
  if (config.seed === 1 && config.scenarioCount === 256 && config.pilotSamples === 32) console.log("V2.1 profile", JSON.stringify(ctx.profile));
  return results.sort(compareExpected).map((item, index) => ({ ...item, rank: index + 1 }));
}

export function estimateStateValueV21(state: GameState, config: V21Config): V21CutoffEstimate {
  validateConfig(config);
  if (state.turn !== state.selected.length + 1 || state.selected.length >= 5) throw new Error("V2.1 state turn must match the selected-card count");
  const ctx = makeContext(config);
  return estimateStateInternal(state, ctx);
}

export function evaluateCutoffActionsV21(state: GameState, offers: readonly OfferedCard[], config: V21Config): V21ActionValue[] {
  validateConfig(config);
  if (state.turn !== state.selected.length + 1 || state.selected.length >= 5) throw new Error("V2.1 state turn must match the selected-card count");
  const ctx = makeContext(config);
  return offers.map(candidate => {
    const parts = actionParts(state, candidate, ctx, state.turn === 4);
    const baseExpectedScore = scoreFromParts(scoreParts(state.selected, ctx.rules), ctx.rules);
    return { candidate, baseExpectedScore, ...parts, remainingSelections: 5 - state.selected.length, value: baseExpectedScore + partsTotal(parts) };
  });
}
