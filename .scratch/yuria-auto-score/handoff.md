# Yuria auto-score handoff (2026-09-29)

## Status

- Code is implemented and locally verified on `main` in commit `dabd1435944e64c7a77b4a7a284aef14cf99b4b1`.
- Git publication is requested now; verify the final remote SHA after push. Vercel deployment was explicitly deferred by the latest request.
- Scope: a blank actual-score input records the rounded deterministic model mean in `modelFinalScore`; `actualFinalScore` remains null. Manual corrections can replace the model score with actual evidence. Existing exports remain valid; old records are not backfilled.

## Evidence

- `npm.cmd test -- tests/domain.test.ts tests/real-game-record.test.ts`: 24 passed.
- `npm.cmd run typecheck`: passed.
- `npm.cmd test`: 50 passed, 7 previously skipped.
- `npm.cmd run build`: passed.
- Local browser flow (`tests/real-game-flow.cjs`): passed twice with zero page errors; blank score, correction, and JSON roundtrip covered.
- `git diff --check`: passed.
- Independent subagent review was started but not awaited because the user requested immediate Git handoff; its findings are not included in this acceptance.
- No Vercel deployment, production smoke test, or live cloud-sync test was performed for this change.

## Analysis and next decision

- The 60 historical games are 30 old / 30 new. Old mean 1045.4; new mean about 1009.7 after six user-confirmed calculated scores and one unverified red-random estimate (468 within 450–487). These non-randomized cohorts do not establish a winner.
- For a prospective two-arm comparison, roughly 140–150 games per engine detect a true 200-point mean difference at 80% power and two-sided 5% alpha, assuming the observed pooled standard deviation around 593 remains representative. Around 250 per engine for 150 points. Reassess after a contemporaneous pilot; keep unverified model scores separate from measured outcomes.
- If deployment is requested later: confirm the pushed SHA, deploy this `main` commit using the repository's Vercel workflow, then inspect the live score-recording UI and export semantics.

## Next action

Run `git status --short --branch` and `git ls-remote origin refs/heads/main`; confirm the remote SHA matches the final local SHA. Production remains unchanged until a separate deployment.

## Suggested Skills

- `resume-repository-work` for the next-session Git/workspace audit.
- `vercel:deployments-cicd` only if a deployment is requested.
- `matt-skills-curated:ml-best-practices` when planning the prospective comparison.
