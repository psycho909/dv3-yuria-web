import { CARDS, RULES, type CardColor, type CardId, type Objective, type OfferedCard, type Rules } from "./domain";

export const RECORD_SCHEMA_VERSION = 1;
export const ENGINE_VERSION = "b-deterministic-2026-09-23";
export const CARD_CATALOG_VERSION = "2026-09-23";
const DB_NAME = "yuria-real-games";
const STORE_NAME = "games";

export type EvidenceLevel = "player_report" | "screen_verified";
export type GameStatus = "draft" | "recorded";
export interface CapturedOffer extends OfferedCard { catalogProbability: number; observedProbability: number | null; }
export interface PredictionSnapshot {
  cardId: CardId;
  meanScore: number;
  thresholdProbability: number;
  p10: number;
  p50: number;
  p90: number;
  method: "exact" | "monte_carlo";
}
export interface RealRound {
  turn: number;
  offers: [CapturedOffer, CapturedOffer, CapturedOffer] | null;
  objective: Objective;
  target: number;
  recommendedCardId: CardId | null;
  predictions: PredictionSnapshot[] | null;
  chosen: OfferedCard;
  activated: boolean;
  towerProc: boolean | null;
  starRemovedCardId: CardId | null;
}
export interface RecordRevision {
  at: string;
  previousScore: number | null;
  previousRounds: RealRound[];
}
export interface RealGameRecordV1 {
  id: string;
  schemaVersion: 1;
  source: "real_manual";
  status: GameStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  revision: number;
  engineVersion: string;
  cardCatalogVersion: string;
  rulesSnapshot: Rules;
  seed: number;
  simulations: number;
  rounds: RealRound[];
  actualFinalScore: number | null;
  evidenceLevel: EvidenceLevel | null;
  revisions: RecordRevision[];
}
export interface ExportEnvelope {
  format: "yuria-real-games";
  schemaVersion: 1;
  exportedAt: string;
  games: RealGameRecordV1[];
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const cardId = (value: unknown): value is CardId => typeof value === "string" && Object.prototype.hasOwnProperty.call(CARDS, value);
const color = (value: unknown): value is CardColor => value === "blue" || value === "purple" || value === "red";
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const probability = (value: unknown): value is number => nonnegative(value) && value <= 1;
const timestamp = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const offered = (value: unknown): value is OfferedCard => record(value) && cardId(value.cardId) && color(value.color);
const objective = (value: unknown): value is Objective => record(value) && (
  value.kind === "expected" || value.kind === "stability" || (value.kind === "threshold" && Number.isSafeInteger(value.target) && nonnegative(value.target))
);
const rules = (value: unknown): value is Rules => record(value) && nonnegative(value.failureScore) && typeof value.sunCountsSelf === "boolean" &&
  (value.redRollMode === "integerPercent" || value.redRollMode === "continuous") &&
  (value.futureColorModel === "independentUniform" || value.futureColorModel === "oneEach") &&
  (value.starRemovalPolicy === "uniformPresent" || value.starRemovalPolicy === "uniformActive");
const prediction = (value: unknown): value is PredictionSnapshot => record(value) && cardId(value.cardId) &&
  nonnegative(value.meanScore) && probability(value.thresholdProbability) && nonnegative(value.p10) &&
  nonnegative(value.p50) && nonnegative(value.p90) && (value.method === "exact" || value.method === "monte_carlo");

export function isValidRound(value: unknown): value is RealRound {
  if (!record(value) || !Number.isInteger(value.turn) || !nonnegative(value.turn) || value.turn < 1 || value.turn > 5 || !offered(value.chosen) ||
    typeof value.activated !== "boolean" || (value.towerProc !== null && typeof value.towerProc !== "boolean") ||
    (value.starRemovedCardId !== null && !cardId(value.starRemovedCardId)) || !objective(value.objective) ||
    !Number.isSafeInteger(value.target) || !nonnegative(value.target)) return false;
  const chosen = value.chosen as OfferedCard;
  if (value.towerProc !== null && (chosen.cardId !== "tower" || !value.activated)) return false;
  if (value.starRemovedCardId !== null && (chosen.cardId !== "star" || !value.activated)) return false;
  if (value.offers !== null) {
    if (!Array.isArray(value.offers) || value.offers.length !== 3 || !value.offers.every(item => offered(item) && record(item) && probability(item.catalogProbability) && (item.observedProbability === null || probability(item.observedProbability)))) return false;
    if (new Set(value.offers.map(item => item.cardId)).size !== 3 || !value.offers.some(item => item.cardId === chosen.cardId && item.color === chosen.color)) return false;
  }
  const offers = value.offers as CapturedOffer[] | null;
  if (value.predictions !== null && (!Array.isArray(value.predictions) || value.predictions.length !== 3 || !value.predictions.every(prediction) || value.offers === null ||
    new Set(value.predictions.map(item => item.cardId)).size !== 3 || !value.predictions.every(item => offers?.some(offer => offer.cardId === item.cardId)))) return false;
  if (value.recommendedCardId !== null && (!cardId(value.recommendedCardId) || value.offers === null || !offers?.some(item => item.cardId === value.recommendedCardId))) return false;
  return true;
}

export function isValidGameRecord(value: unknown): value is RealGameRecordV1 {
  if (!record(value) || value.schemaVersion !== 1 || value.source !== "real_manual" || typeof value.id !== "string" || !/^[\w-]{8,100}$/.test(value.id) ||
    !["draft", "recorded"].includes(String(value.status)) || !timestamp(value.createdAt) || !timestamp(value.updatedAt) ||
    (value.completedAt !== null && !timestamp(value.completedAt)) || !Number.isSafeInteger(value.revision) || !nonnegative(value.revision) ||
    typeof value.engineVersion !== "string" || !value.engineVersion || typeof value.cardCatalogVersion !== "string" || !value.cardCatalogVersion ||
    !rules(value.rulesSnapshot) || !Number.isSafeInteger(value.seed) || !Number.isSafeInteger(value.simulations) || !nonnegative(value.simulations) ||
    !Array.isArray(value.rounds) || value.rounds.length > 5 || !value.rounds.every(isValidRound) ||
    !value.rounds.every((round, index) => round.turn === index + 1) || new Set(value.rounds.map(round => round.chosen.cardId)).size !== value.rounds.length ||
    (value.actualFinalScore !== null && (!Number.isSafeInteger(value.actualFinalScore) || !nonnegative(value.actualFinalScore))) ||
    (value.evidenceLevel !== null && value.evidenceLevel !== "player_report" && value.evidenceLevel !== "screen_verified") ||
    !Array.isArray(value.revisions) || !value.revisions.every(item => record(item) && timestamp(item.at) && (item.previousScore === null || Number.isSafeInteger(item.previousScore) && nonnegative(item.previousScore)) && Array.isArray(item.previousRounds) && item.previousRounds.length === 5 && item.previousRounds.every(isValidRound))) return false;
  if (value.status === "recorded") return value.rounds.length === 5 && value.completedAt !== null && (value.actualFinalScore === null ? value.evidenceLevel === null : value.evidenceLevel !== null);
  return value.completedAt === null && value.actualFinalScore === null && value.evidenceLevel === null;
}

export function createGameRecord(seed: number, simulations: number, now = new Date().toISOString()): RealGameRecordV1 {
  return { id: crypto.randomUUID(), schemaVersion: RECORD_SCHEMA_VERSION, source: "real_manual", status: "draft", createdAt: now,
    updatedAt: now, completedAt: null, revision: 0, engineVersion: ENGINE_VERSION, cardCatalogVersion: CARD_CATALOG_VERSION,
    rulesSnapshot: { ...RULES }, seed, simulations, rounds: [], actualFinalScore: null, evidenceLevel: null, revisions: [] };
}

export function parseExport(value: unknown): RealGameRecordV1[] {
  if (!record(value) || value.format !== "yuria-real-games" || value.schemaVersion !== 1 || !Array.isArray(value.games) || !value.games.every(game => isValidGameRecord(game) && game.status === "recorded"))
    throw new Error("檔案格式或牌局資料不正確；沒有匯入任何資料。");
  if (new Set(value.games.map(game => game.id)).size !== value.games.length) throw new Error("檔案中有重複的牌局 ID。");
  return value.games;
}

export function exportEnvelope(games: RealGameRecordV1[]): ExportEnvelope {
  return { format: "yuria-real-games", schemaVersion: RECORD_SCHEMA_VERSION, exportedAt: new Date().toISOString(), games };
}

export function summarizeRealGames(games: RealGameRecordV1[]) {
  const recorded = games.filter(game => game.status === "recorded");
  const scored = recorded.filter(game => game.actualFinalScore !== null);
  const completeWithOffers = recorded.filter(game => game.rounds.every(round => round.offers !== null));
  const clickCounts = new Map<CardId, { success: number; total: number }>();
  const offerColors = { blue: 0, purple: 0, red: 0 };
  let observedOffers = 0;
  for (const game of recorded) for (const round of game.rounds) {
    const count = clickCounts.get(round.chosen.cardId) ?? { success: 0, total: 0 };
    count.total++;
    if (round.activated) count.success++;
    clickCounts.set(round.chosen.cardId, count);
    if (round.offers) for (const offer of round.offers) { offerColors[offer.color]++; observedOffers++; }
  }
  const scores = scored.map(game => game.actualFinalScore!);
  const predictions = scored.flatMap(game => {
    const last = game.rounds[4]!;
    const metric = last.predictions?.find(item => item.cardId === last.chosen.cardId);
    return metric ? [game.actualFinalScore! - metric.meanScore] : [];
  });
  return { recordedCount: recorded.length, scoredCount: scored.length, completeWithOffersCount: completeWithOffers.length, totalCount: games.length,
    averageScore: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
    scoreResidualMean: predictions.length ? predictions.reduce((sum, value) => sum + value, 0) / predictions.length : null,
    residualCount: predictions.length, clickCounts, offerColors, observedOffers };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("無法開啟本機牌局資料庫"));
  });
}

