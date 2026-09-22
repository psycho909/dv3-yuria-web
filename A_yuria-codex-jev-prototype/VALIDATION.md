# Validation record

## 2026-09-22 gameplay audit and optimization (current)

Completed reported scores: 748, 972, 1270, 840. Mean 957.5; one of four >=1000; none >=1500. Incomplete games excluded. These are descriptive counts, not a measured long-run policy success probability. Reproduce with `node --import tsx scripts/game-audit.ts`; output is saved to `docs/evidence/optimization-audit.json`.

Classification: simulation-policy limitation and reporting limitation. Color bonuses were already applied, but the future rollout policy ignored the requested objective; all candidates used immediate mean. Now final future choices use exact objective-aware outcome distributions for integer red rolls. Current final-turn recommendations enumerate activation, Tower, Star, and every red roll, eliminating final-turn sampling noise. Earlier future choices remain greedy and unknown offer distributions remain hypotheses. No improved real-game win rate is claimed.

All 22 card details are supplied, including Justice +100%/80%. Tests cover every 2/3/4/5 blue/purple/red tier, failed and removed exclusions, the confirmed 1270 score, both compatible 840 reconstructions, and a final-choice fixture where higher mean has zero hit probability but Tower has 50%. Formatting includes probability, expected score, range and a highest-mean fallback. Sampled zero hits are labeled rather than called impossible.

Validation: npm install succeeded (two moderate dependency audit advisories remain); npm test passed **62 tests / 9 files**; typecheck and selftest passed; local demo and credentialed Jev demo passed. Demo's explicit 2700 example is not the player's current 1500 target. Numerical computation remains local deterministic code.

Older dated records below are historical and may describe superseded behavior.

> **Latest final-turn result:** with Star active, failed High Priestess present, successful Magician present, and Empress removed, Tower/blue ranks first by mean score after all three candidates observed 0/20,000 hits at 1500. Tower now models +200% or +25% branches. The full suite now passes 53 tests. Evidence: `docs/evidence/round-1500-turn-5-star-empress-removed-high-priestess-failed-magician-success.json`.

> **Latest observed final score:** the new game ended at **840** after Star succeeded. The result matches the modeled branch where Star removed World or Justice and the two active red cards rolled +15%: `floor(215 × 3.4 × 1.15) = 840`. Evidence: `docs/evidence/round-1500-new-game-final-star-840.json`.

> **Current new-game turn 1:** with target 1500 and Jev selecting `threshold_probability`, Wheel of Fortune/blue has 15.335%, Emperor/red 15.160%, and Magician/purple 14.700% estimated final-score hit probability using the latest Emperor 80% observation. Evidence: `docs/evidence/round-1500-new-game-turn-1-magician-wheel-emperor.json`.

> **Current new-game turn 3:** after failed Wheel of Fortune/blue and successful Lovers/blue, Strength/blue has 5.620%, Devil/purple 5.130%, and Hierophant/purple 1.930% estimated probability of reaching 1500. This input completes Devil, Hierophant and Lovers; only Justice remains pending in the card catalog.

> **Latest new round:** the 1500-point Jev objective was routed successfully for a fresh turn 1. User-supplied Moon (+20 and +100 per failed card), Wheel of Fortune (+90%), and Empress (+90) were checked against the model. With 20,000 seeded simulations per candidate, Empress/purple has the highest estimated P(final ≥1500): 14.365%. Full evidence: `docs/evidence/round-1500-new-turn-1-moon-wheel-empress.json`.

> **Latest selection 3 result:** Strength +80% and repeated offer colors are now supported; 48 tests pass. The user confirmed acquisition probability means success after clicking, so it is counted once as activation probability. Live Jev selected the 1500-point objective. Under the explicitly assumed independent-uniform future colors, Hanged Man/purple ranks first (2.40% estimated target-hit probability). See the final section and `docs/evidence/round-1500-turn-3.json`.

> **Current active game update:** target remains 1500, with failed blue Chariot selected and Emperor/red, Sun/blue, Temperance/purple offered for selection 2. User-transcribed Emperor 55% and Sun base +40% have been applied; all 45 tests pass. See the final section and `docs/evidence/round-1500-turn-2.json`. Prior numeric outputs are historical under their recorded data versions.

