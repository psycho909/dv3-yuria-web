import { describe, expect, it } from "vitest";
import { createGameRecord, ENGINE_VERSION, exportEnvelope, isValidGameRecord, parseExport, summarizeRealGames, type RealGameRecordV1, type RealRound } from "../src/real-game-record";
import type { CardId } from "../src/domain";

const ids: CardId[] = ["fool", "magician", "empress", "emperor", "hermit"];
const round = (turn: number): RealRound => ({
  turn,
  offers: null,
  objective: { kind: "threshold", target: 1500 },
  target: 1500,
  recommendedCardId: null,
  predictions: null,
  chosen: { cardId: ids[turn - 1]!, color: "blue" },
  activated: turn % 2 === 1,
  towerProc: null,
  starRemovedCardId: null
});
const recorded = (score: number | null): RealGameRecordV1 => ({
  ...createGameRecord(20260922, 10000),
  status: "recorded",
  completedAt: new Date().toISOString(),
  rounds: ids.map((_, index) => round(index + 1)),
  actualFinalScore: score,
  evidenceLevel: score === null ? null : "player_report"
});
const starGame = (engineVersion = ENGINE_VERSION): RealGameRecordV1 => {
  const game = recorded(null);
  game.engineVersion = engineVersion;
  game.rounds = [
    { ...round(1), chosen: { cardId: "star", color: "blue" }, activated: true },
    { ...round(2), chosen: { cardId: "fool", color: "blue" }, activated: true },
    { ...round(3), chosen: { cardId: "magician", color: "blue" }, activated: false },
    { ...round(4), chosen: { cardId: "empress", color: "blue" }, activated: true },
    { ...round(5), chosen: { cardId: "emperor", color: "blue" }, activated: true }
  ];
  return game;
};

describe("real game record", () => {
  it("keeps an unsubmitted run as a draft and permits an optional actual score", () => {
    const draft = createGameRecord(20260922, 10000);
    draft.rounds = [round(1)];
    expect(isValidGameRecord(draft)).toBe(true);
    expect(isValidGameRecord(recorded(null))).toBe(true);
    expect(isValidGameRecord(recorded(840))).toBe(true);
    expect(isValidGameRecord({ ...recorded(null), completedAt: null })).toBe(false);
  });

  it("rejects invented candidate and special-card evidence", () => {
    const game = recorded(840);
    game.rounds[0]!.offers = [
      { cardId: "fool", color: "blue", catalogProbability: 1, observedProbability: null },
      { cardId: "magician", color: "purple", catalogProbability: .95, observedProbability: null },
      { cardId: "empress", color: "red", catalogProbability: .85, observedProbability: null }
    ];
    expect(isValidGameRecord(game)).toBe(true);
    game.rounds[0]!.chosen.cardId = "tower";
    expect(isValidGameRecord(game)).toBe(false);
    game.rounds[0]!.chosen.cardId = "fool";
    game.rounds[0]!.towerProc = true;
    expect(isValidGameRecord(game)).toBe(false);
  });

  it("uses the new engine version and validates deferred Star targets in complete records", () => {
    expect(createGameRecord(20260922, 10000).engineVersion).toBe(ENGINE_VERSION);

    const valid = starGame();
    valid.rounds[0]!.starRemovedCardId = "emperor";
    expect(isValidGameRecord(valid)).toBe(true);

    const missingTarget = starGame();
    expect(isValidGameRecord(missingTarget)).toBe(false);
    expect(isValidGameRecord(starGame("b-deterministic-2026-09-28-star-after-fifth"))).toBe(false);

    const selfTarget = starGame();
    selfTarget.rounds[0]!.starRemovedCardId = "star";
    expect(isValidGameRecord(selfTarget)).toBe(false);

    const outsideTarget = starGame();
    outsideTarget.rounds[0]!.starRemovedCardId = "world";
    expect(isValidGameRecord(outsideTarget)).toBe(false);

    const inactiveTarget = starGame();
    inactiveTarget.rulesSnapshot = { ...inactiveTarget.rulesSnapshot, starRemovalPolicy: "uniformActive" };
    inactiveTarget.rounds[0]!.starRemovedCardId = "magician";
    expect(isValidGameRecord(inactiveTarget)).toBe(false);

    const invalidRevision = starGame();
    invalidRevision.revisions = [{ at: new Date().toISOString(), previousScore: null, previousRounds: structuredClone(invalidRevision.rounds) }];
    invalidRevision.revisions[0]!.previousRounds[0]!.starRemovedCardId = "star";
    expect(isValidGameRecord(invalidRevision)).toBe(false);
  });

  it("allows a new-version active Star to have no target when no legal target exists", () => {
    const game = starGame();
    game.rulesSnapshot = { ...game.rulesSnapshot, starRemovalPolicy: "uniformActive" };
    game.rounds.forEach((currentRound, index) => { if (index > 0) currentRound.activated = false; });
    expect(isValidGameRecord(game)).toBe(true);
  });

  it("keeps legacy records readable under their existing target constraints", () => {
    const legacy = starGame("b-deterministic-2026-09-23");
    legacy.rounds[0]!.starRemovedCardId = "world";
    expect(isValidGameRecord(legacy)).toBe(true);
    expect(parseExport(exportEnvelope([legacy]))).toEqual([legacy]);
  });

  it("imports only recorded real games and counts optional scores separately", () => {
    const scored = recorded(840);
    const unscored = recorded(null);
    unscored.id = crypto.randomUUID();
    expect(parseExport(exportEnvelope([scored, unscored]))).toHaveLength(2);
    expect(() => parseExport(exportEnvelope([createGameRecord(1, 10000)]))).toThrow();
    expect(() => parseExport(exportEnvelope([scored, scored]))).toThrow();
    const summary = summarizeRealGames([scored, unscored]);
    expect(summary.recordedCount).toBe(2);
    expect(summary.scoredCount).toBe(1);
    expect(summary.averageScore).toBe(840);
    expect(summary.clickCounts.get("fool")).toEqual({ success: 2, total: 2 });
  });

  it("keeps a blank-input model score separate from verified actual scores", () => {
    const auto = recorded(null);
    auto.modelFinalScore = 468;
    expect(isValidGameRecord(auto)).toBe(true);
    expect(parseExport(exportEnvelope([auto]))).toEqual([auto]);
    const summary = summarizeRealGames([auto, recorded(840)]);
    expect(summary.recordedCount).toBe(2);
    expect(summary.scoredCount).toBe(1);
    expect(summary.modelScoredCount).toBe(1);
    expect(summary.averageScore).toBe(840);
    expect(summary.modelAverageScore).toBe(468);
    expect(summary.residualCount).toBe(0);
    const legacy = { ...auto };
    delete legacy.modelFinalScore;
    expect(parseExport(exportEnvelope([legacy]))).toEqual([legacy]);
    expect(isValidGameRecord({ ...auto, modelFinalScore: -1 })).toBe(false);
    expect(isValidGameRecord({ ...auto, actualFinalScore: 468, evidenceLevel: "player_report" })).toBe(false);
  });
});
