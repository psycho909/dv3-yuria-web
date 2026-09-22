import { CARD_LIST, CARDS, CATEGORY_WEIGHTS } from "./cards.js";
import { calculateScore, DEFAULT_RULES } from "./scoring.js";
import { mulberry32, pickOne, type Rng } from "./random.js";
import { finalTurnMetrics } from "./distribution.js";
import type {
  CandidateMetrics,
  CardCategory,
  CardColor,
  GameState,
  OfferedCard,
  RecommendationObjective,
  RecommendationResult,
  RuleConfig,
  SelectedCard
} from "./types.js";

const COLORS: CardColor[] = ["blue", "purple", "red"];

function cloneSelected(cards: SelectedCard[]): SelectedCard[] {
  return cards.map((c) => ({ ...c }));
}

function weightedCategory(rng: Rng, turn: number): CardCategory {
  const w = turn === 5 ? CATEGORY_WEIGHTS.final : CATEGORY_WEIGHTS.early;
  const entries = Object.entries(w) as [CardCategory, number][];
  const total = entries.reduce((s, [, value]) => s + value, 0);
  let roll = rng() * total;
  for (const [category, value] of entries) {
    roll -= value;
    if (roll <= 0) return category;
  }
  return "special";
}

export function generateOffer(rng: Rng, selected: SelectedCard[], turn: number, rules: RuleConfig = DEFAULT_RULES): OfferedCard[] {
  const used = new Set(selected.map((s) => s.cardId));
  const offeredIds = new Set<string>();
  const offer: OfferedCard[] = [];

  for (const slotColor of COLORS) {
    const color = rules.futureColorModel === "oneEach" ? slotColor : pickOne(rng, COLORS);
    let candidates = [] as typeof CARD_LIST;
    for (let attempts = 0; attempts < 20; attempts++) {
      const category = weightedCategory(rng, turn);
      candidates = CARD_LIST.filter((c) => c.category === category && !used.has(c.id) && !offeredIds.has(c.id));
      if (candidates.length > 0) break;
    }
    if (candidates.length === 0) {
      candidates = CARD_LIST.filter((c) => !used.has(c.id) && !offeredIds.has(c.id));
    }
    const card = pickOne(rng, candidates);
    offeredIds.add(card.id);
    offer.push({ cardId: card.id, color });
  }

  return offer;
}

function starRemovalIndexes(selected: SelectedCard[], rules: RuleConfig): number[] {
  return selected.flatMap((card, index) =>
    card.cardId !== "star" && !card.removed && (rules.starRemovalPolicy === "uniformPresent" || card.activated)
      ? [index] : []);
}

export function resolveSelection(rng: Rng, selected: SelectedCard[], offered: OfferedCard, rules: RuleConfig): SelectedCard[] {
  const result = cloneSelected(selected);
  const def = CARDS[offered.cardId];
  const activated = rng() < def.activationProbability;
  const next: SelectedCard = { ...offered, activated };

  if (activated && offered.cardId === "tower") next.towerProc = rng() < 0.5;
  result.push(next);

  if (activated && offered.cardId === "star") {
    const removableIndexes = starRemovalIndexes(result, rules);
    if (removableIndexes.length > 0) {
      const index = pickOne(rng, removableIndexes);
      result[index] = { ...result[index]!, removed: true };
    }
  }

  return result;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[i]!;
}

function std(values: number[], avg: number): number {
  return Math.sqrt(mean(values.map((v) => (v - avg) ** 2)));
}

export function approximateImmediateValue(selected: SelectedCard[], offered: OfferedCard, rules: RuleConfig): number {
  // Fast one-step expectation used only as the rollout policy for future turns.
  // It is intentionally not presented as exact Expectimax.
  const def = CARDS[offered.cardId];
  const active = [...cloneSelected(selected), { ...offered, activated: true }];
  const score = (cards: SelectedCard[]) => calculateScore(cards, () => 0.5, rules).finalScore;
  let activeScore = score(active);
  if (offered.cardId === "tower") {
    activeScore = (activeScore + score([...cloneSelected(selected), { ...offered, activated: true, towerProc: true }])) / 2;
  } else if (offered.cardId === "star") {
    const targets = starRemovalIndexes(selected, rules);
    if (targets.length > 0) {
      activeScore = mean(targets.map((target) => score(active.map((card, index) => index === target ? { ...card, removed: true } : card))));
    }
  }
  const failScore = calculateScore([...cloneSelected(selected), { ...offered, activated: false }], () => 0.5, rules).finalScore;
  return def.activationProbability * activeScore + (1 - def.activationProbability) * failScore;
}

export function chooseFutureOffer(selected: SelectedCard[], offer: OfferedCard[], rules: RuleConfig, objective: RecommendationObjective = { kind: "expected_score" }, threshold = 2700): OfferedCard {
  if (selected.length === 4 && rules.redRollMode === "integerPercent") {
    const target = objective.kind === "threshold_probability" ? objective.threshold : threshold;
    return offer.map(c => finalTurnMetrics(selected, c, target, rules))
      .sort((a, b) => compareCandidateMetrics(a, b, objective))[0]!.candidate;
  }
  return [...offer].sort((a, b) => approximateImmediateValue(selected, b, rules) - approximateImmediateValue(selected, a, rules))[0]!;
}

function simulateOne(
  rng: Rng,
  state: GameState,
  currentCandidate: OfferedCard,
  rules: RuleConfig,
  objective: RecommendationObjective,
  threshold: number
): number {
  let selected = resolveSelection(rng, state.selected, currentCandidate, rules);
  let turn = state.turn + 1;

  while (turn <= 5) {
    const offer = generateOffer(rng, selected, turn, rules);
    const chosen = chooseFutureOffer(selected, offer, rules, objective, threshold);
    selected = resolveSelection(rng, selected, chosen, rules);
    turn += 1;
  }

  return calculateScore(selected, rng, rules).finalScore;
}