> **Latest status — 748-point screenshot reproduced:** Star is now +240%, and the default modeled removal pool includes failed cards. The observed board reproduces SUM 220, MULT 3.4 and final 748. All 28 tests and required validation commands passed after correction. Uniform removal probabilities and the broader game model remain unverified; earlier numerical outputs below are historical and superseded. See [the evidence record](docs/evidence/score-748.md).

Date: 2026-09-22 (Asia/Taipei). Verification prototype only; no deployment.

**Latest follow-up:** the user selected 1500 points for a new game. The Jev adapter's hardcoded target was removed, 42 tests now pass, and a credentialed live goal-routing call returned `source: jev` with threshold 1500. New first-turn card details have not yet been supplied. See the final section for evidence; the 2700-point tables are explicit demo examples, not the user's active goal.

Actual workspace: `D:\Codex\dv3\A_yuria-codex-jev-prototype`.
The supplied `D:\Codex\dv3\A\_yuria-codex-jev-prototype` path does not exist.
This directory is not a Git repository; no commit or Git diff is claimed.

## Executed evidence

This section records the initial engine inspection before the screenshot correction. Current results appear in the final section below.

Environment: Windows, Node v22.14.0, npm 11.11.1.

| Command | Before changes | After changes |
| --- | --- | --- |
| `npm install` | PASS: 56 packages added; package-lock.json created | Installation retained |
| `npm test` | PASS: 5 tests, 2 files | PASS: 23 tests, 3 files |
| `npm run typecheck` | PASS | PASS |
| `npm run selftest` | PASS | PASS: SELFTEST PASS |
| `npm run demo` | PASS: 3 candidates | PASS: 3 candidates, mean and threshold probability each |
| `npm run demo:local` | PASS: 3 candidates | PASS: 3 candidates |
| Jev demo (`node --env-file=.env --import tsx src/cli/demo.ts --jev`) | Initially skipped: API key absent | PASS after user configured .env; exit 0, Objective source: jev |
| `npm audit --json` | Exit 1: 2 moderate findings (Vitest and @vitest/mocker) | Dependency versions unchanged; not a clean audit |

The dependency findings refer to [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9). The reported fix requires a major Vitest upgrade; no forced upgrade was performed during the engine inspection.

## Corrected simulation-policy limitations

| Finding | Correction and regression evidence |
| --- | --- |
| Future policy treated Tower proc as certain | Average both 50/50 outcomes; a 75-point board evaluates Tower at 150, not 225 |
| Future policy omitted Star removal | Average eligible removals with full score/color recomputation; blue Fool + Strength gives Star immediate value 131 |
| Weighted ranking could let mean override threshold probability or P10 | Lexicographic comparison; tests include a one-in-a-million probability advantage and a large secondary score |
| Candidate index controlled RNG seed | Card/color stream identity; reordered offers retain identical complete metrics |
| Invalid sample counts could yield NaN or misleading probabilities | Reject zero, negative, fractional and non-finite counts; also validate thresholds, turn/history and duplicate identities |

The 18 added tests cover these cases, state immutability, Star's ineligible targets, ranking ties, and an analytically known final-turn distribution (mean and all quantiles 155, hit probability 1, standard deviation 0). Existing four scoring tests and seed-reproducibility test remain passing.

No changes were made to card definitions, final-score math, DEFAULT_RULES, or src/ai/jev.ts. Numerical outcomes remain code-generated with seeded randomness; no LLM/Jev probability substitution was introduced.

## Post-change demo evidence

`npm run demo`: seed 20260922, 12,000 simulations per candidate, local-fallback objective threshold_probability, threshold 2700.

| Rank | Candidate | Mean | P(score >= 2700) | P10 / P50 / P90 |
| --- | --- | --- | --- | --- |
| 1 | 惡魔 (red) | 968.1 | 0.54% | 493 / 847 / 1650 |
| 2 | 隱者 (blue) | 1019.8 | 0.00% | 513 / 928 / 1682 |
| 3 | 正義 (purple) | 958.5 | 0.00% | 467 / 850 / 1522 |

