import { describe, expect, it } from "vitest";
import {
  canonicalJson, createGameRecord, ENGINE_VERSION, exportEnvelope, gamesNeedingUpload, isValidGameRecord, mergeGames, parseExport, sameGameRecord,
  summarizeRealGames, type RealGameRecordV1, type RealRound
} from "../src/real-game-record";
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
    expect(isValidGameRecord(starGame("b-deterministic-2026-09-28-one-each-color"))).toBe(false);

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

// Postgres jsonb returns object keys ordered by length, then bytewise. This mimics a row read back from Supabase.
const jsonbOrder = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(jsonbOrder);
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(keys.map(key => [key, jsonbOrder((value as Record<string, unknown>)[key])]));
  }
  return value;
};
const fromCloud = (game: RealGameRecordV1) => jsonbOrder(JSON.parse(JSON.stringify(game))) as RealGameRecordV1;
const recordedAt = (score: number | null, updatedAt: string, revision = 0): RealGameRecordV1 => ({ ...recorded(score), updatedAt, revision });

describe("cloud merge", () => {
  it("treats a jsonb-reordered copy of the same version as the same game", () => {
    const game = recorded(840);
    const copy = fromCloud(game);
    expect(JSON.stringify(copy)).not.toBe(JSON.stringify(game));
    expect(sameGameRecord(copy, game)).toBe(true);
    expect(sameGameRecord({ ...copy, revision: 1 }, game)).toBe(false);
    expect(sameGameRecord({ ...copy, actualFinalScore: 900 }, game)).toBe(false);
    expect(canonicalJson({ b: [2, 1], a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":[2,1]}');
  });

  it("adds cloud-only games, takes newer cloud revisions, and never overwrites conflicts or newer local corrections", () => {
    const synced = recordedAt(840, "2026-09-20T00:00:00.000Z");
    const localOnly = recordedAt(null, "2026-09-21T00:00:00.000Z");
    const cloudOnly = recordedAt(972, "2026-09-22T00:00:00.000Z");
    const correctedHere = recordedAt(1270, "2026-09-23T00:00:00.000Z", 2);
    const correctedThere = recordedAt(748, "2026-09-24T00:00:00.000Z");
    const conflict = recordedAt(1648, "2026-09-25T00:00:00.000Z", 1);
    const cloud = [
      fromCloud(synced),
      fromCloud(cloudOnly),
      fromCloud({ ...correctedHere, revision: 1, actualFinalScore: 1200 }),
      fromCloud({ ...correctedThere, revision: 1, actualFinalScore: 750, updatedAt: "2026-09-26T00:00:00.000Z" }),
      fromCloud({ ...conflict, actualFinalScore: 1600 })
    ];

    const merge = mergeGames([synced, localOnly, correctedHere, correctedThere, conflict], cloud);
    const merged = new Map(merge.games.map(game => [game.id, game]));

    expect(merge.toStore.map(game => game.id).sort()).toEqual([cloudOnly.id, correctedThere.id].sort());
    expect(merge.conflictIds).toEqual([conflict.id]);
    expect(merge.games).toHaveLength(6);
    expect(merge.games[0]!.id).toBe(correctedThere.id);
    expect(merged.get(correctedThere.id)!.actualFinalScore).toBe(750);
    expect(merged.get(correctedHere.id)!.revision).toBe(2);
    expect(merged.get(conflict.id)!.actualFinalScore).toBe(1648);

    const cloudRevisions = new Map(cloud.map(game => [game.id, game.revision]));
    const pending = gamesNeedingUpload(merge.games, cloudRevisions, new Set(merge.conflictIds));
    expect(pending.map(game => game.id).sort()).toEqual([localOnly.id, correctedHere.id].sort());
  });

  it("never lists drafts for upload", () => {
    expect(gamesNeedingUpload([createGameRecord(20260922, 10000)], new Map())).toEqual([]);
  });
});
