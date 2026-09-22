# Algorithm notes — test prototype

## 1. Core score model

Current reverse-engineered structure:

```text
FinalScore = floor(SUM × MULT × (1 + RED_BONUS))
```

`SUM` contains successful score-card values, failed-card minimum compensation, blue color bonus, Moon effect and World effect.

`MULT` is `1 +` the sum of successful multiplier-card values, purple bonus and multiplier-type special effects. Multiplier cards are additive, not multiplicative with one another.

The source site states that this structure, failed-card handling, removal behavior, World target scope, and color-tier behavior were checked against six real game cases. The Sun self-count behavior remains unverified.

The five currently known special effects are executable data on `CardDefinition.specialEffect` and are consumed by `src/domain/scoring.ts`: Tower branch roll, Star removal, Moon failed-card score, Sun active-card multiplier, and World highest-score doubling. The user-confirmed card coverage is tracked in [the card catalog](CARD_CATALOG.md); all 22 cards have supplied details, including Justice +100% at 80% acquisition.

**2026-09-22 local game evidence supersedes the source for Star:** the supplied screenshot shows Star +240% and a crossed-out Hierophant that the user reported had already failed. Modeling that failed card as removed yields SUM 220, MULT 3.4 and final score 748, matching all displayed fields. Star's multiplier is now 2.4 in card data. The default removal policy includes other present cards, including failed cards, and excludes already removed cards and Star itself. See [the evidence record](evidence/score-748.md) for observations versus assumptions. This single case does not validate the entire model.

## 2. Monte Carlo recommendation

For each of the 3 current candidates:

1. Simulate activation according to that card's activation probability.
2. Apply stochastic special-card behavior such as Tower and Star.
3. Generate future offers until turn 5 using the published category weights.
4. For the final future selection with integer-percent red rolls, enumerate the entire outcome distribution and choose by the requested objective. Earlier future selections still use a cheap one-step mean-score policy with midpoint red bonus.
5. Calculate the final score and repeat N times.

Outputs:
- mean final score
- P10 / P50 / P90
- standard deviation
- P(final score >= target)

When a threshold objective produces zero sampled hits for every candidate, the result keeps the candidates ranked by expected final score and exposes `selectionMode: "highest_expected_score_fallback"`. This gives the player an actionable highest-score choice instead of returning three equivalent zeroes. The score shown for this fallback is the Monte Carlo mean final score, not a guaranteed maximum.

This prototype is a **Monte Carlo rollout policy**, not exact full Expectimax. Production should compare it against a deeper Expectimax / MCTS implementation once future-offer generation is empirically confirmed.

The final future selection now follows the requested objective. Earlier future choices remain greedy by immediate mean, so this is still not globally optimal. Threshold ranking compares hit probability first, then mean; stability compares P10 first, then mean minus standard deviation. These are lexicographic priorities, not weighted sums.

Current turn 5 with integer-percent red rolls uses an exact weighted distribution over acquisition, Tower branches, Star removal targets, and every red percentage. Metrics report `calculationMethod: exact`, zero simulations, exact model support min/max, and weighted quantiles. Earlier turns and continuous-red mode use seeded Monte Carlo; their min/max are only sampled extrema. The shared CLI formatter distinguishes sampled zero hits from exact model zero and always displays expected final score and recommendation. Exact means exact under configured rules, not proof that those rules match the game.

Candidate random streams are keyed by card identity and color: rearranging an offer does not change its metrics. A seed makes simulation reproducible, not exact. Zero observed hits is not proof that a threshold is unreachable.

## 3. Known assumptions