`npm run demo:local`: 4,000 simulations per candidate; means 978.3 / 1013.6 / 959.1 and hit rates 0.45% / 0.00% / 0.00%, in the same rank order. Different sample counts explain the differences. Before/after changes also include a new seed mapping, so numerical changes are not isolated estimates of policy improvement.

### Credentialed Jev follow-up

After the user configured `.env`, ran `node --env-file=.env --import tsx src/cli/demo.ts --jev`. This invokes the same entry point and flag as `npm run demo:jev`, with explicit environment-file loading (the npm script does not load `.env` itself).

The non-empty key check passed without printing the key. The live command exited 0 and reported `Objective source: jev` and `{"kind":"threshold_probability","threshold":2700}`. All three displayed means, threshold probabilities and P10/P50/P90 values matched the 12,000-simulation local-fallback table above. Jev selected the semantic objective; the deterministic seeded domain engine continued to compute the numeric results.

This validates one live 2700-point goal end to end, not all semantic goals, thresholds, network failure modes or model consistency. No integration code was changed for this follow-up.

## Inspection classification and remaining limits

- **Card data error:** no mismatch found in the 22 activation probabilities/base effects exposed on the [reference calculator](https://dv3ex.dv3ex3.workers.dev/yuria/), read on 2026-09-22. This is the fan calculator's published analysis, not independent game validation.
- **Score formula error:** no confirmed mismatch found in the documented score structure, World target scope, failed-card handling, or removal/color handling. The source's six real-game cases were not supplied and were not reproduced locally.
- **Simulation-policy limitation:** corrected issues above; future choices still optimize immediate mean for every objective. Red midpoint evaluation is approximate after flooring. Finite Monte Carlo samples, especially rare events, do not establish optimality or impossibility.
- **Unknown game rule:** category weights, within-category uniformity, one card per color, redraw/exclusion behavior, independence, red-roll distribution and Sun self-count remain assumptions. Blessing remains disabled. These are documented in ALGORITHM.md and relevant assumptions appear in recommendation output; DEFAULT_RULES was inspected and preserved.
- **Jev integration error / limitation:** static inspection shows the adapter always assigns 2700 to threshold goals, even when a different target is requested. The demo's 2700 goal passed the credentialed live test above; arbitrary language-specified thresholds remain unsupported. Integration code was not changed.

Acceptance condition met locally: all local tests pass; demo returns three ranked candidates with mean scores and threshold probabilities. The optional live Jev demo also passed after credentials were configured. Game-model uncertainties, dependency audit findings and broader semantic-adapter validation remain open.

## User-reported 748-point discrepancy (initial investigation, superseded below)

Reported board: Devil / blue / failed; High Priestess / blue / active; Fool / blue / active; Hierophant / blue / failed; Star / purple / active. Reported final score: **748**. Star's actual removal target and whether Blessing or another modifier was active have not been confirmed; no result screenshot has been supplied.

Executed `node --import tsx scripts/repro-score-748.ts`: **FAIL (exit 1)**, intentionally detecting that 748 is outside every modeled removal outcome. Removing High Priestess gives SUM 115, multiplier 3.5, final 402. Removing Fool gives SUM 125, multiplier 3.5, final 437. Neither outcome has a random red bonus, so this discrepancy is not Monte Carlo sampling error.

Provisional classification: **unknown game rule or missing state**; card-data and scoring-formula errors cannot yet be distinguished. This diagnostic is separate from the passing unit suite and is not a claim that a fully specified 748-point game fixture has been obtained. Numeric rules and Jev integration remain unchanged. Next evidence needed: the final board/score screenshot and visible effect details, especially the removed card and Blessing status.

## Screenshot correction: current validation

The supplied image resolves the displayed multiplier: Star is +240%, not the reference-derived +250%. The crossed-out failed Hierophant and retained High Priestess/Fool are consistent with failed-card removal. Removing Hierophant's compensation gives 220, and multiplying by 3.4 gives 748 exactly. Classification: **card data error** (Star multiplier) plus **simulation-policy limitation** (excluding failed removal targets). The complete probability law for removals remains an **unknown game rule**.

Changed files: `src/domain/cards.ts`, `src/domain/scoring.ts`, `src/domain/types.ts`, `src/domain/simulation.ts`, related regression tests, the screenshot replay script and documentation/evidence. Jev integration remains unchanged. Shared removal eligibility prevents the rollout approximation and actual simulations from diverging on failed-card handling.

| Command | Result after screenshot correction |
| --- | --- |
| `npm test` | PASS: 28 tests in 4 files |
| `npm run typecheck` | PASS |
| `npm run selftest` | PASS |
| `node --import tsx scripts/repro-score-748.ts` | PASS: SUM 220, MULT 3.4, final 748 |
| `npm run demo` | PASS: three candidates, mean and threshold probability each |
| `npm run demo:local` | PASS |
| `node --env-file=.env --import tsx src/cli/demo.ts --jev` | PASS: Objective source jev; threshold_probability at 2700 |

Current 12,000-simulation demo (seed 20260922); local and Jev paths produced identical displayed numeric metrics:

| Candidate, in rank order | Mean | P(score >= 2700) | P10 / P50 / P90 |
| --- | --- | --- | --- |
| Devil / red | 978.3 | 0.49% | 494 / 864 / 1664 |
| Hermit / blue | 1025.1 | 0.00% | 513 / 930 / 1696 |
| Justice / purple | 956.5 | 0.00% | 475 / 850 / 1510 |

The 4,000-simulation local demo gives means 994.8 / 1015.9 / 956.0 and hit rates 0.57% / 0.00% / 0.00% in the same order. Dependency versions did not change; the earlier audit findings were not fixed or re-audited here. No deployment occurred.

The single screenshot is now reproduced, but it does not establish uniform removal weights, every card rule, or calibration of the recommendation probabilities. Next-round card descriptions should be compared to the current model before numerical recommendations. Per the user's request, the next round should actually invoke Jev for semantic objective routing while retaining deterministic numerical computation.

## Fresh 1500-point round: Moon, Wheel of Fortune, Empress

The user started a new turn 1 with no selected cards and supplied:

| Candidate | Color | Effect | Success after selection |
| --- | --- | --- | ---: |
| Moon | blue | +20 score; +100 per present failed card | 80% |
| Wheel of Fortune | red | +90% multiplier | 90% |
| Empress | purple | +90 score | 85% |

The user previously clarified that this percentage means success after clicking; it is applied once as `activationProbability`. Jev was called with the explicit goal “increase the chance of final score >=1500”; it returned `source: jev` and `threshold_probability` at 1500. Numeric results remained in the deterministic simulator.

Card-data verification passed for all supplied fields. The Moon rule was changed from the prior +80-per-failure assumption to +100 and covered by a new regression test. Wheel's +90% value was already present and is now documented as user-confirmed data. `npm test` passed 50 tests in 7 files and `npm run typecheck` passed before this run; the full validation commands were rerun after the change.

| Rank | Candidate | Mean final score | P(final >=1500) | P10 / P50 / P90 |
| --- | --- | ---: | ---: | --- |
| 1 | **Empress / purple** | 1008.58505 | **14.365%** | 470 / 930 / 1659 |
| 2 | Moon / blue | **1045.91045** | 13.305% | **503 / 1020 / 1596** |
| 3 | Wheel of Fortune / red | 956.64225 | 12.515% | 418 / 866 / 1609 |

Because the active objective is target probability, Empress ranks first even though Moon has the highest mean. The top two hit-rate estimates differ by 1.06 percentage points; future-offer and special-card assumptions remain more material than this rounding-level difference. Saved complete request, Jev routing, card-data check, rules and seeded metrics to [round-1500-new-turn-1-moon-wheel-empress.json](docs/evidence/round-1500-new-turn-1-moon-wheel-empress.json).

## Final turn: Tower, World, Strength

The user reported the complete history: Empress/purple failed and was removed by successful Star/blue; High Priestess/blue failed; Magician/blue succeeded. Candidates were Tower/blue (100%, +200% or +25% multiplier at 50% each), World/purple (50%, twice the highest active score card), and Strength/red (100%, +80%). Card-data checks passed, including the new Tower fallback branch.

Jev returned `source: jev` with the explicit 1500 threshold. With no future turn remaining, 20,000 seeded simulations produced 0 observed hits for every candidate, so the deterministic comparator used mean score as the tie-breaker:

| Candidate | Mean | P(final >=1500) | P10 / P50 / P90 |
| --- | ---: | ---: | --- |
| **Tower / blue** | **813.38175** | 0 observed hits | 657 / 657 / 972 |
| World / purple | 783.3566 | 0 observed hits | 544 / 1020 / 1020 |
| Strength / red | 588 | 0 observed hits | 588 / 588 / 588 |

Tower's two modeled final scores are 657 and 972; its simulated mean varies slightly around the exact 50/50 mean because the run is finite. World yields 544 when it fails and 1020 when it succeeds under the current score formula. A zero hit rate is not a proof of impossibility, although these final-turn outcomes are bounded below 1500 under the stated model. Saved full input and output to [round-1500-turn-5-star-empress-removed-high-priestess-failed-magician-success.json](docs/evidence/round-1500-turn-5-star-empress-removed-high-priestess-failed-magician-success.json).

After updating the former Tower regression expectation to include the observed +25% fallback and adding the special-effect registry check, `npm test` passed 53 tests in 8 files; `npm run typecheck` and `npm run selftest` also passed. The card completeness table is recorded in `docs/CARD_CATALOG.md`: 21 of 22 cards have user-confirmed complete details, with only Justice still pending.

The user then reported the actual Tower result as **972**. This matches the predicted +200% branch exactly: SUM 180 × MULT 5.4 = 972. The observed branch is recorded in the evidence JSON as `MATCHED_GAME_RESULT`; this validates the Tower branch for this board, not every future card combination.

## Explicit 1500-point goal and live Jev preparation

User goal: `先嘗試1500分，準備開始第一輪並啟動Jev`.

Installed the project-local TypeSafe skill using `npx --yes skills add typesafe-ai/skills --skill typesafe-ai --agent codex --yes` and read `.agents/skills/typesafe-ai/SKILL.md`. Consulted current official [JavaScript SDK](https://docs.typesafe.ai/sdk/javascript) and [Choice](https://docs.typesafe.ai/primitives/choice) documentation; the Markdown/index endpoints were unavailable through the web tool, so normal documentation pages were used.

Changed `src/ai/jev.ts` to take explicit numeric target options, remove the silent 2700 fallback, reject missing/invalid targets for threshold mode, and report missing Jev credentials instead of silently switching sources. `src/cli/demo.ts` now supplies its sample 2700 target explicitly. Added 14 adapter regression tests, including 1500/2000/2500/3000 preservation, missing/invalid targets, non-threshold objectives and missing credentials. Numerical scoring and simulation code were not changed in this follow-up.

Executed `npm test` (42 tests in 5 files PASS), `npm run typecheck` (PASS), `npm run demo` (PASS), `npm run selftest` (PASS), and the 748-point screenshot replay (PASS). A live call through `resolveObjective(goal, true, { threshold: 1500 })`, with `.env` explicitly loaded, exited 0 and returned:

```json
{"objective":{"kind":"threshold_probability","threshold":1500},"source":"jev"}
```

Saved timestamped response evidence to [jev-target-1500.json](docs/evidence/jev-target-1500.json). Any choice probabilities in that file are semantic routing probabilities, not chances of scoring 1500. No new first-round candidate recommendation was generated because the new cards are not yet known. Subsequent recommendations must use this 1500-point goal and newly supplied card details, not the previous game's offers.

## Active 1500-point game: selection 2 and current card details

The user reported failed blue Chariot plus a new offer: Emperor/red/+95/55%, Sun/blue/base +40% plus +40% per active card/50%, Temperance/purple/+120%/60%. The user called this turn 1, but the next selection is turn 2 because one card is already selected. The probability column was interpreted as activation probability, consistent with prior inputs; these latest card values are user transcription, not screenshot verification.

Changed Emperor activation from 0.80 to 0.55 and Sun base multiplier from 0.3 to 0.4, storing Sun's base in card data. Temperance, blue and purple tier tables already matched. The stated red ranges also match; whether red applies to SUM or MULT is not resolved by this text. The existing single final multiplier is algebraically equivalent if no intermediate rounding occurs; red uniformity and rounding remain assumptions.

Three new regression tests initially failed (Sun multipliers 2.1/1.7 instead of 2.2/1.8; sampled Emperor activation 0.8056 instead of approximately 0.55). After correction, `npm test` passed all 45 tests in 6 files; `npm run typecheck`, `npm run demo` and `npm run selftest` passed. The screenshot 748 regression remains included in the passing suite. No Jev arithmetic was introduced.

A credentialed Jev call returned `source: jev`, objective `threshold_probability`, threshold 1500. Each candidate was simulated 20,000 times with seed 20260922 under both Sun self-count settings:

| Candidate | P >=1500, Sun counts itself | Mean, Sun counts itself | P >=1500, Sun excludes itself | Mean, Sun excludes itself |
| --- | --- | --- | --- | --- |
| Sun / blue | 7.245% | 785.84575 | 4.435% | 723.4219 |
| Temperance / purple | 2.36% | 685.2073 | 2.225% | 680.57315 |
| Emperor / red | 2.27% | 666.89465 | 1.98% | 661.0497 |

Sun ranks first under both modeled assumptions. This robustness check does not establish which self-count rule the game uses or calibrate the probabilities. Saved complete input, current candidate definitions, both outputs and routing evidence to [round-1500-turn-2.json](docs/evidence/round-1500-turn-2.json).

## Selection 3: Strength and repeated-color correction

Current history: blue Chariot failed; blue Sun failed. Current candidates: Strength/blue/+80%/100%, Hermit/purple/+130/60%, Hanged Man/purple/+140/55%. The percentages are transcribed as card acquisition rates. Their timing (after selection success versus before selection offer appearance) is still being clarified; no current candidate probabilities are published yet.

Applied the independently specified Strength multiplier correction from 0.7 to 0.8. The duplicate purple candidates invalidate the fixed one-of-each-color assumption. Current colors already pass through unchanged; future simulation now has explicit `futureColorModel: independentUniform` (default) or `oneEach` (historical comparison). Independent, uniformly distributed colors are a provisional simulation hypothesis, not inferred empirical odds from a single repeated-color offer. Both future category/identity weights and color correlations remain unknown.

Updated scoring/selftest expectations for Strength and added three tests for duplicate future colors, explicit former-color mode, and preservation of same-colored current offers. `npm test` passed 48 tests in 7 files; `npm run typecheck`, `npm run demo`, and `npm run selftest` passed. The new generic demo differs from earlier evidence because card data and future-color sampling changed. Its explicit 2700-point sample is not the active user's 1500-point target.

### Acquisition timing confirmed and recommendation completed

The user clarified: after clicking Hermit, there is 60% success acquiring it and 40% failure. Therefore the existing `activationProbability` is the appropriate event probability and must not be multiplied by a second acquisition rate. Future appearance frequencies remain a separate, unknown distribution.

During this turn, a credentialed Jev call returned `source: jev`, objective threshold_probability, target 1500. After clarification, its numeric target was reused with the user's supplied success probabilities. A seeded run of 20,000 simulations per candidate returned:

| Candidate | Mean final score | P(final >=1500) | P10 / P50 / P90 |
| --- | --- | --- | --- |
| Hanged Man / purple | 578.0441 | 2.40% | 204 / 510 / 1012 |
| Hermit / purple | 576.15285 | 1.765% | 204 / 551 / 986 |
| Strength / blue | 522.11085 | 0 observed hits | 204 / 564 / 813 |

The supplied duplicate purple colors were preserved. Future-color sampling is still the explicitly unverified independent-uniform model. A zero observed hit rate is not an impossibility proof. Saved full input, rules, objective-resolution response and numeric result to [round-1500-turn-3.json](docs/evidence/round-1500-turn-3.json). The earlier pending file records the pre-clarification state only.
