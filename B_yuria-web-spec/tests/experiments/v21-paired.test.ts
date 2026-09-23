import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { RULES, type OfferedCard } from "../../src/domain";
import { recommendCandidatesPrototype } from "../../src/recommendation-v2";
import { recommendCandidatesV21 } from "../../src/recommendation-v21";
import { evaluatePairedPolicies, v1Policy, type TrialPolicy } from "./v1-baseline.test";

const target = 1500;
const games = Number(process.env.RUN_V21_GAMES ?? 30);
const seeds = Array.from({ length: Number.isInteger(games) && games >= 2 && games <= 30 ? games : 0 }, (_, index) => 20260922 + index * 7919);
const planningSeeds = Array.from({ length: seeds.length }, (_, index) => 41234567 + index * 104729);
const rootScenarios = 256;
const pilotSamples = 32;
const v1SimulationsPerChoice = 128;

function timedPolicy(policy: TrialPolicy, clock: { decisionMs: number }): TrialPolicy {
  return {
    name: policy.name,
    choose(state, offer, planningSeed) {
      const started = performance.now();
      const chosen = policy.choose(state, offer, planningSeed);
      clock.decisionMs += performance.now() - started;
      return chosen;
    }
  };
}

function pairedDifference(base: readonly number[], candidate: readonly number[]) {
  const differences = candidate.map((score, index) => score - base[index]!);
  return {
    mean: differences.reduce((sum, value) => sum + value, 0) / differences.length,
    wins: differences.filter(value => value > 0).length,
    ties: differences.filter(value => value === 0).length,
    losses: differences.filter(value => value < 0).length
  };
}

describe("V1/V2/V2.1 paired expected-score pilot", () => {
  const experiment = process.env.RUN_V21_POLICY_EXPERIMENT === "1" ? it : it.skip;

  experiment("compares the same 30 deterministic worlds at the specification budget", { timeout: 1_800_000 }, () => {
    if (seeds.length !== games) throw new Error("RUN_V21_GAMES must be an integer from 2 to 30");
    const v1Clock = { decisionMs: 0 };
    const v2Clock = { decisionMs: 0 };
    const v21Clock = { decisionMs: 0 };
    const v1 = timedPolicy(v1Policy({ kind: "expected" }, v1SimulationsPerChoice), v1Clock);
    const v2: TrialPolicy = timedPolicy({
      name: "v2-bounded-expected-s256-p32",
      choose(state, offer, seed) {
        return recommendCandidatesPrototype(state, offer, { kind: "expected" }, {
          scenarioCount: rootScenarios, pilotSamples, seed, target, rules: RULES
        })[0]!.candidate;
      }
    }, v2Clock);
    const v21: TrialPolicy = timedPolicy({
      name: "v2.1-expected-s256-p32-d2",
      choose(state, offer, seed) {
        return recommendCandidatesV21(state, offer, { kind: "expected" }, {
          scenarioCount: rootScenarios, pilotSamples, searchDepth: 2, seed, target, rules: RULES
        })[0]!.candidate;
      }
    }, v21Clock);

    const started = performance.now();
    const { trials, summaries } = evaluatePairedPolicies([v1, v2, v21], seeds, target, planningSeeds);
    const totalMs = performance.now() - started;
    const scoresByPolicy = (name: string) => new Map(trials.filter(row => row.policy === name).map(row => [row.seed, row.score]));
    const v1Scores = seeds.map(seed => scoresByPolicy(v1.name).get(seed)!);
    const v2Scores = seeds.map(seed => scoresByPolicy(v2.name).get(seed)!);
    const v21Scores = seeds.map(seed => scoresByPolicy(v21.name).get(seed)!);
    const v21VsV2 = pairedDifference(v2Scores, v21Scores);
    const v21VsV1 = pairedDifference(v1Scores, v21Scores);

    expect(trials).toHaveLength(seeds.length * 3);
    if (games === 30) expect(v21VsV2.mean).toBeGreaterThan(0);
    console.log("V1/V2/V2.1 paired expected-score pilot", JSON.stringify({
      environment: `${seeds.length} paired seeded synthetic worlds; future offers can diverge with policy-dependent card pools`,
      status: "research evidence only; V2/V2.1 are not production recommendations",
      budgets: { rootScenarios, pilotSamples, v21SearchDepth: 2, v1SimulationsPerChoice },
      model: "none; deterministic TypeScript scoring and seeded simulation",
      summaries,
      paired: { v21VsV2, v21VsV1 },
      decisionRuntimeMs: { v1: v1Clock.decisionMs, v2: v2Clock.decisionMs, v21: v21Clock.decisionMs },
      totalRuntimeMs: totalMs,
      seeds,
      planningSeeds
    }, null, 2));
  });
});