- The user reported a blue/purple/purple offer, contradicting exactly one card per color. `futureColorModel` now defaults to `independentUniform`: each future slot samples a color independently and uniformly. This supports repeated colors but its distribution is unverified. `oneEach` remains available only for comparison with the superseded model. Current supplied colors are used as given.
- Published category weights are used; within each category, remaining card identities are assumed uniform.
- Red bonus is modeled as an integer percentage uniformly sampled inside the published range.
- New observed final score 1648 on a two-red board implies approximately +18.221% under SUM 340 and MULT 4.1. This falls inside the stated +10%～+20% range but is not an integer-percent outcome (integer +18% gives 1644; +19% gives 1658). Continuous red rolls or an intermediate rounding rule are now explicit competing hypotheses; the reproducible integer mode remains default until more observations distinguish them.
- Sun currently counts itself as an active card; this is configurable.
- User-transcribed details on 2026-09-22 supersede the source defaults for Emperor. The latest Emperor observation is 80% activation (an earlier 55% observation remains historical), while Sun is base +40% plus +40% per active card. These details have not yet been screenshot-verified. The user's column titled acquisition probability is interpreted as activation probability, consistent with prior inputs. Sun self-count remains unconfirmed; both variants were compared for the current recommendation.
- Later user transcription reports Strength +80% (formerly +70%); this value is now used. The user confirmed that acquisition probability is the chance of success after clicking the selected card (for example, Hermit 60% success / 40% failure). It maps to `activationProbability` once, not a second independent probability. It does not describe appearance frequency in future offers.
- Current user transcription reports Moon +20 base score and +100 for each failed card (the earlier source-derived implementation used +80); the updated value is applied once per present failed card. Wheel of Fortune is +90% and is stored as 0.9. These latest details are user observations, not independently screenshot-verified.
- Current user transcription reports Tower as always acquired, then +200% multiplier with 50% probability or +25% multiplier with 50% probability. Both branches are modeled; the fallback branch is no longer treated as zero effect. This value is user-provided and not independently screenshot-verified.
- Yuria's Blessing is not modeled because the exact mathematical effect of “one digit increases by 1” is not sufficiently specified for a reliable implementation.
- Selected identities, including failed and removed cards, are excluded from future offers. Offers contain distinct identities; unchosen cards may reappear. These deck rules remain unverified.
- Empty category draws are retried up to 20 times, then fall back to uniform remaining-card selection. This is a simulation policy, not a verified game rule.
- Activations, Tower proc, removal target and red rolls use independent RNG draws; correlations and hidden state are not modeled.
- `starRemovalPolicy` defaults to `uniformPresent`: other present cards, including failures, are eligible. The screenshot supports failed-card eligibility but does not prove uniform selection or the full target pool. `uniformActive` retains the earlier active-only assumption for comparison; it does not reproduce this observed removal. Both rollout estimation and simulation use the same eligibility function.

`GameState.turn` is the next selection turn; history retains exactly `turn - 1` cards, including removed cards. Simulation counts must be positive safe integers. Caller-supplied rule overrides are assumptions, not evidence of game rules.

## 4. Jev role

Jev is useful here for semantic intent routing, not arithmetic. Example:

```text
「我今天只差一場就想拚 Lv.7」
        ↓
Jev Choice
        ↓
threshold_probability
        ↓
Numeric engine ranks candidates by P(score >= 2700)
```

The user's natural-language intent becomes a typed objective. All numeric probabilities are produced by code.

The semantic adapter now receives the user-selected target explicitly: `resolveObjective(goalText, true, { threshold: 1500 })`. Jev selects the objective mode, while deterministic code retains and validates that numeric target. A threshold objective without an explicit target raises an error instead of assuming 2700. Natural-language text alone is not parsed for arbitrary score values; the caller must pass the confirmed score in options. The bundled Lv.7 demo explicitly supplies 2700 only for its own example.

When Jev is requested, missing credentials produce an error rather than silently falling back. `useJev: false` explicitly selects the local router. Jev's choice probabilities describe semantic confidence, not game-event probabilities. On 2026-09-22 a live call for the user's new 1500-point goal returned `source: jev` and `{ kind: "threshold_probability", threshold: 1500 }`; see [routing evidence](evidence/jev-target-1500.json). This call does not imply any game target-hit probability.

## 5. Data source

Reference calculator:
https://dv3ex.dv3ex3.workers.dev/yuria/

TypeSafe skill:
https://github.com/typesafe-ai/skills
