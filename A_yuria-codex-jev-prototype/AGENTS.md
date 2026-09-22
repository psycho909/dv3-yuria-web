# AGENTS.md — Yuria Prototype

## Goal
Build and validate a probability decision engine for Dragon Village Collection 3 — Yuria's Divination.

## Non-negotiable rules
1. Numeric card probabilities and scores are computed in deterministic code. Jev must not invent or override game math.
2. Unknown game rules are represented as explicit assumptions/configuration flags.
3. Recommendation output must show expected score plus probability of reaching a target threshold.
4. Randomized tests must be reproducible with a seed.
5. Keep `src/domain/` independent from UI and AI services.

## Jev / TypeSafe role
Use TypeSafe System One / Jev only for typed semantic decisions, such as mapping a user's natural-language goal to one of:
- `expected_score`
- `threshold_probability`
- `stability`

Do not use Jev to calculate activation probability, card score, color bonus, or final score.

## Validation commands
```bash
npm test
npm run typecheck
npm run demo
```

Optional Jev path:
```bash
TYPESAFE_API_KEY=... npm run demo:jev
```

## TypeSafe skill
Install project-local skill for Codex/other supported agents:
```bash
npx skills add typesafe-ai/skills --skill typesafe-ai
```
Then read the installed skill plus current TypeSafe docs before changing Jev integration code.
