import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { RULES, type OfferedCard } from "../../src/domain";
import { recommendCandidatesPrototype } from "../../src/recommendation-v2";
import { evaluatePairedPolicies, v1Policy, type TrialPolicy } from "./v1-baseline.test";

const target = 1500;
const requestedGames = Number(process.env.RUN_POLICY_GAMES ?? 30);
const seeds = Array.from({ length: Number.isInteger(requestedGames) && requestedGames >= 2 && requestedGames <= 2000 ? requestedGames : 0 }, (_, index) => 20260922 + index * 7919);
// Fixed before evaluation and never derived from worldSeed. Both policies see
// the same planning seed for each game/turn; neither sees holdout outcomes.
const planningSeeds = Array.from({ length: seeds.length }, (_, index) => 41234567 + index * 104729);
const v1SimulationsPerChoice = 128;
const v2RootScenarios = 8;
const v2PilotSamplesPerAction = 4;
function meanCI95(values: readonly number[]): [number, number] {
  const n = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / n;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  // Student-t two-sided 95% critical value, Cornish-Fisher approximation.
  // Accurate for the experiment's n >= 30; use the same paired method for
  // score and hit-indicator differences.
  const z = 1.959963984540054;
  const df = n - 1;
  const critical = z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2);
  const margin = critical * Math.sqrt(variance / n);
  return [mean - margin, mean + margin];
}

function pairedStatistics(v1: readonly number[], v2: readonly number[]) {
  if (v1.length !== v2.length || v1.length < 2) throw new Error("Paired samples require equal counts of at least two");
  const differences = v2.map((score, index) => score - v1[index]!);
  const hitDifferences = v2.map((score, index) => Number(score >= target) - Number(v1[index]! >= target));
  const n = differences.length;
  const meanDifference = differences.reduce((sum, difference) => sum + difference, 0) / n;
  return {
    meanDifference,
    ci95: meanCI95(differences),
    targetRateDifference: hitDifferences.reduce((sum, difference) => sum + difference, 0) / n,
    targetRateDifferenceCI95: meanCI95(hitDifferences),
    wins: differences.filter(difference => difference > 0).length,
    ties: differences.filter(difference => difference === 0).length,
    losses: differences.filter(difference => difference < 0).length
  };
}

function timedPolicy(policy: TrialPolicy, clock: { decisionMs: number }): TrialPolicy {
  return {
    name: policy.name,
    choose(state, offer, planningSeed): OfferedCard {
      const start = performance.now();
      const chosen = policy.choose(state, offer, planningSeed);
      clock.decisionMs += performance.now() - start;
      return chosen;
    }
  };
}

describe("V1 versus bounded V2 paired pilot", () => {
  const experiment = process.env.RUN_POLICY_EXPERIMENT === "1" ? it : it.skip;

  experiment("compares expected-score policies on paired exogenous worlds", { timeout: 90_000 }, () => {
    if (seeds.length === 0) throw new Error("RUN_POLICY_GAMES must be an integer from 2 to 2000");
    const v1Clock = { decisionMs: 0 };
    const v2Clock = { decisionMs: 0 };
    const v1 = timedPolicy(v1Policy({ kind: "expected" }, v1SimulationsPerChoice), v1Clock);
    const v2 = timedPolicy({
      name: "v2-bounded-expected",
      choose(state, offer, planningSeed) {
        return recommendCandidatesPrototype(state, offer, { kind: "expected" }, {
          scenarioCount: v2RootScenarios,
          pilotSamples: v2PilotSamplesPerAction,
          seed: planningSeed,
          target,
          rules: RULES
        })[0]!.candidate;
      }
    }, v2Clock);

    const start = performance.now();
    const { trials, summaries } = evaluatePairedPolicies([v1, v2], seeds, target, planningSeeds);
    const totalMs = performance.now() - start;
    const byPolicy = (name: string) => new Map(trials.filter(trial => trial.policy === name).map(trial => [trial.seed, trial.score]));
    const v1Scores = byPolicy(v1.name);
    const v2Scores = byPolicy(v2.name);
    expect(v1Scores.size).toBe(seeds.length);
    expect(v2Scores.size).toBe(seeds.length);
    const paired = pairedStatistics(seeds.map(seed => v1Scores.get(seed)!), seeds.map(seed => v2Scores.get(seed)!));
    expect(paired.wins + paired.ties + paired.losses).toBe(seeds.length);
    expect(Number.isFinite(paired.meanDifference)).toBe(true);
    expect(paired.ci95[0]).toBeLessThanOrEqual(paired.meanDifference);
    expect(paired.ci95[1]).toBeGreaterThanOrEqual(paired.meanDifference);
    expect(paired.targetRateDifferenceCI95[0]).toBeLessThanOrEqual(paired.targetRateDifference);
    expect(paired.targetRateDifferenceCI95[1]).toBeGreaterThanOrEqual(paired.targetRateDifference);

    console.log("V1/V2 directional paired pilot", JSON.stringify({
      environment: `${seeds.length} paired seeded synthetic worlds; state-dependent offer pools may diverge`,
      status: "not production evidence; unequal planning budgets; bounded V2 is not full expectimax",
      budgets: { v1SimulationsPerChoice, v2RootScenarios, v2PilotSamplesPerAction },
      planningSeedSchedule: "fixed independent array, shared by V1/V2 and separate from world seeds",
      summaries,
      paired,
      durationMs: { total: totalMs, v1Decisions: v1Clock.decisionMs, v2Decisions: v2Clock.decisionMs }
    }, null, 2));
  });
});
