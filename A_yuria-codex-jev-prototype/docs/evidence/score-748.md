# Star: 748-point screenshot evidence

Date: 2026-09-22. Source: user-supplied game screenshot, copied unchanged to [score-748.png](score-748.png).
Original: `C:\Users\chingchen\Downloads\Image_20260922_103041_431.png`.
SHA256: `AB4045E3FD6DF57EA715BDBC37AA3A8CD92E582AC7DB64D2FD40A49575067D24`.

## Direct observations

The screenshot shows score 220, multiplier 340%, final score 748. Star's card label reads +240%. High Priestess (+85) and Fool (+75) remain visible; Hierophant (+100) has a red cross; Devil (+150) is dim. A Blessing prompt is visible but does not by itself prove any Blessing modification has occurred.

The user's preceding turn reports Devil failed, High Priestess succeeded, Fool succeeded, and Hierophant failed before choosing Star. This history distinguishes failure from the later red-cross removal marker.

## Reconstruction and limits

Treating Hierophant as removed, while retaining failed Devil's 20-point compensation, gives:

```text
SUM = 85 + 75 + 20 + 40 (two active blue cards) = 220
MULT = 1 + 2.4 = 3.4
RED = 0
floor(220 * 3.4) = 748
```

This matches every displayed score field without an additional Blessing operation. Interpreting the cross as removal is supported by the screenshot, prior card history and score reconstruction; the screenshot alone does not supply the full written Star rules. Star's +240% label directly contradicts the source-derived +250% constant.

Diagnostic probes before repair:

| Modeled removal | SUM | Old multiplier 3.5 | Displayed multiplier 3.4 |
| --- | --- | --- | --- |
| None | 240 | 840 | 816 |
| High Priestess | 115 | 402 | 391 |
| Fool | 125 | 437 | 425 |
| Failed Hierophant | 220 | 770 | 748 |

Changing only the multiplier cannot reproduce the result under active-only removal. Changing only target eligibility still gives the wrong displayed multiplier and 770. Both corrections are needed for this reconstruction. Failure compensation already disappears for removed cards in the existing score function, so that implementation was retained.

## Corrections and reproducible tests

Star card data now holds multiplierValue 2.4. Scoring consumes that value. DEFAULT_RULES now explicitly selects `starRemovalPolicy: uniformPresent`; the previous `uniformActive` mode is retained for comparison. A shared eligibility function supplies both stochastic selection resolution and one-step rollout estimates.

Uniform probability over eligible targets is still an assumption. Under that assumption, this pre-Star board has outcomes 748 / 391 / 425 / 748 (removing Devil / High Priestess / Fool / Hierophant), mean 578. These probabilities and that mean are model outputs, not measured frequencies from this one screenshot. Future-offer rules, Star's published activation probability, other specials and Blessing still need independent verification.

`npm test -- tests/star-game-evidence.test.ts` first failed all three initial regression tests: displayed multiplier 3.5 versus 3.4, expected rollout 419.5 versus 578, and sampled mean 419.654 outside the assumed revised distribution. After the fix, the expanded file has five passing tests, including the former-policy comparison and empty-target handling.

`node --import tsx scripts/repro-score-748.ts` now asserts all three displayed values and prints `SCREENSHOT 748 REGRESSION PASS`. The full suite passes 28 tests. Typecheck, selftest, local demos and the credentialed Jev demo also passed. See VALIDATION.md for the current demo outputs.

Earlier recommendations and probabilities were generated with the superseded Star model and must not be reused as current numerical evidence. This correction validates one observed board, not the accuracy of every recommendation.
