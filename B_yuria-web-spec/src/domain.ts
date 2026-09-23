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
  futureColorModel: "independentUniform",
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
  const present = cards.filter(c => !c.removed);
  const active = present.filter(c => c.activated);
  const failed = present.filter(c => !c.activated);
  const counts: Record<CardColor, number> = { blue: 0, purple: 0, red: 0 };
  active.forEach(c => { counts[c.color]++; });
  let sum = failed.length * rules.failureScore;
  const scoreValues: number[] = [];
  for (const card of active) { const def = CARDS[card.cardId]; if (def.category === "score" && def.scoreValue != null) { sum += def.scoreValue; scoreValues.push(def.scoreValue); } }
  sum += BLUE[counts.blue] ?? 0;
  const moon = active.find(c => c.cardId === "moon");
  if (moon && CARDS.moon.specialEffect?.kind === "failedCardScore") sum += CARDS.moon.specialEffect.baseScore + failed.length * CARDS.moon.specialEffect.perFailedCard;
  const world = active.find(c => c.cardId === "world");
  if (world && scoreValues.length && CARDS.world.specialEffect?.kind === "highestActiveScore") sum += Math.max(...scoreValues) * CARDS.world.specialEffect.factor;
  let multiplierAdd = 0;
  for (const card of active) { const def = CARDS[card.cardId]; if (def.category === "multiplier" && def.multiplierValue != null) multiplierAdd += def.multiplierValue; }
  const tower = active.find(c => c.cardId === "tower");
  if (tower && CARDS.tower.specialEffect?.kind === "tower") multiplierAdd += tower.towerProc ? CARDS.tower.specialEffect.procMultiplier : CARDS.tower.specialEffect.fallbackMultiplier;
  if (active.some(c => c.cardId === "star")) multiplierAdd += CARDS.star.specialEffect?.kind === "removeOtherCard" ? CARDS.star.specialEffect.multiplier : 0;
  const sun = active.find(c => c.cardId === "sun");
  if (sun && CARDS.sun.specialEffect?.kind === "activeCountMultiplier") { const activeCount = active.length - (rules.sunCountsSelf ? 0 : 1); multiplierAdd += CARDS.sun.specialEffect.baseMultiplier + Math.max(0, activeCount) * CARDS.sun.specialEffect.perActiveCard; }
  multiplierAdd += PURPLE[counts.purple] ?? 0;
  const range = RED[counts.red];
  const redBonus = range ? rules.redRollMode === "continuous" ? range[0] + rng() * (range[1] - range[0]) : randomInt(rng, Math.round(range[0] * 100), Math.round(range[1] * 100)) / 100 : 0;
  const multiplier = 1 + multiplierAdd;
  return { sum, multiplier, redBonus, finalScore: Math.floor(sum * multiplier * (1 + redBonus)), activeColorCounts: counts, failedCount: failed.length };
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
  for (let i = 0; i < 3; i++) { const color = rules.futureColorModel === "oneEach" ? COLORS[i]! : pick(rng, COLORS); let pool: CardDefinition[] = []; for (let attempt = 0; attempt < 20; attempt++) { const kind = category(rng, turn); pool = CARDS_BY_CATEGORY[kind].filter(c => !used.has(c.id) && !offered.has(c.id)); if (pool.length) break; } if (!pool.length) pool = CARD_DEFINITIONS.filter(c => !used.has(c.id) && !offered.has(c.id)); const card = pick(rng, pool); offered.add(card.id); result.push({ cardId: card.id, color }); }
  return result;
}

function starTargets(cards: SelectedCard[], rules: Rules): number[] { return cards.flatMap((card, i) => card.cardId !== "star" && !card.removed && (rules.starRemovalPolicy === "uniformPresent" || card.activated) ? [i] : []); }
export function resolveSelection(rng: Rng, selected: SelectedCard[], offered: OfferedCard, rules: Rules = RULES): SelectedCard[] { const next = selected.map(c => ({ ...c })); const active = rng() < CARDS[offered.cardId].activationProbability; const card: SelectedCard = { ...offered, activated: active }; if (active && offered.cardId === "tower") card.towerProc = rng() < .5; next.push(card); if (active && offered.cardId === "star") { const targets = starTargets(next, rules); if (targets.length) { const i = pick(rng, targets); next[i] = { ...next[i]!, removed: true }; } } return next; }

function mean(values: number[]) { return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length); }
function percentile(values: number[], q: number) { return values[Math.min(values.length - 1, Math.floor((values.length - 1) * q))]!; }
function immediate(selected: SelectedCard[], offer: OfferedCard, rules: Rules): number {
  const def = CARDS[offer.cardId];
  const score = (cards: SelectedCard[]) => calculateScore(cards, () => .5, rules).finalScore;
  const active = [...selected, { ...offer, activated: true }];
  let activeScore = score(active);
  if (offer.cardId === "tower") {
    activeScore = (score([...selected, { ...offer, activated: true, towerProc: false }]) + score([...selected, { ...offer, activated: true, towerProc: true }])) / 2;
  } else if (offer.cardId === "star") {
    const targets = starTargets(selected, rules);
    if (targets.length) activeScore = mean(targets.map(target => score(active.map((card, index) => index === target ? { ...card, removed: true } : card))));
  }
  const failureScore = score([...selected, { ...offer, activated: false }]);
  return def.activationProbability * activeScore + (1 - def.activationProbability) * failureScore;
}
function chooseFuture(selected: SelectedCard[], offers: OfferedCard[], rules: Rules, target: number): OfferedCard {
  if (selected.length === 4 && rules.redRollMode === "integerPercent") {
    let best = finalTurnMetrics(selected, offers[0]!, target, rules);
    for (let i = 1; i < offers.length; i++) {
      const next = finalTurnMetrics(selected, offers[i]!, target, rules);
      if (next.thresholdProbability > best.thresholdProbability ||
        (next.thresholdProbability === best.thresholdProbability && next.meanScore > best.meanScore)) best = next;
    }
    return best.candidate;
  }
  let best = offers[0]!;
  let bestScore = immediate(selected, best, rules);
  for (let i = 1; i < offers.length; i++) {
    const score = immediate(selected, offers[i]!, rules);
    if (score > bestScore) { best = offers[i]!; bestScore = score; }
  }
  return best;
}
function simulateOne(rng: Rng, state: GameState, candidate: OfferedCard, rules: Rules, target: number) {
  let selected = resolveSelection(rng, state.selected, candidate, rules);
  for (let turn = state.turn + 1; turn <= 5; turn++) {
    const chosen = chooseFuture(selected, generateOffer(rng, selected, turn, rules), rules, target);
    selected = resolveSelection(rng, selected, chosen, rules);
  }
  return calculateScore(selected, rng, rules).finalScore;
}