export async function listGames(): Promise<RealGameRecordV1[]> {
  const db = await openDatabase();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as unknown[]).filter(isValidGameRecord).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}

export async function saveGame(game: RealGameRecordV1): Promise<void> {
  if (!isValidGameRecord(game)) throw new Error("牌局資料未通過驗證，沒有儲存。");
  const db = await openDatabase();
  try { await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(game);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }); } finally { db.close(); }
}

export async function importGames(games: RealGameRecordV1[]): Promise<{ added: number; skipped: number }> {
  if (!games.every(game => isValidGameRecord(game) && game.status === "recorded") || new Set(games.map(game => game.id)).size !== games.length)
    throw new Error("匯入資料不正確；沒有修改原有資料。");
  const existing = new Map((await listGames()).map(game => [game.id, game]));
  for (const game of games) {
    const prior = existing.get(game.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(game)) throw new Error(`牌局 ${game.id} 已存在不同版本；沒有覆寫任何資料。`);
  }
  const additions = games.filter(game => !existing.has(game.id));
  if (additions.length) {
    const db = await openDatabase();
    try { await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      for (const game of additions) transaction.objectStore(STORE_NAME).add(game);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    }); } finally { db.close(); }
  }
  return { added: additions.length, skipped: games.length - additions.length };
}
