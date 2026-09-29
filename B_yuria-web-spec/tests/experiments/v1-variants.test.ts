import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  LEGACY_V1_OPTIONS,
  RULES,
  recommend,
  type GameState,
  type Objective,
  type OfferedCard,
  type RecommendOptions,
  type SelectedCard
} from "../../src/domain";
import { evaluatePairedPolicies, type TrialPolicy, type TrialResult } from "./v1-baseline.test";

// Opt-in V1 engine comparisons. Nothing here changes production behavior.
//   RUN_V1_VARIANTS=1                       enable
//   V1_VARIANT_WORLDS=300                   shared seeded worlds for the paired benchmark
//   V1_VARIANT_SIMS=10000                   planning simulations per candidate
//   V1_VARIANT_SHARD=0/1                    run worlds where index % shards === shard
//   V1_VARIANT_OUT=<dir>                    write shard JSON there
//   V1_VARIANT_AGGREGATE=<dir>              only merge shard JSON from <dir> and print the summary
const enabled = process.env.RUN_V1_VARIANTS === "1";
const experiment = enabled ? it : it.skip;
const TARGET = 3000;
const LEVELS = [2000, 2700, 3000] as const;
const worlds = Number(process.env.V1_VARIANT_WORLDS ?? 300);
const simulations = Number(process.env.V1_VARIANT_SIMS ?? 10_000);
const [shard, shards] = (process.env.V1_VARIANT_SHARD ?? "0/1").split("/").map(Number) as [number, number];
const outDir = process.env.V1_VARIANT_OUT;
const aggregateDir = process.env.V1_VARIANT_AGGREGATE;

const active = (cardId: SelectedCard["cardId"], color: SelectedCard["color"]): SelectedCard => ({ cardId, color, activated: true });
const threshold: Objective = { kind: "threshold", target: TARGET };
const expected: Objective = { kind: "expected" };

interface PolicySpec { name: string; objective: Objective; options: RecommendOptions }
// "production" is the reference for the step-4 candidates; legacy rows show what the new estimator changed.
const POLICIES: PolicySpec[] = [
  { name: "legacy", objective: threshold, options: LEGACY_V1_OPTIONS },
  { name: "production", objective: threshold, options: {} },
  { name: "upperTail", objective: threshold, options: { zeroTargetFallback: "upperTail" } },
  { name: "rewardTier", objective: threshold, options: { zeroTargetFallback: "rewardTier" } },
  { name: "projected", objective: threshold, options: { rolloutPolicy: "projected" } },
  { name: "legacy-expected", objective: expected, options: LEGACY_V1_OPTIONS },
  { name: "production-expected", objective: expected, options: {} }
];

