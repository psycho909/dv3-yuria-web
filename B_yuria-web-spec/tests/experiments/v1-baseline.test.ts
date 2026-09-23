import { describe, expect, it } from "vitest";
import {
  CARDS,
  RULES,
  calculateScore,
  generateOffer,
  mulberry32,
  recommend,
  resolveSelection,
  type GameState,
  type Objective,
  type OfferedCard,
  type SelectedCard
} from "../../src/domain";

// A policy sees only the current state, current offer and an independent planning seed.
// Never pass the environment seed or future offers to choose().
export interface TrialPolicy {
  name: string;
  choose(state: GameState, offer: OfferedCard[], planningSeed: number): OfferedCard;
}

export interface TrialResult {
  seed: number;
  policy: string;
  choices: OfferedCard[];
  score: number;
}

export interface PolicySummary {
  meanScore: number;
  targetRate: number;
  cvar10: number;
  p10: number;
}

const hash = (seed: number, turn: number, event: number): number =>
  (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(turn + 31, 0xc2b2ae35) ^ event) >>> 0;

// Each turn/event gets its own stream. Different policies reuse the same exogenous
// random coordinates, while their state-dependent available card pool may diverge.
// This is a coupling, not a claim that counterfactual offers are observed data.
function environmentRng(seed: number, turn: number, event: number) {
  return mulberry32(hash(seed, turn, event));
}

export function v1Policy(objective: Objective, simulations = 128): TrialPolicy {
  return {
    name: `v1-${objective.kind}`,
    choose(state, offer, planningSeed) {
      return recommend(state, offer, objective, simulations, planningSeed, RULES).ranked[0]!.candidate;
    }
  };
}

export function evaluatePairedPolicies(
  policies: readonly TrialPolicy[],
  seeds: readonly number[],
  target = 1500,
  planningSeeds?: readonly number[]
): { trials: TrialResult[]; summaries: Record<string, PolicySummary> } {
  if (planningSeeds && planningSeeds.length !== seeds.length) {
    throw new Error("Planning seed schedule must match world seed count");
  }
  const trials: TrialResult[] = [];
  for (const [worldIndex, seed] of seeds.entries()) {
    for (const policy of policies) {
      let selected: SelectedCard[] = [];
      const choices: OfferedCard[] = [];
      for (let turn = 1; turn <= 5; turn++) {
        const state: GameState = { turn: turn as GameState["turn"], selected };
        const offer = generateOffer(environmentRng(seed, turn, 1), selected, turn, RULES);
        // Explicit schedules are generated independently of world seeds by the
        // caller. The fallback retains the earlier V1 baseline fixture.
        const planningSeed = planningSeeds ? hash(planningSeeds[worldIndex]!, turn, 99) : hash(seed ^ 0xa5a5a5a5, turn, 99);
        const choice = policy.choose(state, offer, planningSeed);
        if (!offer.some(card => card.cardId === choice.cardId && card.color === choice.color)) {
          throw new Error(`${policy.name} chose a card outside the current offer`);
        }
        choices.push(choice);
        selected = resolveSelection(environmentRng(seed, turn, 2), selected, choice, RULES);
      }
      const score = calculateScore(selected, environmentRng(seed, 5, 3), RULES).finalScore;
      trials.push({ seed, policy: policy.name, choices, score });
    }
  }
  const summaries: Record<string, PolicySummary> = {};
  for (const policy of policies) {
    const scores = trials.filter(trial => trial.policy === policy.name).map(trial => trial.score).sort((a, b) => a - b);
    if (!scores.length) throw new Error("At least one seed is required");
    const tailCount = Math.max(1, Math.ceil(scores.length * .1));
    summaries[policy.name] = {
      meanScore: scores.reduce((sum, score) => sum + score, 0) / scores.length,
      targetRate: scores.filter(score => score >= target).length / scores.length,
      cvar10: scores.slice(0, tailCount).reduce((sum, score) => sum + score, 0) / tailCount,
      p10: scores[Math.min(scores.length - 1, Math.ceil(scores.length * .1) - 1)]!
    };
  }
  return { trials, summaries };
}

const seeds = Array.from({ length: 30 }, (_, index) => 20260922 + index * 7919);

describe("V1 paired-policy baseline", () => {
  it("replays the paired environment deterministically", () => {
    const policy = v1Policy({ kind: "expected" }, 32);
    const first = evaluatePairedPolicies([policy], seeds.slice(0, 2));
    expect(first).toEqual(evaluatePairedPolicies([policy], seeds.slice(0, 2)));
    expect(first.trials).toHaveLength(2);
  });

  const experiment = process.env.RUN_POLICY_EXPERIMENT === "1" ? it : it.skip;
  experiment("replays a fixed 30-game baseline for all three objectives", { timeout: 120_000 }, () => {
    const policies = [v1Policy({ kind: "expected" }), v1Policy({ kind: "threshold", target: 1500 }), v1Policy({ kind: "stability" })];
    const first = evaluatePairedPolicies(policies, seeds);
    const second = evaluatePairedPolicies(policies, seeds);
    expect(first).toEqual(second);
    expect(first.trials).toHaveLength(90);
    for (const summary of Object.values(first.summaries)) {
      expect(Number.isFinite(summary.meanScore)).toBe(true);
      expect(summary.targetRate).toBeGreaterThanOrEqual(0);
      expect(summary.targetRate).toBeLessThanOrEqual(1);
      expect(summary.cvar10).toBeLessThanOrEqual(summary.meanScore);
    }
    console.log("V1 paired baseline", JSON.stringify({ seeds, summaries: first.summaries }));
  });

  it("contains a delayed color reward that immediate greedy misses", () => {
    const selected: SelectedCard[] = [
      { cardId: "fool", color: "blue", activated: true },
      { cardId: "magician", color: "purple", activated: true },
      { cardId: "strength", color: "red", activated: true }
    ];
    const later: OfferedCard = { cardId: "hierophant", color: "blue" };
    const score = (cards: SelectedCard[]) => calculateScore(cards, () => .5, RULES).finalScore;
    const oneStep = (card: OfferedCard) => {
      const probability = CARDS[card.cardId].activationProbability;
      return probability * score([...selected, { ...card, activated: true }]) +
        (1 - probability) * score([...selected, { ...card, activated: false }]);
    };
    const terminal = (card: OfferedCard) => {
      const probability = CARDS[card.cardId].activationProbability;
      const append = (activated: boolean) => score([
        ...selected,
        { ...card, activated },
        { ...later, activated: true }
      ]);
      return probability * append(true) + (1 - probability) * append(false);
    };
    const immediateWinner: OfferedCard = { cardId: "high_priestess", color: "blue" };
    const eventualWinner: OfferedCard = { cardId: "empress", color: "red" };
    // V1 sees 485.1 > 478.2 now; after the known later offer, 737.1 < 761.65.
    // This demonstrates horizon sensitivity, not that the V2 planner will
    // necessarily choose Empress under unknown future offers.
    expect(oneStep(immediateWinner)).toBeCloseTo(485.1);
    expect(oneStep(eventualWinner)).toBeCloseTo(478.2);
    expect(terminal(immediateWinner)).toBeCloseTo(737.1);
    expect(terminal(eventualWinner)).toBeCloseTo(761.65);
  });
});
