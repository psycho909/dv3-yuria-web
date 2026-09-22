import { CARD_LIST, CARDS, CATEGORY_WEIGHTS } from "./cards.js";
import { calculateScore, DEFAULT_RULES } from "./scoring.js";
import { mulberry32, pickOne } from "./random.js";
const COLORS = ["blue", "purple", "red"];
function cloneSelected(cards) {
    return cards.map((c) => ({ ...c }));
}
function weightedCategory(rng, turn) {
    const w = turn === 5 ? CATEGORY_WEIGHTS.final : CATEGORY_WEIGHTS.early;
    const entries = Object.entries(w);
    const total = entries.reduce((s, [, value]) => s + value, 0);
    let roll = rng() * total;
    for (const [category, value] of entries) {
        roll -= value;
        if (roll <= 0)
            return category;
    }
    return "special";
}
function generateOffer(rng, selected, turn) {
    const used = new Set(selected.map((s) => s.cardId));
    const offeredIds = new Set();
    const offer = [];
    for (const color of COLORS) {
        let candidates = [];
        for (let attempts = 0; attempts < 20; attempts++) {
            const category = weightedCategory(rng, turn);
            candidates = CARD_LIST.filter((c) => c.category === category && !used.has(c.id) && !offeredIds.has(c.id));
            if (candidates.length > 0)
                break;
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
function resolveSelection(rng, selected, offered) {
    const result = cloneSelected(selected);
    const def = CARDS[offered.cardId];
    const activated = rng() < def.activationProbability;
    const next = { ...offered, activated };
    if (activated && offered.cardId === "tower")
        next.towerProc = rng() < 0.5;
    result.push(next);
    if (activated && offered.cardId === "star") {
        const removableIndexes = result
            .map((c, index) => ({ c, index }))
            .filter(({ c }) => c.cardId !== "star" && c.activated && !c.removed)
            .map(({ index }) => index);
        if (removableIndexes.length > 0) {
            const index = pickOne(rng, removableIndexes);
            result[index] = { ...result[index], removed: true };
        }
    }
    return result;
}
function mean(values) {
    return values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
}
function percentile(sorted, q) {
    if (sorted.length === 0)
        return 0;
    const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
    return sorted[i];
}
function std(values, avg) {
    return Math.sqrt(mean(values.map((v) => (v - avg) ** 2)));
}
function approximateImmediateValue(selected, offered, rules) {
    // Fast one-step expectation used only as the rollout policy for future turns.
    // It is intentionally not presented as exact Expectimax.
    const def = CARDS[offered.cardId];
    const activeScore = calculateScore([...cloneSelected(selected), { ...offered, activated: true, towerProc: offered.cardId === "tower" ? true : undefined }], () => 0.5, rules).finalScore;
    const failScore = calculateScore([...cloneSelected(selected), { ...offered, activated: false }], () => 0.5, rules).finalScore;
    return def.activationProbability * activeScore + (1 - def.activationProbability) * failScore;
}
function chooseFutureOffer(selected, offer, rules) {
    return [...offer].sort((a, b) => approximateImmediateValue(selected, b, rules) - approximateImmediateValue(selected, a, rules))[0];
}
function simulateOne(rng, state, currentCandidate, rules) {
    let selected = resolveSelection(rng, state.selected, currentCandidate);
    let turn = state.turn + 1;
    while (turn <= 5) {
        const offer = generateOffer(rng, selected, turn);
        const chosen = chooseFutureOffer(selected, offer, rules);
        selected = resolveSelection(rng, selected, chosen);
        turn += 1;
    }
    return calculateScore(selected, rng, rules).finalScore;
}
function rankKey(metric, objective) {
    if (objective.kind === "expected_score")
        return metric.meanScore;
    if (objective.kind === "threshold_probability")
        return metric.thresholdProbability * 1_000_000 + metric.meanScore;
    return metric.p10 * 1_000_000 + metric.meanScore - metric.standardDeviation;
}
export function recommendCandidates(args) {
    const objective = args.objective ?? { kind: "expected_score" };
    const threshold = objective.kind === "threshold_probability" ? objective.threshold : (args.threshold ?? 2700);
    const simulations = args.simulations ?? 10_000;
    const seed = args.seed ?? 20260922;
    const rules = args.rules ?? DEFAULT_RULES;
    const ranked = args.candidates.map((candidate, candidateIndex) => {
        const scores = [];
        const rng = mulberry32(seed + candidateIndex * 100_003);
        for (let i = 0; i < simulations; i++) {
            scores.push(simulateOne(rng, args.state, candidate, rules));
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
            simulations
        };
    });
    ranked.sort((a, b) => rankKey(b, objective) - rankKey(a, objective));
    return {
        objective,
        ranked,
        assumptions: [
            "第 1~4 回合卡種權重使用 10/10/5，第 5 回合使用 5/10/20。",
            "同一回合固定產生藍/紫/紅各 1 張；類別內卡片暫假設等權抽取。",
            "未來回合採 Monte Carlo rollout + 單步期望值策略，不是完整精確 Expectimax。",
            `太陽目前假設${rules.sunCountsSelf ? "會" : "不會"}把自己算入啟用卡數。`,
            "尤里亞的祝福因『隨機增加一個數位 1』缺乏可驗證公式，測試版暫不納入。"
        ]
    };
}