function finalTurnMetrics(selected: SelectedCard[], candidate: OfferedCard, threshold: number, rules: Rules): Metrics {
  const activation = CARDS[candidate.cardId].activationProbability;
  const branches: { cards: SelectedCard[]; probability: number }[] = [];
  if (activation < 1) branches.push({ cards: [...selected, { ...candidate, activated: false }], probability: 1 - activation });
  if (activation > 0) {
    if (candidate.cardId === "tower") {
      branches.push({ cards: [...selected, { ...candidate, activated: true, towerProc: false }], probability: activation / 2 });
      branches.push({ cards: [...selected, { ...candidate, activated: true, towerProc: true }], probability: activation / 2 });
    } else if (candidate.cardId === "star") {
      const targets = starTargets(selected, rules);
      if (!targets.length) branches.push({ cards: [...selected, { ...candidate, activated: true }], probability: activation });
      for (const target of targets) {
        branches.push({ cards: [...selected, { ...candidate, activated: true }].map((card, index) => index === target ? { ...card, removed: true } : card), probability: activation / targets.length });
      }
    } else {
      branches.push({ cards: [...selected, { ...candidate, activated: true }], probability: activation });
    }
  }

  const mass = new Map<number, number>();
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
      const score = Math.floor(fixed.sum * fixed.multiplier * (1 + redBonus));
      mass.set(score, (mass.get(score) ?? 0) + branch.probability / rolls);
    }
  }
  const outcomes = [...mass].sort((a, b) => a[0] - b[0]);
  const total = outcomes.reduce((sum, [, weight]) => sum + weight, 0);
  const meanScore = outcomes.reduce((sum, [score, weight]) => sum + score * weight, 0) / total;
  const quantile = (q: number) => { let cumulative = 0; for (const [score, weight] of outcomes) { cumulative += weight / total; if (cumulative + 1e-12 >= q) return score; } return outcomes.at(-1)![0]; };
  return {
    candidate, meanScore, p10: quantile(.1), p50: quantile(.5), p90: quantile(.9), threshold,
    thresholdProbability: outcomes.reduce((sum, [score, weight]) => sum + (score >= threshold ? weight : 0), 0) / total,
    minScore: outcomes[0]![0], maxScore: outcomes.at(-1)![0],
    standardDeviation: Math.sqrt(outcomes.reduce((sum, [score, weight]) => sum + (score - meanScore) ** 2 * weight, 0) / total),
    simulations: 0, method: "exact"
  };
}

export interface Metrics { candidate: OfferedCard; meanScore: number; p10: number; p50: number; p90: number; threshold: number; thresholdProbability: number; minScore: number; maxScore: number; standardDeviation: number; simulations: number; method: "exact" | "monte_carlo"; }

export function recommend(state: GameState, candidates: OfferedCard[], objective: Objective, simulations = 10000, seed = 20260922, rules: Rules = RULES, fallbackTarget = 1500): { ranked: Metrics[]; mode: "objective" | "highest_expected_score_fallback" } {
  const target = objective.kind === "threshold" ? objective.target : fallbackTarget;
  const ranked = candidates.map((candidate, index) => {
    if (state.turn === 5 && rules.redRollMode === "integerPercent") return finalTurnMetrics(state.selected, candidate, target, rules);
    const scores: number[] = []; const cardKey = Object.keys(CARDS).indexOf(candidate.cardId) * COLORS.length + COLORS.indexOf(candidate.color); const rng = mulberry32(seed + cardKey * 100003);
    for (let i = 0; i < simulations; i++) scores.push(simulateOne(rng, state, candidate, rules, target));
    scores.sort((a, b) => a - b); const avg = mean(scores); const hit = scores.filter(s => s >= target).length / simulations;
    return { candidate, meanScore: avg, p10: percentile(scores, .1), p50: percentile(scores, .5), p90: percentile(scores, .9), threshold: target, thresholdProbability: hit, minScore: scores[0]!, maxScore: scores.at(-1)!, standardDeviation: Math.sqrt(mean(scores.map(s => (s - avg) ** 2))), simulations, method: "monte_carlo" as const };
  });
  const byObjective = (a: Metrics, b: Metrics) => objective.kind === "expected" ? b.meanScore - a.meanScore : objective.kind === "stability" ? b.p10 - a.p10 || b.meanScore - a.meanScore : b.thresholdProbability - a.thresholdProbability || b.meanScore - a.meanScore;
  ranked.sort(byObjective); const mode = objective.kind === "threshold" && ranked.every(m => m.thresholdProbability === 0) ? "highest_expected_score_fallback" : "objective"; if (mode === "highest_expected_score_fallback") ranked.sort((a, b) => b.meanScore - a.meanScore); return { ranked, mode };
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
