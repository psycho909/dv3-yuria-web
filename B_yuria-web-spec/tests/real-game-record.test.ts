import { describe, expect, it } from "vitest";
import { createGameRecord, exportEnvelope, isValidGameRecord, parseExport, summarizeRealGames, type RealGameRecordV1, type RealRound } from "../src/real-game-record";
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
});
