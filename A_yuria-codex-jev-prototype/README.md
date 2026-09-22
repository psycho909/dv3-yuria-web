# A — Yuria Codex + Jev probability prototype

A runnable test project for validating the recommendation engine before building the full website.

## What works now

- 22-card data model.
- Published activation probabilities and base effects.
- Score formula: `floor(SUM × MULT × (1 + red bonus))`.
- Failed-card 20-point compensation.
- Blue / purple / red color tiers.
- Tower / Star / Moon / Sun / World test logic.
- Seeded Monte Carlo ranking for 3 offered cards.
- Mean score, P10/P50/P90 and target-hit probability.
- When every candidate has zero sampled target-hit probability, the result falls back to the candidate with the highest expected final score (`selectionMode: "highest_expected_score_fallback"`).
- Optional Jev semantic objective routing.

## Run

Requires Node.js 20+.

```bash
npm install
npm run selftest
npm test
npm run typecheck
npm run demo
```

Optional Jev path:

```bash
cp .env.example .env
# set TYPESAFE_API_KEY in your shell/environment
npm run demo:jev
```

The core simulator works without Jev and without an API key.

For a user-selected target, pass the confirmed number explicitly:

```ts
const resolution = await resolveObjective("先嘗試1500分", true, { threshold: 1500 });
const result = recommendCandidates({ state, candidates, objective: resolution.objective });
```

Jev only selects the objective mode; the numeric target stays in code. Missing targets are not replaced with 2700. The included Lv.7 demo remains an explicitly configured 2700-point example. When Jev is requested, a missing API key is an error; select `useJev: false` for local routing. To load a local `.env` when running the Jev demo, use `node --env-file=.env --import tsx src/cli/demo.ts --jev`.

## Add TypeSafe skill to Codex / supported agent

```bash
npx skills add typesafe-ai/skills --skill typesafe-ai
```

The TypeSafe skill specifically recommends keeping known rules/calculations in code and using Jev for typed semantic judgments. This prototype follows that split.

## Important accuracy limits

The recommendation is only as accurate as the future-offer model. The game help publishes category weights, but does not fully prove whether all identities inside a category are equally weighted. `futureOfferModel` therefore remains an explicit assumption.

Yuria's Blessing is intentionally excluded until its exact arithmetic is verified. Sun self-count is configurable because the reference site's reverse engineering marks it as unverified.

## Suggested Codex command

```text
Read AGENTS.md and CODEX_TASK.md. Install dependencies, run all validation commands, then inspect the recommendation engine for incorrect assumptions. Do not replace deterministic probability math with LLM/Jev output. Report changes and test evidence.
```