export function compareCandidateMetrics(a: CandidateMetrics, b: CandidateMetrics, objective: RecommendationObjective): number {
  if (objective.kind === "expected_score") return b.meanScore - a.meanScore;
  if (objective.kind === "threshold_probability") return b.thresholdProbability - a.thresholdProbability || b.meanScore - a.meanScore;
  return b.p10 - a.p10 || (b.meanScore - b.standardDeviation) - (a.meanScore - a.standardDeviation);
}

export function recommendCandidates(args: {
  state: GameState;
  candidates: OfferedCard[];
  objective?: RecommendationObjective;
  threshold?: number;
  simulations?: number;
  seed?: number;
  rules?: RuleConfig;
}): RecommendationResult {
  const objective = args.objective ?? { kind: "expected_score" };
  const threshold = objective.kind === "threshold_probability" ? objective.threshold : (args.threshold ?? 2700);
  const simulations = args.simulations ?? 10_000;
  const seed = args.seed ?? 20260922;
  const rules = args.rules ?? DEFAULT_RULES;

  if (!Number.isSafeInteger(simulations) || simulations <= 0) throw new RangeError("simulations must be a positive safe integer");
  if (!Number.isFinite(threshold) || threshold < 0) throw new RangeError("threshold must be finite and non-negative");
  if (!Number.isSafeInteger(seed)) throw new RangeError("seed must be a safe integer");
  if (!Number.isInteger(args.state.turn) || args.state.turn < 1 || args.state.turn > 5 || args.state.selected.length !== args.state.turn - 1) {
    throw new RangeError("turn must be 1..5 with turn - 1 selected cards, including removed cards");
  }
  const selectedIds = new Set(args.state.selected.map((card) => card.cardId));
  if (selectedIds.size !== args.state.selected.length || args.candidates.length === 0 || new Set(args.candidates.map((card) => card.cardId)).size !== args.candidates.length || args.candidates.some((card) => selectedIds.has(card.cardId))) {
    throw new RangeError("cards must have unique identities and candidates must be non-empty and unselected");
  }

  const ranked = args.candidates.map((candidate): CandidateMetrics => {
    if (args.state.turn === 5 && rules.redRollMode === "integerPercent") return finalTurnMetrics(args.state.selected, candidate, threshold, rules);
    const scores: number[] = [];
    const candidateKey = CARD_LIST.findIndex((card) => card.id === candidate.cardId) * COLORS.length + COLORS.indexOf(candidate.color);
    const rng = mulberry32(seed + candidateKey * 100_003);
    for (let i = 0; i < simulations; i++) {
      scores.push(simulateOne(rng, args.state, candidate, rules, objective, threshold));
    }
    scores.sort((a, b) => a - b);
    const avg = mean(scores);
    const hitCount = scores.filter((x) => x >= threshold).length;
    return {
      candidate,
      meanScore: avg,
      p10: percentile(scores, 0.10),
      p50: percentile(scores, 0.50),
      p90: percentile(scores, 0.90),
      standardDeviation: std(scores, avg),
      threshold,
      thresholdProbability: hitCount / simulations,
      simulations,
      calculationMethod: "monte_carlo",
      minScore: scores[0]!, maxScore: scores.at(-1)!
    };
  });

  ranked.sort((a, b) => compareCandidateMetrics(a, b, objective));

  const selectionMode = objective.kind === "threshold_probability" && ranked.every((metric) => metric.thresholdProbability === 0)
    ? "highest_expected_score_fallback"
    : "objective";
  if (selectionMode === "highest_expected_score_fallback") {
    ranked.sort((a, b) => b.meanScore - a.meanScore);
  }

  return {
    objective,
    selectionMode,
    ranked,
    assumptions: [
      "第 1~4 回合卡種權重使用 10/10/5，第 5 回合使用 5/10/20。",
      rules.futureColorModel === "oneEach"
        ? "未來候選使用舊版三色各一張假設（已知無法涵蓋同輪重複顏色），僅供比較；類別內卡片暫假設等權。"
        : "未來候選顏色暫假設各自獨立、三色等機率，可出現同色牌；此分布尚未驗證，類別內卡片也暫假設等權。",
      "未來回合採 Monte Carlo rollout + 單步期望值策略，不是完整精確 Expectimax。",
      "整數紅色模型的最後一回合完整列舉並依目標選牌；較早的未來回合仍採即時平均分策略，尚非全局最優。",
      "已選過的牌（包含失敗或被移除者）不再出現；同輪候選不重複，未選牌可再出現。此為待驗證假設。",
      `紅色加成採${rules.redRollMode === "integerPercent" ? "整數百分比" : "連續值"}均勻抽樣；未來選牌估值使用區間中點，非完整紅色分布期望。`,
      "達標率為有限次抽樣估計；0 次命中不代表事件不可能。",
      `星牌採實測畫面的 +240%；移除目標假設為${rules.starRemovalPolicy === "uniformPresent" ? "其他尚未移除的牌（含失敗牌）" : "其他成功且尚未移除的牌"}，各目標等機率仍待驗證。`,
      `太陽目前假設${rules.sunCountsSelf ? "會" : "不會"}把自己算入啟用卡數。`,
      "尤里亞的祝福因『隨機增加一個數位 1』缺乏可驗證公式，測試版暫不納入。"
    ]
  };
}