function timedPolicies(timing: Record<string, { ms: number; decisions: number }>): TrialPolicy[] {
  return POLICIES.map(spec => {
    timing[spec.name] = { ms: 0, decisions: 0 };
    return {
      name: spec.name,
      choose(state: GameState, offer: OfferedCard[], planningSeed: number) {
        const start = performance.now();
        const choice = recommend(state, offer, spec.objective, simulations, planningSeed, RULES, TARGET, spec.options).ranked[0]!.candidate;
        timing[spec.name]!.ms += performance.now() - start;
        timing[spec.name]!.decisions++;
        return choice;
      }
    };
  });
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const yieldToRunner = () => new Promise(resolve => setImmediate(resolve));
function summarize(trials: TrialResult[], timing: Record<string, { ms: number; decisions: number }>) {
  const scores = new Map<string, Map<number, number>>();
  const choices = new Map<string, Map<number, string>>();
  for (const trial of trials) {
    if (!scores.has(trial.policy)) { scores.set(trial.policy, new Map()); choices.set(trial.policy, new Map()); }
    scores.get(trial.policy)!.set(trial.seed, trial.score);
    choices.get(trial.policy)!.set(trial.seed, trial.choices.map(card => `${card.cardId}:${card.color}`).join(","));
  }
  const seeds = [...scores.get("production")!.keys()];
  const paired = (policy: string, reference: string) => {
    const diffs = seeds.map(seed => scores.get(policy)!.get(seed)! - scores.get(reference)!.get(seed)!);
    const average = mean(diffs);
    const sd = Math.sqrt(diffs.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(1, diffs.length - 1));
    const se = sd / Math.sqrt(diffs.length);
    const hits = (name: string, seed: number) => scores.get(name)!.get(seed)! >= TARGET;
    return {
      reference, meanDifference: average, sd, se, ci95: [average - 1.96 * se, average + 1.96 * se],
      wins: diffs.filter(value => value > 0).length, ties: diffs.filter(value => value === 0).length, losses: diffs.filter(value => value < 0).length,
      sameChoices: seeds.filter(seed => choices.get(policy)!.get(seed) === choices.get(reference)!.get(seed)).length,
      target3000OnlyThis: seeds.filter(seed => hits(policy, seed) && !hits(reference, seed)).length,
      target3000OnlyReference: seeds.filter(seed => !hits(policy, seed) && hits(reference, seed)).length
    };
  };
  const referenceOf = (policy: string) => policy.endsWith("-expected") ? "production-expected" : "production";
  return Object.fromEntries([...scores.keys()].map(policy => {
    const values = seeds.map(seed => scores.get(policy)!.get(seed)!).sort((a, b) => a - b);
    const tail = values.slice(0, Math.max(1, Math.ceil(values.length * .1)));
    return [policy, {
      worlds: values.length,
      meanScore: mean(values),
      rates: Object.fromEntries(LEVELS.map(level => [level, values.filter(score => score >= level).length / values.length])),
      cvar10: mean(tail),
      msPerDecision: timing[policy] ? timing[policy]!.ms / Math.max(1, timing[policy]!.decisions) : null,
      paired: policy === referenceOf(policy) ? null : paired(policy, referenceOf(policy))
    }];
  }));
}

describe("V1 engine variants", () => {
  experiment("measures estimator spread across planning seeds", { timeout: 1_800_000 }, async () => {
    const states: { name: string; state: GameState; candidates: OfferedCard[] }[] = [
      { name: "turn1", state: { turn: 1, selected: [] }, candidates: [{ cardId: "magician", color: "purple" }, { cardId: "death", color: "blue" }, { cardId: "lovers", color: "red" }] },
      { name: "turn3", state: { turn: 3, selected: [active("fool", "blue"), active("strength", "purple")] }, candidates: [{ cardId: "magician", color: "blue" }, { cardId: "justice", color: "red" }, { cardId: "hermit", color: "purple" }] },
      { name: "turn4", state: { turn: 4, selected: [active("fool", "blue"), active("magician", "blue"), active("moon", "blue")] }, candidates: [{ cardId: "empress", color: "blue" }, { cardId: "emperor", color: "purple" }, { cardId: "hermit", color: "red" }] }
    ];
    const engines: Record<string, RecommendOptions> = {
      legacy: LEGACY_V1_OPTIONS,
      exactFinalOnly: { ...LEGACY_V1_OPTIONS, exactFinalStep: true },
      sharedRandomOnly: { ...LEGACY_V1_OPTIONS, commonRandomNumbers: true },
      production: {}
    };
    const seedCount = Number(process.env.V1_VARIANT_SEEDS ?? 12);
    const report: Record<string, unknown> = { simulations, seedCount };
    for (const target of [1500, TARGET]) for (const { name, state, candidates } of states) for (const [engine, options] of Object.entries(engines)) {
      const runs: { result: ReturnType<typeof recommend>; ms: number }[] = [];
      for (let index = 0; index < seedCount; index++) {
        const start = performance.now();
        const result = recommend(state, candidates, { kind: "threshold", target }, simulations, 20260922 + index * 104729, RULES, target, options);
        runs.push({ result, ms: performance.now() - start });
        await yieldToRunner();
      }
      const tops = runs.map(run => run.result.ranked[0]!.candidate.cardId);
      const modal = [...new Set(tops)].sort((a, b) => tops.filter(top => top === b).length - tops.filter(top => top === a).length)[0];
      report[`${name}@${target}:${engine}`] = {
        topAgreement: tops.filter(top => top === modal).length / tops.length,
        msPerRecommend: mean(runs.map(run => run.ms)),
        candidates: Object.fromEntries(candidates.map(candidate => {
          const metrics = runs.map(run => run.result.ranked.find(metric => metric.candidate.cardId === candidate.cardId)!);
          const rates = metrics.map(metric => metric.thresholdProbability);
          const means = metrics.map(metric => metric.meanScore);
          const spread = (values: number[]) => { const average = mean(values); return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(1, values.length - 1)); };
          return [candidate.cardId, { rate: mean(rates), rateSd: spread(rates), zeroRuns: rates.filter(rate => rate === 0).length, mean: mean(means), meanSd: spread(means) }];
        }))
      };
    }
    if (outDir) { mkdirSync(outDir, { recursive: true }); writeFileSync(join(outDir, "variance.json"), JSON.stringify(report, null, 2)); }
    console.log("V1 estimator spread", JSON.stringify(report));
    expect(Object.keys(report).length).toBeGreaterThan(2);
  });

  experiment("plays shared seeded worlds for each engine variant", { timeout: 7_200_000 }, async () => {
    if (aggregateDir) {
      const files = readdirSync(aggregateDir).filter(file => /^shard-\d+\.json$/.test(file));
      const parts = files.map(file => JSON.parse(readFileSync(join(aggregateDir, file), "utf8")) as { trials: TrialResult[]; timing: Record<string, { ms: number; decisions: number }> });
      const timing: Record<string, { ms: number; decisions: number }> = {};
      for (const part of parts) for (const [name, value] of Object.entries(part.timing)) {
        timing[name] ??= { ms: 0, decisions: 0 };
        timing[name]!.ms += value.ms;
        timing[name]!.decisions += value.decisions;
      }
      const summary = summarize(parts.flatMap(part => part.trials), timing);
      writeFileSync(join(aggregateDir, "summary.json"), JSON.stringify({ files: files.length, simulations, target: TARGET, summary }, null, 2));
      console.log("V1 variant summary", JSON.stringify(summary));
      expect(Object.keys(summary)).toContain("production");
      return;
    }
    const seeds = Array.from({ length: worlds }, (_, index) => 20260922 + index * 7919).filter((_, index) => index % shards === shard);
    const timing: Record<string, { ms: number; decisions: number }> = {};
    const policies = timedPolicies(timing);
    const trials: TrialResult[] = [];
    // One world at a time (planning seeds depend only on the world seed), yielding so the runner stays responsive.
    for (const seed of seeds) {
      trials.push(...evaluatePairedPolicies(policies, [seed], TARGET).trials);
      await yieldToRunner();
    }
    expect(trials).toHaveLength(seeds.length * POLICIES.length);
    if (outDir) { mkdirSync(outDir, { recursive: true }); writeFileSync(join(outDir, `shard-${shard}.json`), JSON.stringify({ shard, shards, simulations, worlds: seeds.length, trials, timing })); }
    if (shards === 1) console.log("V1 variant summary", JSON.stringify(summarize(trials, timing)));
  });
});
