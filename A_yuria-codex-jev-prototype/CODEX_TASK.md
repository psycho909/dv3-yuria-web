# Codex test task

Run this project as a verification prototype, not as a production deployment.

1. Read `AGENTS.md` and `docs/ALGORITHM.md`.
2. Run `npm install`, `npm test`, `npm run typecheck`, and `npm run demo`.
3. Inspect assumptions in `DEFAULT_RULES` before changing scoring behavior.
4. If `TYPESAFE_API_KEY` exists, run `npm run demo:jev`; otherwise do not block validation.
5. Report any mismatch as one of: card data error, score formula error, simulation-policy limitation, unknown game rule, or Jev integration error.

Acceptance condition: all local tests pass, demo returns 3 ranked candidates, and each candidate includes mean score + threshold probability.
