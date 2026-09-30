import {
  CARDS, REWARD_THRESHOLDS, RULES, calculateScore, colorClass, colorLabel, recommend, summarizeScore,
  type CardColor, type CardId, type GameState, type Objective, type OfferedCard, type SelectedCard
} from "./domain";
import {
  createGameRecord, exportEnvelope, gamesNeedingUpload, importGames, isValidGameRecord, listGames, mergeGames, parseExport, saveGame, saveGames, summarizeRealGames,
  type EvidenceLevel, type RealGameRecordV1, type RealRound
} from "./real-game-record";
import { currentCloudUser, downloadRecordedGames, signInWithGitHub, signOutCloud, uploadRecordedGame, watchCloudAuth } from "./cloud-games";
import type { User } from "@supabase/supabase-js";
import "./app.css";

const cardList = Object.values(CARDS);
// Artwork mapping follows the source game's image IDs, which are not in card-list order.
const cardArtNumber: Record<CardId, string> = {
  fool: "01", magician: "02", high_priestess: "03", empress: "04", emperor: "05", hierophant: "06",
  lovers: "07", chariot: "08", hermit: "10", hanged_man: "13", devil: "16", strength: "09",
  wheel_of_fortune: "11", justice: "12", death: "14", temperance: "15", judgement: "21",
  tower: "17", star: "18", moon: "19", sun: "20", world: "22"
};
const cardArt = (id: CardId) => `/cards/frame_event_yuria_card_${cardArtNumber[id]}.png`;
const colorOptions: CardColor[] = ["blue", "purple", "red"];
// The game deals one card of each color per turn; these are only fallbacks until a slot is filled.
const defaultSlotColors = (): CardColor[] => [...colorOptions];
let state: GameState = { turn: 1, selected: [] };
let targetThreshold = 3000;
let targetInput = "3000";
let targetError = "";
let objective: Objective = { kind: "threshold", target: targetThreshold };
let candidates: Array<OfferedCard | null> = [null, null, null];
let candidateColors: CardColor[] = defaultSlotColors();
// Candidate slot whose "改色" buttons are open; only one at a time.
let colorEditIndex: number | null = null;
let pickerIndex: number | null = null;
let simulationCount = 20000;
let result: ReturnType<typeof recommend> | null = null;
let pendingChoice: OfferedCard | null = null;
let pendingOutcome: "success" | "failure" | null = null;
let resetConfirmationOpen = false;
let resetReturnFocus = "#reset";
let pendingTowerProc: boolean | null = null;
let pendingRemovedCardId: CardId | null = null;
type TurnSnapshot = { state: GameState; starTargets: Array<CardId | null> };
type StoredSession = {
  state?: GameState;
  starTargets?: Array<CardId | null>;
  turnSnapshots?: TurnSnapshot[];
  targetThreshold?: number;
  objective?: Objective;
  candidates?: Array<OfferedCard | null>;
  candidateColors?: CardColor[];
  simulationCount?: number;
  currentRecord?: RealGameRecordV1 | null;
};
let turnSnapshots: TurnSnapshot[] = [];
let starTargetIds: Array<CardId | null> = [];
let pendingEditIndex: number | null = null;
let pendingEditTowerProc: boolean | null = null;
let pendingEditRemovedCardId: CardId | null = null;
let selectedCandidateKey = "";
let returnFocus = "";
let pickerCategory: "all" | "score" | "multiplier" | "special" = "all";
let calculationStatus: "idle" | "calculating" | "ready" | "error" = "idle";
let calculationError = "";
let calculationTimer: number | undefined;
let requestId = 0;
let restoredSession = false;
let storageNotice = "";
let currentRecord: RealGameRecordV1 | null = null;
let archiveGames: RealGameRecordV1[] = [];
let archiveNotice = "";
let archiveSaveState = "";
let recordSaveQueue: Promise<void> = Promise.resolve();
let scoreEditing = false;
let pendingChoiceSource: "candidate" | "manual" | null = null;
let cloudUser: User | null = null;
let cloudStatus = "尚未登入；本機紀錄照常使用。";
// Cloud copies known from the last sync: game id -> cloud revision. null until a sync succeeds.
let cloudRevisions: Map<string, number> | null = null;
let cloudConflictIds = new Set<string>();
let cloudSkipped = 0;
let cloudSyncedAt: string | null = null;
let cloudBusy = false;
let cloudSyncRun: Promise<void> | null = null;
const detailOpen = new Map<string, boolean>();

const STORAGE_KEY = "yuria-web-session-v1";
const LAYOUT_MODE_KEY = "yuria-web-layout-mode-v1";
// Page palette; index.html applies the stored value before first paint, keep the key in sync there.
const THEME_KEY = "yuria-web-theme-v1";
type Theme = "mist" | "amber" | "night";
const THEMES: ReadonlyArray<{ id: Theme; label: string; page: string }> = [
  { id: "mist", label: "霧藍", page: "#edf3f4" },
  { id: "amber", label: "琥珀", page: "#f3e4c4" },
  { id: "night", label: "夜紫", page: "#1b1024" }
];
const DEFAULT_THEME: Theme = "amber";
function readTheme(): Theme {
  try { const stored = localStorage.getItem(THEME_KEY); return stored === "mist" || stored === "night" ? stored : DEFAULT_THEME; }
  catch { return DEFAULT_THEME; }
}
function applyTheme(next: Theme) {
  // Always set the attribute explicitly (never omit it): :root only carries 霧藍's tokens, so a missing
  // attribute must not silently mean "amber" once amber is the default rather than the base rule.
  document.documentElement.dataset.theme = next;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEMES.find(item => item.id === next)!.page);
}
let theme: Theme = readTheme();
applyTheme(theme);
type LayoutMode = "full" | "narrow";
function readLayoutMode(): LayoutMode {
  try { return localStorage.getItem(LAYOUT_MODE_KEY) === "narrow" ? "narrow" : "full"; }
  catch { return "full"; }
}
let layoutMode: LayoutMode = readLayoutMode();
const CALCULATION_SEED = 20260922;
let worker: Worker | null = null;
type WorkerMessage =
  | { type: "RESULT"; requestId: number; result: ReturnType<typeof recommend> }
  | { type: "ERROR"; requestId: number; message: string };

const REAL_SCORES = [748, 972, 1270, 840, 1648];
const REAL_AVERAGE = REAL_SCORES.reduce((sum, score) => sum + score, 0) / REAL_SCORES.length;
const MODEL_STATS = { games: 30, mean: 1118.6, median: 949, over1000: 12, over1500: 9, maximum: 2542 };

const app = document.querySelector<HTMLDivElement>("#app")!;
const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const cardName = (id: CardId) => CARDS[id].name;
const colorBadge = (color: CardColor) => `<span class="color-chip ${colorClass[color]}">${colorLabel[color]}</span>`;
const pct = (value: number) => `${(value * 100).toFixed(2)}%`;
const formatPercent = (value: number) => value > 0 && value < .001 ? "<0.1%" : pct(value);
const cloneState = (value: GameState): GameState => ({ turn: value.turn, selected: value.selected.map(card => ({ ...card })) });
const cloneTargets = (value: Array<CardId | null>) => [...value];
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isCardId = (value: unknown): value is CardId => typeof value === "string" && Object.prototype.hasOwnProperty.call(CARDS, value);
const isColor = (value: unknown): value is CardColor => value === "blue" || value === "purple" || value === "red";
const nextTurn = (selectedLength: number) => Math.min(5, selectedLength + 1) as GameState["turn"];
const candidateKey = (card: OfferedCard) => `${card.cardId}:${card.color}`;

function isSelectedCard(value: unknown): value is SelectedCard {
  if (!isRecord(value) || !isCardId(value.cardId) || !isColor(value.color) || typeof value.activated !== "boolean") return false;
  if (value.removed !== undefined && typeof value.removed !== "boolean") return false;
  if (value.towerProc !== undefined && (typeof value.towerProc !== "boolean" || value.cardId !== "tower")) return false;
  return true;
}

function isValidState(value: unknown): value is GameState {
  if (!isRecord(value) || ![1, 2, 3, 4, 5].includes(value.turn as number) || !Array.isArray(value.selected) || value.selected.length > 5) return false;
  if (!value.selected.every(isSelectedCard)) return false;
  if (new Set(value.selected.map(card => card.cardId)).size !== value.selected.length) return false;
  return value.turn === nextTurn(value.selected.length);
}

function isValidStarTargets(value: unknown, selected: SelectedCard[]): value is Array<CardId | null> {
  return Array.isArray(value) && value.length === selected.length && value.every((target, index) =>
    target === null || (selected[index]?.cardId === "star" && isCardId(target) && target !== "star" && selected.some(card => card.cardId === target))
  );
}

function cloneSnapshot(snapshot: TurnSnapshot): TurnSnapshot {
  return { state: cloneState(snapshot.state), starTargets: cloneTargets(snapshot.starTargets) };
}

function snapshotCurrentState() {
  turnSnapshots = [...turnSnapshots, { state: cloneState(state), starTargets: cloneTargets(starTargetIds) }].slice(-5);
}

function detailAttribute(key: string, defaultOpen = false) {
  return detailOpen.has(key) ? (detailOpen.get(key) ? " open" : "") : defaultOpen ? " open" : "";
}

function captureDetails() {
  app.querySelectorAll<HTMLDetailsElement>("details[data-detail-key]").forEach(details => detailOpen.set(details.dataset.detailKey!, details.open));
}

function storageFailureNotice() {
  storageNotice = "本機儲存失敗，目前只暫存於此頁；重新整理可能遺失。";
}

function persistSession() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: cloneState(state), starTargets: cloneTargets(starTargetIds), turnSnapshots: turnSnapshots.slice(-5).map(cloneSnapshot), targetThreshold, objective, candidates, candidateColors, simulationCount, currentRecord }));
  } catch { storageFailureNotice(); }
}

function loadSession() {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    storageFailureNotice();
    return;
  }
  if (!raw) return;
  try {
    const saved = JSON.parse(raw) as StoredSession;
    const savedCards = saved.state?.selected;
    const savedCandidates = saved.candidates;
    const validCandidates = Array.isArray(savedCandidates) && savedCandidates.length === 3 && savedCandidates.every(card => card === null || (isRecord(card) && isCardId(card.cardId) && isColor(card.color)));
    const candidateIds = validCandidates ? savedCandidates.filter((card): card is OfferedCard => card !== null).map(card => card.cardId) : [];
    const validSnapshots = saved.turnSnapshots === undefined || (Array.isArray(saved.turnSnapshots) && saved.turnSnapshots.length <= 5 && saved.turnSnapshots.every(snapshot => isRecord(snapshot) && isValidState(snapshot.state) && isValidStarTargets(snapshot.starTargets, snapshot.state.selected)));
    const savedTargets = saved.starTargets ?? (savedCards ? Array.from({ length: savedCards.length }, () => null) : []);
    if (!isValidState(saved.state) || !validCandidates || new Set([...saved.state.selected.map(card => card.cardId), ...candidateIds]).size !== saved.state.selected.length + candidateIds.length || !isValidStarTargets(savedTargets, saved.state.selected) || !validSnapshots) {
      try { localStorage.removeItem(STORAGE_KEY); } catch { storageFailureNotice(); }
      return;
    }
    state = cloneState(saved.state);
    state.turn = nextTurn(state.selected.length);
    starTargetIds = cloneTargets(savedTargets);
    turnSnapshots = (saved.turnSnapshots ?? []).map(cloneSnapshot).slice(-5);
    candidates = savedCandidates.map(card => card ? { cardId: card.cardId, color: card.color } : null);
    candidateColors = saved.candidateColors?.length === 3 && saved.candidateColors.every(isColor) ? [...saved.candidateColors] : defaultSlotColors();
    targetThreshold = typeof saved.targetThreshold === "number" && Number.isFinite(saved.targetThreshold) && Number.isInteger(saved.targetThreshold) && saved.targetThreshold >= 0 ? saved.targetThreshold : 3000;
    if (saved.objective?.kind === "threshold" && Number.isInteger(saved.objective.target) && saved.objective.target >= 0) targetThreshold = saved.objective.target;
    objective = saved.objective?.kind === "expected" || saved.objective?.kind === "stability" ? { kind: saved.objective.kind } : { kind: "threshold", target: targetThreshold };
    targetInput = String(targetThreshold);
    simulationCount = saved.simulationCount === 5000 || saved.simulationCount === 10000 || saved.simulationCount === 20000 ? saved.simulationCount : 20000;
    currentRecord = saved.currentRecord && isValidGameRecord(saved.currentRecord) && saved.currentRecord.rounds.length === state.selected.length &&
      saved.currentRecord.rounds.every((round, index) => round.chosen.cardId === state.selected[index]!.cardId && round.chosen.color === state.selected[index]!.color && round.activated === state.selected[index]!.activated) ? saved.currentRecord : null;
    restoredSession = Boolean(state.selected.length || candidates.some(Boolean));
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch { storageFailureNotice(); }
  }
}

function thresholdMetric(metric: NonNullable<typeof result>["ranked"][number]) {
  const detail = metric.thresholdProbability === 0 ? metric.method === "exact" ? "依目前模型為 0" : `抽樣 ${metric.simulations.toLocaleString()} 次未命中` : formatPercent(metric.thresholdProbability);
  return { label: "達標率", value: metric.thresholdProbability === 0 ? metric.method === "exact" ? "0%" : "未命中" : detail, detail };
}

type RankedMetric = ReturnType<typeof recommend>["ranked"][number];
const scoreText = (value: number) => value.toLocaleString("zh-TW", { maximumFractionDigits: 1 });

function objectiveMetric(metric: RankedMetric) {
  if (objective.kind === "expected") return { label: "預期分數", value: scoreText(metric.meanScore), detail: `預期最終分數 ${metric.meanScore.toFixed(1)}` };
  if (objective.kind === "stability") return { label: "保守 P10", value: metric.p10.toLocaleString(), detail: `保守分數 P10 ${metric.p10.toLocaleString()}` };
  return thresholdMetric(metric);
}

/** The large number on each candidate is what the ranking actually used: when every target rate is 0, that is the mean score. */
function candidateMetrics(metric: RankedMetric) {
  const mean = { label: "平均分", value: scoreText(metric.meanScore), detail: `預期最終分數 ${metric.meanScore.toFixed(1)}` };
  const threshold = thresholdMetric(metric);
  if (objective.kind !== "threshold") return { primary: objectiveMetric(metric), secondary: threshold };
  if (result?.mode === "highest_expected_score_fallback") return { primary: mean, secondary: { ...threshold, label: `達到 ${targetThreshold.toLocaleString()} 分` } };
  return { primary: threshold, secondary: mean };
}

const slotOf = (cardId: CardId) => candidates.findIndex(candidate => candidate?.cardId === cardId);
const offerLabel = (metric: RankedMetric) => `候選 ${slotOf(metric.candidate.cardId) + 1}：${cardName(metric.candidate.cardId)}（${colorLabel[metric.candidate.color]}）`;

/** One sentence explaining why the top candidate ranks first under the current objective. */
function verdictReason(ranked: RankedMetric[], fallback: boolean, exactZero: boolean) {
  const top = ranked[0]!;
  const second = ranked[1];
  const meanGap = second ? top.meanScore - second.meanScore : 0;
  const meanTail = !second ? "" : Math.abs(meanGap) < .05 ? "，與第二名幾乎同分" : `，比第二名高 ${scoreText(meanGap)} 分`;
  if (objective.kind === "threshold") {
    const target = targetThreshold.toLocaleString();
    if (fallback) return `${exactZero ? `依目前模型，三張都不可能達到 ${target} 分` : `這盤抽樣中三張都追不到 ${target} 分`}，改比平均分：${scoreText(top.meanScore)} 分${meanTail}。`;
    const gap = second ? (top.thresholdProbability - second.thresholdProbability) * 100 : 0;
    const rateTail = !second ? "" : gap < .005 ? "，與第二名相同，再以平均分決定" : `，比第二名高 ${gap.toFixed(2)} 個百分點`;
    return `達到 ${target} 分的機率 ${formatPercent(top.thresholdProbability)}${rateTail}。`;
  }
  if (objective.kind === "expected") return `預期最終分數 ${scoreText(top.meanScore)}${meanTail}。`;
  const p10Gap = second ? top.p10 - second.p10 : 0;
  return `保守分數 P10 為 ${top.p10.toLocaleString()}${!second ? "" : p10Gap === 0 ? "，與第二名相同，再以平均分決定" : `，比第二名高 ${p10Gap.toLocaleString()} 分`}。`;
}

/** The answer band above the candidates: what to do now, stated once. Hidden after the fifth card. */
function renderVerdict(resultReady: boolean, fallback: boolean, exactZero: boolean) {
  if (state.selected.length === 5) return "";
  const filled = candidates.filter(Boolean).length;
  let tone = "";
  let title: string;
  let body: string;
  let extra = "";
  if (targetError) {
    tone = "is-warning"; title = "目標分數需要修正"; body = `${targetError}在上方「推薦目標」修改後才會計算。`;
  } else if (calculationStatus === "error") {
    tone = "is-warning"; title = "推薦暫時無法更新"; body = `${calculationError} 候選牌已保留。`;
    extra = `<button type="button" class="secondary-action" id="retry-calculation">重新計算</button>`;
  } else if (calculationStatus === "calculating") {
    title = "正在比較三張牌…"; body = "完成後結果會出現在原本的候選位置，牌的順序不會改變。";
  } else if (resultReady && result?.ranked.length) {
    const ranked = result.ranked;
    const top = ranked[0]!;
    const bestMean = [...ranked].sort((a, b) => b.meanScore - a.meanScore)[0]!;
    tone = "is-ready"; title = `建議選 ${offerLabel(top)}`; body = verdictReason(ranked, fallback, exactZero);
    const alternative = objective.kind !== "expected" && !fallback && bestMean.candidate.cardId !== top.candidate.cardId
      ? `想要平均分最高，改選 ${esc(offerLabel(bestMean))}（平均 ${scoreText(bestMean.meanScore)} 分）。` : "";
    extra = `<small>${alternative}在遊戲中選好後，按那張的「記錄：我選了這張」。</small>`;
  } else {
    title = `填入遊戲中的 3 張候選牌（已填 ${filled}/3）`;
    body = filled === 3 ? "候選牌不可重複，也不能與已確定卡片重複。" : `點下方空格，再點牌下方的藍／紫／紅即可填入。${state.selected.length ? "" : "新牌局不用補登已確定卡片。"}`;
  }
  return `<section class="verdict ${tone}" aria-labelledby="verdict-title"><h2 id="verdict-title">${esc(title)}</h2><p>${esc(body)}</p>${extra}</section>`;
}

function cardFace(id: CardId, color: CardColor) {
  const card = CARDS[id];
  const effect = card.specialEffect?.kind === "tower" ? `高塔：成功 +${card.specialEffect.procMultiplier} 倍，否則 +${card.specialEffect.fallbackMultiplier} 倍` : card.specialEffect?.kind === "removeOtherCard" ? `星星：成功移除一張牌，倍率 +${card.specialEffect.multiplier}` : card.specialEffect?.kind === "failedCardScore" ? `月亮：基礎 +${card.specialEffect.baseScore}，每張失敗 +${card.specialEffect.perFailedCard}` : card.specialEffect?.kind === "activeCountMultiplier" ? `太陽：倍率 +${card.specialEffect.baseMultiplier}，每張有效牌 +${card.specialEffect.perActiveCard}` : card.specialEffect?.kind === "highestActiveScore" ? `世界：最高成功分數 ×${card.specialEffect.factor}` : card.category === "score" ? `+${card.scoreValue} 分` : card.category === "multiplier" ? `倍率 +${card.multiplierValue}` : "特殊效果";
  const frameColor = color === "red" ? "yellow" : color;
  const badge = card.category === "score" ? `+${card.scoreValue}` : card.category === "multiplier" ? `+${Math.round((card.multiplierValue ?? 0) * 100)}%` : "特殊";
  return `<span class="game-card" aria-hidden="true"><img class="game-card-frame" src="/cards/frame_event_yuria_${frameColor}_frame_01.png" alt="" /><img class="game-card-art" src="${cardArt(id)}" alt="" /><span class="game-card-label" style="background-image:url('/cards/frame_event_yuria_${frameColor}_frame_02.png')">${badge}</span><span class="game-card-ribbon" style="background-image:url('/cards/frame_event_yuria_${frameColor}_ribbon_01.png')">${esc(card.name)}</span></span><span class="sr-only">${esc(card.name)}，${colorLabel[color]}色，${effect}，啟用 ${Math.round(card.activationProbability * 100)}%</span>`;
}

const historyStatus = (card: SelectedCard) => card.removed ? "已移除" : card.activated ? "成功" : "失敗";

/** Compact strip of the five turns; the mini card itself is the summary that opens its correction fields. */
function renderHistory() {
  const cards = state.selected.map((card, index) => `<article class="run-card ${colorClass[card.color]} ${card.removed ? "is-removed" : ""} ${card.activated ? "" : "is-failed"}">
    <details class="run-edit" name="run-edit" data-detail-key="history-edit-${index}"${detailAttribute(`history-edit-${index}`)}>
      <summary class="run-card-face" aria-label="第 ${index + 1} 回合，${esc(cardName(card.cardId))}，${colorLabel[card.color]}色，${historyStatus(card)}；按下可更正">${cardFace(card.cardId, card.color)}<small>${historyStatus(card)}</small></summary>
      <div class="run-edit-fields"><strong>更正第 ${index + 1} 回合：${esc(cardName(card.cardId))}</strong>
      <label>牌色<select data-history-color="${index}" aria-label="${esc(cardName(card.cardId))} 牌色" ${targetError ? "disabled" : ""}>${colorOptions.map(color => `<option value="${color}" ${color === card.color ? "selected" : ""}>${colorLabel[color]}色</option>`).join("")}</select></label>
      <div class="history-result" role="group" aria-label="${esc(cardName(card.cardId))} 啟用結果">${[true, false].map(activated => `<button type="button" data-history-result="${index}" data-activated="${activated}" aria-pressed="${card.activated === activated}" class="${card.activated === activated ? "selected" : ""}" ${targetError ? "disabled" : ""}>${activated ? "成功" : "失敗"}</button>`).join("")}</div>
      <label class="removed-toggle"><input type="checkbox" data-history-removed="${index}" ${card.removed ? "checked" : ""} ${targetError || starTargetIds.some((target, starIndex) => target === card.cardId && state.selected[starIndex]?.activated) ? "disabled" : ""} />已被移除</label>
      ${card.cardId === "star" && card.activated && starTargetIds[index] ? `<small class="history-special-link">移除：${esc(cardName(starTargetIds[index]!))}（按「成功」可更正）</small>` : card.cardId === "tower" && card.activated ? `<small class="history-special-link">高塔倍率：${card.towerProc ? "高" : "低"}（按「成功」可更正）</small>` : ""}
    </div></details>
  </article>`).join("");
  const emptySlots = Array.from({ length: 5 - state.selected.length }, (_, index) => {
    const turn = state.selected.length + index + 1;
    return `<div class="run-slot ${index === 0 ? "is-current" : ""}" aria-label="第 ${turn} 回合，尚未記錄"><span aria-hidden="true">${turn}</span></div>`;
  }).join("");
  return cards + emptySlots;
}

/** Correction panels float over the workbench, so close them whenever the run moves on. */
function closeRunEdits() {
  app.querySelectorAll<HTMLDetailsElement>(".run-edit[open]").forEach(details => { details.open = false; });
  for (const key of detailOpen.keys()) if (key.startsWith("history-edit-")) detailOpen.set(key, false);
}

function candidatesReady(): boolean {
  if (candidates.some(candidate => candidate == null)) return false;
  const ids = candidates.map(candidate => candidate!.cardId);
  return new Set(ids).size === ids.length && !ids.some(id => state.selected.some(selected => selected.cardId === id));
}

/** One color tag per offer; the three color buttons only appear after "改色". */
function colorControls(slotIndex: number, current: CardColor) {
  const open = colorEditIndex === slotIndex;
  const toggle = `<button type="button" class="text-action offer-color-toggle" id="color-toggle-${slotIndex}" data-color-toggle="${slotIndex}" aria-expanded="${open}"${open ? ` aria-controls="slot-colors-${slotIndex}"` : ""}>改色</button>`;
  const panel = open ? `<div class="offer-colors" id="slot-colors-${slotIndex}" role="group" aria-label="候選 ${slotIndex + 1} 顏色">${colorOptions.map(color => `<button type="button" class="offer-color ${colorClass[color]} ${color === current ? "selected" : ""}" data-slot-color="${color}" data-slot-index="${slotIndex}" aria-pressed="${color === current}">${colorLabel[color]}</button>`).join("")}</div>` : "";
  return { toggle, panel };
}

function renderPendingCandidate(index: number, candidate: OfferedCard | null, isNext = index === candidates.findIndex(item => item === null)) {
  if (!candidate) return `<article class="offer-card is-empty">
    <div class="offer-top"><span class="offer-slot">候選 ${index + 1}</span></div>
    <button type="button" class="offer-face offer-empty-face ${isNext ? "is-next" : ""}" data-pick="${index}" aria-label="選擇第 ${index + 1} 張候選牌"><span class="offer-plus" aria-hidden="true">＋</span><strong>選第 ${index + 1} 張</strong><small>點牌下方的顏色即可填入</small></button>
  </article>`;
  const controls = colorControls(index, candidate.color);
  return `<article class="offer-card is-filled ${colorClass[candidate.color]}">
    <div class="offer-top"><span class="offer-slot">候選 ${index + 1}</span>${colorBadge(candidate.color)}${controls.toggle}</div>
    ${controls.panel}
    <button type="button" class="offer-face" data-pick="${index}" aria-label="修改第 ${index + 1} 張候選牌：${esc(cardName(candidate.cardId))}，${colorLabel[candidate.color]}色">${cardFace(candidate.cardId, candidate.color)}</button>
    <p class="offer-waiting">${calculationStatus === "calculating" ? "計算中…" : candidatesReady() ? "" : "等待其他候選"}</p>
  </article>`;
}

function usageLabelForPicker(id: CardId) {
  if (state.selected.some(card => card.cardId === id)) return "本局已選";
  const slot = candidates.findIndex((candidate, index) => index !== pickerIndex && candidate?.cardId === id);
  return slot >= 0 ? `候選 ${slot + 1} 已使用` : "";
}

function renderPicker() {
  if (pickerIndex === null) return "";
  const visibleCards = cardList.filter(card => !usageLabelForPicker(card.id) && (pickerCategory === "all" || card.category === pickerCategory));
  const categories = [["all", "全部"], ["score", "分數卡"], ["multiplier", "倍率卡"], ["special", "特殊卡"]] as const;
  const categoryCount = (value: typeof categories[number][0]) => cardList.filter(card => !usageLabelForPicker(card.id) && (value === "all" || card.category === value)).length;
  return `<dialog class="picker-dialog" aria-labelledby="picker-title">
    <div class="picker-header"><div><h2 id="picker-title">${pickerIndex === -1 ? "加入已確定卡片" : `選擇第 ${pickerIndex + 1} 張候選牌`}</h2></div><button type="button" class="picker-close" data-picker-cancel aria-label="關閉選擇器">×</button></div>
    <div class="picker-section"><div class="picker-section-heading"><strong>點卡片下方的藍／紫／紅，即可加入</strong><small>已使用的牌不顯示</small></div><div class="picker-categories" role="group" aria-label="牌庫分類">${categories.map(([value, label]) => `<button type="button" data-picker-category="${value}" aria-pressed="${pickerCategory === value}" class="${pickerCategory === value ? "selected" : ""}">${label} <span>${categoryCount(value)}</span></button>`).join("")}</div><div class="picker-card-grid">${visibleCards.map(card => `<div class="picker-card"><div class="picker-card-choice" data-picker-card="${card.id}"><img src="${cardArt(card.id)}" alt="" loading="lazy" /><strong>${esc(card.name)}</strong><small>${card.category === "score" ? `+${card.scoreValue} 分` : card.category === "multiplier" ? `+${Math.round((card.multiplierValue ?? 0) * 100)}%` : "特殊卡"}</small></div><div class="picker-card-colors" role="group" aria-label="${esc(card.name)}牌色">${colorOptions.map(color => `<button type="button" class="mini-color ${colorClass[color]}" data-picker-direct-card="${card.id}" data-picker-direct-color="${color}" aria-label="${esc(card.name)}，${colorLabel[color]}色，直接加入">${colorLabel[color]}</button>`).join("")}</div></div>`).join("")}</div><p id="search-empty" aria-live="polite" ${visibleCards.length ? "hidden" : ""}>這個分類沒有可選卡片，請切換分類。</p></div>
    <div class="picker-footer"><span>選好牌色後立即加入</span><div><button type="button" class="secondary-action" data-picker-cancel>取消</button></div></div>
  </dialog>`;
}

function renderEvidencePanel() {
  return `<section class="evidence-panel"><h3>早期實測與模型自我模擬</h3><p class="knowledge-note">只有總分的 5 局實測與 30 局模型自我模擬，不是完整真實牌局，不併入上方紀錄。</p>
    <div class="score-strip">${REAL_SCORES.map(score => `<span>${score}</span>`).join("")}</div>
    <div class="evidence-grid"><div><strong>${REAL_AVERAGE.toFixed(1)}</strong><small>實測平均</small></div><div><strong>2 / 5</strong><small>達 1000</small></div><div><strong>1 / 5</strong><small>達 1500</small></div></div>
    <div class="model-run"><span>30 場模型自我模擬</span><strong>${MODEL_STATS.mean.toFixed(1)} 平均</strong><small>中位 ${MODEL_STATS.median} · ≥1500 ${MODEL_STATS.over1500}/${MODEL_STATS.games} · 最高 ${MODEL_STATS.maximum}</small></div>
  </section>`;
}

function renderKnowledgePanels() {
  const cardsByCategory = (["score", "multiplier", "special"] as const).map(category => {
    const cards = cardList.filter(card => card.category === category);
    const label = category === "score" ? "分數卡" : category === "multiplier" ? "倍率卡" : "特殊卡";
    return `<div class="catalog-group"><h4>${label} · ${cards.length} 張</h4><div class="catalog-list">${cards.map(card => `<span><b>${esc(card.name)}</b><small>${Math.round(card.activationProbability * 100)}% · ${card.category === "score" ? `+${card.scoreValue} 分` : card.category === "multiplier" ? `+${Math.round((card.multiplierValue ?? 0) * 100)}%` : "特殊效果"}</small></span>`).join("")}</div></div>`;
  }).join("");
  return `<details class="more-panel" data-detail-key="catalog"${detailAttribute("catalog")}><summary>牌庫與祝福門檻</summary><h3>尤里亞的祝福門檻</h3><div class="reward-table">${REWARD_THRESHOLDS.map((threshold, index) => `<div><span>Lv.${index + 1}</span><strong>${threshold.toLocaleString()}</strong><small>${threshold === 0 ? "起始" : index === REWARD_THRESHOLDS.length - 1 ? "最高級" : "累積幸運分數"}</small></div>`).join("")}</div><p class="knowledge-note">推薦目標可自行輸入；門檻只作為參考，不會取代你設定的目標。</p><h3>完整牌庫（22 張）</h3><div class="catalog">${cardsByCategory}</div></details>
    <details class="more-panel" data-detail-key="model-notes"${detailAttribute("model-notes")}><summary>公式、模型限制與早期實測</summary><h3>計分公式</h3><div class="formula"><code>floor(SUM × MULT × (1 + RED_BONUS))</code><p>SUM 包含成功分數卡、失敗卡每張 +20、藍色級距、月亮與世界；MULT 將倍率卡、紫色級距、高塔、星星、太陽加總後再加 1。</p><p>目前採 A 版整數百分比紅色模型；1648 實測仍提示連續值或中間取整可能存在。未來每回合固定藍、紫、紅各一張且位置隨機；類別內等權與太陽是否計自己仍是明示假設。</p></div>
      <h3>資料可信度</h3><div class="confidence"><div><span class="confidence-icon verified">✓</span><p><strong>22 張牌資料</strong><small>使用者提供並記錄</small></p></div><div><span class="confidence-icon warning">△</span><p><strong>未驗證出牌分布</strong><small>類別內暫採等權</small></p></div><div><span class="confidence-icon warning">△</span><p><strong>紅色抽樣模型</strong><small>整數預設；1648 暗示連續值</small></p></div><div><span class="confidence-icon muted">—</span><p><strong>Jev 僅語意路由</strong><small>不參與數學計算</small></p></div></div>
      ${renderEvidencePanel()}</details>`;
}

function renderCandidateRiskDetails() {
  if (!result) return "";
  const cards = candidates.map((candidate, index) => {
    const metric = candidate && result!.ranked.find(item => item.candidate.cardId === candidate.cardId);
    if (!candidate || !metric) return "";
    return `<div class="candidate-risk-card"><strong>候選 ${index + 1} · ${esc(cardName(candidate.cardId))}</strong><span>保守分數 P10：${metric.p10.toLocaleString()}</span><span>P10 ${metric.p10} · P50 ${metric.p50} · P90 ${metric.p90}</span><span>模型範圍 ${metric.minScore.toLocaleString()}～${metric.maxScore.toLocaleString()}</span></div>`;
  }).join("");
  return `<details class="metric-details candidate-risk-details" data-detail-key="candidate-risk"${detailAttribute("candidate-risk")}><summary>查看三張牌的分數範圍與風險</summary><div class="candidate-risk-grid">${cards}</div><p class="metric-help">P10 是模型中約 10% 結果低於的分數，不是保證最低分。</p></details>`;
}

function renderCandidate(slotIndex: number, metric: RankedMetric, rank: number) {
  const card = CARDS[metric.candidate.cardId];
  const color = metric.candidate.color;
  const isTop = rank === 1;
  const { primary, secondary } = candidateMetrics(metric);
  const controls = colorControls(slotIndex, color);
  return `<article class="offer-card is-result ${isTop ? "is-top" : ""} ${colorClass[color]}">
    <div class="offer-top"><span class="offer-slot">候選 ${slotIndex + 1}</span>${colorBadge(color)}${controls.toggle}${isTop ? `<span class="offer-badge">推薦</span>` : `<span class="offer-rank">第 ${rank} 名</span>`}</div>
    ${controls.panel}
    <button type="button" class="offer-face" data-pick="${slotIndex}" aria-label="修改第 ${slotIndex + 1} 張候選牌：${esc(card.name)}，${colorLabel[color]}色">${cardFace(card.id, color)}</button>
    <div class="offer-metrics">
      <div class="offer-primary"><span>${primary.label}</span><strong title="${esc(primary.detail)}">${esc(primary.value)}</strong><span class="sr-only">${esc(primary.detail)}</span></div>
      <div class="offer-secondary"><span>${secondary.label}</span><strong title="${esc(secondary.detail)}">${esc(secondary.value)}</strong><span class="sr-only">${esc(secondary.detail)}</span></div>
    </div>
    <button type="button" class="offer-choose" data-choose="${metric.candidate.cardId}" data-choose-color="${color}" aria-label="記錄：我選了候選 ${slotIndex + 1} ${esc(card.name)}（${colorLabel[color]}）">記錄：我選了這張</button>
  </article>`;
}

function render() {
  captureDetails();
  const focused = document.activeElement as HTMLElement | null;
  const dialogFocus = Boolean(focused?.closest("dialog"));
  const focusSelector = focused?.dataset.pickerCategory ? `[data-picker-category="${focused.dataset.pickerCategory}"]` : focused?.dataset.slotColor ? `[data-slot-color="${focused.dataset.slotColor}"][data-slot-index="${focused.dataset.slotIndex}"]` : focused?.dataset.towerProc ? `[data-tower-proc="${focused.dataset.towerProc}"]` : focused?.dataset.removeCard ? `[data-remove-card="${focused.dataset.removeCard}"]` : focused?.dataset.editTowerProc ? `[data-edit-tower-proc="${focused.dataset.editTowerProc}"]` : focused?.dataset.editRemoveCard ? `[data-edit-remove-card="${focused.dataset.editRemoveCard}"]` : focused?.dataset.outcome ? `[data-outcome="${focused.dataset.outcome}"]` : focused?.dataset.objective ? `[data-objective="${focused.dataset.objective}"]` : focused?.dataset.themeChoice ? `[data-theme-choice="${focused.dataset.themeChoice}"]` : focused?.id ? `#${focused.id}` : null;
  const pickerScroll = app.querySelector(".picker-dialog")?.scrollTop ?? 0;
  const ranked = result?.ranked ?? [];
  const resultReady = calculationStatus === "ready" && Boolean(result);
  const fallback = result?.mode === "highest_expected_score_fallback";
  const exactZero = Boolean(result && result.ranked.length > 0 && result.ranked.every(metric => metric.method === "exact" && metric.thresholdProbability === 0));
  const currentScore = calculateScore(state.selected, () => .5, RULES);
  const scoreSummary = summarizeScore(state.selected, RULES);
  const starPending = state.selected.some((card, index) => card.cardId === "star" && card.activated && !starTargetIds[index]);
  const runActive = Boolean(state.selected.length || candidates.some(Boolean));
  if (colorEditIndex !== null && !candidates[colorEditIndex]) colorEditIndex = null;
  const scoreMethod = scoreSummary.method === "exact" ? "紅色整數百分比完整枚舉" : "紅色效果取樣估算";
  app.innerHTML = `<main class="shell ${layoutMode === "narrow" ? "layout-narrow" : "layout-full"}">
    <header class="header">
      <div class="header-title"><div class="title-row"><h1>尤里亞的占卜計算器</h1><div class="theme-switch" role="group" aria-label="頁面色系">${THEMES.map(item => `<button type="button" data-theme-choice="${item.id}" aria-pressed="${theme === item.id}" aria-label="${item.label}色系" title="${item.label}色系"><span class="theme-chip ${item.id}" aria-hidden="true"></span></button>`).join("")}</div></div><p class="subhead">照遊戲填入三張候選牌，比較推薦，再記錄結果。</p></div>
      <div class="run-status"><strong class="turn-progress">${state.selected.length === 5 ? "五回合完成" : `第 ${state.turn} / 5 回合`}</strong><div class="header-meta" ${state.selected.length ? "" : "hidden"}><span>${starPending ? "星星待結算，暫估平均" : "目前估算平均"}</span><strong class="score-total">${scoreSummary.meanScore.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong><span>分</span></div><button type="button" class="clear-run-action" id="reset" ${runActive ? "" : "hidden"}>清空本局，重新開始</button></div>
    </header>
    ${restoredSession ? `<div class="restored-note" role="status"><span>已恢復這台裝置上的上一局資料。</span><button type="button" class="text-action" id="dismiss-restored">知道了</button></div>` : ""}
    <details class="goal-settings panel" data-detail-key="goal-settings"${detailAttribute("goal-settings")}><summary>推薦目標：${objective.kind === "threshold" ? `達到 ${targetThreshold.toLocaleString()} 分，依達標率排序` : objective.kind === "expected" ? "預期分數最高" : "保守穩定（P10 最高）"}<span class="goal-edit">修改</span></summary><section class="control-bar" aria-label="推薦設定">
      <div class="control-group"><label>你希望怎麼選？</label><div class="segmented" role="group" aria-label="推薦目標"><button data-objective="threshold" aria-pressed="${objective.kind === "threshold"}" class="${objective.kind === "threshold" ? "active" : ""}">達標率</button><button data-objective="expected" aria-pressed="${objective.kind === "expected"}" class="${objective.kind === "expected" ? "active" : ""}">預期分數</button><button data-objective="stability" aria-pressed="${objective.kind === "stability"}" class="${objective.kind === "stability" ? "active" : ""}">穩定</button></div><small class="goal-help">${objective.kind === "threshold" ? "提高達到目標分數的機會" : objective.kind === "expected" ? "優先選平均最終分數較高的牌" : "優先選較保守的結果，不代表保證分數"}</small></div>
      <label class="target-field">目標分數 <input id="target" type="number" min="0" step="100" value="${esc(targetInput)}" aria-invalid="${Boolean(targetError)}" aria-describedby="target-error" /><small id="target-error" class="field-error" ${targetError ? "" : "hidden"}>${esc(targetError)}</small></label>
      <button class="primary-action" id="calculate" aria-live="polite" ${!candidatesReady() || state.selected.length === 5 || calculationStatus === "calculating" || targetError ? "disabled" : ""}>${calculationStatus === "error" ? "重試計算" : calculationStatus === "calculating" ? "計算中…" : "更新推薦"}</button>
    </section></details>
    <div class="layout">
      <section class="history-panel run-strip" aria-labelledby="history-title">
        <div class="run-strip-heading"><h2 id="history-title">已確定卡片</h2>${state.selected.length ? `<p class="run-strip-hint">點小卡可更正顏色與結果</p>` : ""}<div class="run-strip-actions"><button type="button" class="secondary-action" id="undo" ${state.selected.length ? "" : "hidden"}>撤回上一回合</button><button type="button" class="secondary-action" id="add-history" ${state.selected.length < 5 && !targetError ? "" : "hidden"}>＋ 補登已玩卡片</button></div></div>
        <div class="run-strip-list">${renderHistory()}</div>
      </section>
      <section class="workspace">
        ${renderStarResolution()}
        ${renderVerdict(resultReady, fallback, exactZero)}
        ${state.selected.length === 5 ? `<section class="panel completion"><h3 id="completion-title" tabindex="-1">五回合已記錄</h3><p>目前模型估算平均 ${scoreSummary.meanScore.toLocaleString(undefined, { maximumFractionDigits: 1 })} 分（P10 ${scoreSummary.p10.toLocaleString()}～P90 ${scoreSummary.p90.toLocaleString()}）；${scoreMethod}，隨機效果與祝福可能使遊戲結果不同。</p><p>${currentRecord?.status === "recorded" ? "要修正可撤回上一回合；要開下一局，按下方「開始新的一局」。" : "要修正可撤回上一回合；確認無誤後再紀錄本局。"}</p></section>` : `<div class="offer-grid">${resultReady ? candidates.map((candidate, slotIndex) => { const metric = ranked.find(item => item.candidate.cardId === candidate?.cardId); if (!metric) return ""; const rank = ranked.findIndex(item => item.candidate.cardId === candidate?.cardId) + 1; return renderCandidate(slotIndex, metric, rank); }).join("") : candidates.map((candidate, index) => renderPendingCandidate(index, candidate)).join("")}</div>`}
        ${renderActualScorePanel()}
        ${resultReady ? renderCandidateRiskDetails() : ""}
      </section>
    </div>
    <section class="score-breakdown" aria-label="目前計分" ${state.selected.length ? "" : "hidden"}><strong>目前分數組成</strong><span>分數 ${currentScore.sum} × 倍率 ${currentScore.multiplier.toFixed(2)} × 紅色加成 ${(1 + currentScore.redBonus).toFixed(2)} = <b>${currentScore.finalScore}</b></span><small>組成列取紅色中間值；上方估算平均使用${scoreMethod}，祝福尚未納入。${starPending ? "星星移除牌尚未確認，分數暫估。" : ""}</small></section>
    <section class="more-panels" aria-label="紀錄、牌庫與設定">
      <details class="more-panel real-archive" data-detail-key="real-archive"${detailAttribute("real-archive")}><summary>真實牌局紀錄</summary><section class="real-archive-panel"><p id="record-save-status" role="status">${esc(archiveSaveState)}</p><div id="real-archive-body">${renderArchiveBody()}</div></section></details>
      ${renderKnowledgePanels()}
      <details class="more-panel advanced-settings" data-detail-key="advanced-settings"${detailAttribute("advanced-settings")}><summary>設定：版面寬度與模擬次數</summary><div class="advanced-fields"><div class="control-group layout-mode-group"><label>版面寬度</label><div class="segmented" role="group" aria-label="版面寬度"><button type="button" data-layout-mode="full" aria-pressed="${layoutMode === "full"}" class="${layoutMode === "full" ? "active" : ""}">滿版</button><button type="button" data-layout-mode="narrow" aria-pressed="${layoutMode === "narrow"}" class="${layoutMode === "narrow" ? "active" : ""}">窄版</button></div></div><label class="simulation-field">模擬次數 <select id="simulations"><option value="5000" ${simulationCount === 5000 ? "selected" : ""}>5,000（快速）</option><option value="10000" ${simulationCount === 10000 ? "selected" : ""}>10,000（標準）</option><option value="20000" ${simulationCount === 20000 ? "selected" : ""}>20,000（精細）</option></select></label></div></details>
    </section>
    <footer class="footer">推薦由這台裝置上的模型計算；特殊卡、顏色級距與失敗補償已納入，尤里亞的祝福尚未納入。</footer>
    ${renderPicker()}
    ${renderResetDialog()}
    <p class="sr-only" aria-live="polite">${resultReady && ranked[0] ? `推薦已更新：建議選 ${esc(offerLabel(ranked[0]))}` : calculationStatus === "calculating" ? "正在計算推薦" : calculationStatus === "error" ? "推薦計算失敗，可重試" : state.selected.length === 5 ? "本局已完成" : ""}</p>
    ${pendingChoice ? renderOutcomeDialog() : ""}
    ${pendingEditIndex !== null ? renderEditOutcomeDialog() : ""}
  </main>`;
  bindEvents();
  const dialog = app.querySelector<HTMLDialogElement>("dialog");
  document.body.classList.toggle("modal-open", Boolean(dialog));
  if (dialog) {
    dialog.showModal();
    dialog.addEventListener("cancel", event => { event.preventDefault(); if (pendingEditIndex !== null) closeEditDialog(); else if (resetConfirmationOpen) closeResetConfirmation(); else closeDialog(); });
    dialog.addEventListener("keydown", event => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')).filter(element => element.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    const restoredFocus = dialogFocus && focusSelector ? app.querySelector<HTMLElement>(focusSelector) : null;
    const nextFocus = restoredFocus ?? (pendingEditIndex !== null ? app.querySelector<HTMLElement>("[data-edit-tower-proc], [data-edit-remove-card], [data-edit-commit]") : pickerIndex !== null ? app.querySelector<HTMLElement>(`[data-picker-category="${pickerCategory}"]`) : pendingChoice && pendingOutcome && pendingChoice.cardId === "tower" ? app.querySelector<HTMLElement>('[data-tower-proc="false"]') : pendingChoice && pendingOutcome ? app.querySelector<HTMLElement>("[data-commit-outcome]") : pendingChoice ? app.querySelector<HTMLElement>('[data-outcome="success"]') : null);
    nextFocus?.focus({ preventScroll: true });
    dialog.scrollTop = pickerScroll;
  }
}

function createWorker() {
  const next = new Worker(new URL("./recommend.worker.ts", import.meta.url), { type: "module" });
  next.addEventListener("message", event => handleWorkerMessage(next, event));
  next.addEventListener("error", () => handleWorkerError(next));
  return next;
}

function replaceWorker() {
  worker?.terminate();
  worker = createWorker();
  return worker;
}

function cancelPendingCalculation() {
  requestId++;
  if (calculationTimer !== undefined) window.clearTimeout(calculationTimer);
  calculationTimer = undefined;
  replaceWorker();
}

function renderAfterWorker() {
  if (pickerIndex !== null) return;
  const activePick = document.activeElement?.getAttribute("data-pick");
  render();
  if (activePick !== null) app.querySelector<HTMLElement>(`[data-pick="${activePick}"]`)?.focus();
}

function handleWorkerMessage(source: Worker, event: MessageEvent<WorkerMessage>) {
  const message = event.data;
  if (source !== worker || message.requestId !== requestId) return;
  if (message.type === "ERROR") {
    result = null;
    calculationStatus = "error";
    calculationError = message.message || "推薦計算失敗，請重試。";
  } else {
    result = message.result;
    calculationStatus = "ready";
  }
  renderAfterWorker();
}

function handleWorkerError(source: Worker) {
  if (source !== worker) return;
  replaceWorker();
  requestId++;
  if (calculationStatus !== "calculating") return;
  result = null;
  calculationStatus = "error";
  calculationError = "推薦計算執行失敗，輸入仍保留，請重試。";
  renderAfterWorker();
}

function calculate() {
  cancelPendingCalculation();
  syncCurrentRecord();
  persistSession();
  if (state.selected.length >= 5 || !candidatesReady()) {
    result = null;
    calculationStatus = "idle";
    calculationError = "";
    render();
    return;
  }
  result = null;
  calculationStatus = "calculating";
  calculationError = "";
  render();
  const currentRequest = requestId;
  calculationTimer = window.setTimeout(() => {
    calculationTimer = undefined;
    try {
      worker?.postMessage({ type: "RECOMMEND", requestId: currentRequest, state: cloneState(state), candidates: candidates as OfferedCard[], objective, simulations: simulationCount, seed: CALCULATION_SEED, rules: currentRecord?.rulesSnapshot ?? RULES, targetThreshold });
    } catch {
      handleWorkerError(worker!);
    }
  }, 150);
}

function renderResetDialog() {
  return resetConfirmationOpen ? `<dialog class="picker-dialog outcome-dialog reset-dialog" aria-labelledby="reset-title" aria-describedby="reset-description">
    <h2 id="reset-title">要清空本局並重新開始嗎？</h2>
    <p id="reset-description">${currentRecord?.status === "recorded" ? "本局已紀錄，不會被刪除；清空的是畫面上的已確定卡片與候選牌。" : "這會清除本局已確定卡片、三張候選牌與尚未儲存的進度。已按「紀錄本局」儲存的牌局會保留。"}</p>
    <div class="reset-actions"><button type="button" class="secondary-action" data-reset-cancel autofocus>保留本局</button><button type="button" class="danger-action" data-reset-confirm>清空本局，重新開始</button></div>
  </dialog>` : "";
}

function resetCurrentGame() {
  closeRunEdits();
  state = { turn: 1, selected: [] };
  turnSnapshots = [];
  starTargetIds = [];
  candidates = [null, null, null];
  candidateColors = defaultSlotColors(); colorEditIndex = null;
  currentRecord = null;
  scoreEditing = false;
  pickerIndex = null;
  resetConfirmationOpen = false;
  restoredSession = false;
  targetError = "";
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore unavailable storage */ }
  calculate();
  app.querySelector<HTMLElement>('[data-pick="0"]')?.focus();
}

function closeResetConfirmation() {
  resetConfirmationOpen = false;
  render();
  app.querySelector<HTMLElement>(resetReturnFocus)?.focus();
}

function applyPickerChoice(cardId: CardId, color: CardColor) {
  if (pickerIndex === null || usageLabelForPicker(cardId)) return;
  if (pickerIndex === -1) { pendingChoice = { cardId, color }; pendingChoiceSource = "manual"; pickerIndex = null; render(); return; }
  candidates[pickerIndex] = { cardId, color };
  candidateColors[pickerIndex] = color;
  pickerIndex = null;
  calculate();
  app.querySelector<HTMLElement>(returnFocus)?.focus();
}

function bindEvents() {
  app.querySelectorAll<HTMLSelectElement>("[data-history-color]").forEach(select => select.addEventListener("change", () => { startRecordCorrection(); state.selected[Number(select.dataset.historyColor)]!.color = select.value as CardColor; calculate(); }));
  app.querySelectorAll<HTMLButtonElement>("[data-history-result]").forEach(button => button.addEventListener("click", () => editHistoryResult(Number(button.dataset.historyResult), button.dataset.activated === "true")));
  app.querySelectorAll<HTMLInputElement>("[data-history-removed]").forEach(input => input.addEventListener("change", () => { startRecordCorrection(); state.selected[Number(input.dataset.historyRemoved)]!.removed = input.checked; calculate(); }));
  app.querySelectorAll<HTMLButtonElement>("[data-edit-tower-proc]").forEach(button => button.addEventListener("click", () => { pendingEditTowerProc = button.dataset.editTowerProc === "true"; render(); }));
  app.querySelectorAll<HTMLButtonElement>("[data-edit-remove-card]").forEach(button => button.addEventListener("click", () => { pendingEditRemovedCardId = button.dataset.editRemoveCard as CardId; render(); }));
  app.querySelector<HTMLButtonElement>("[data-edit-commit]")?.addEventListener("click", commitEditResult);
  app.querySelector<HTMLButtonElement>("[data-edit-cancel]")?.addEventListener("click", closeEditDialog);
  app.querySelectorAll<HTMLButtonElement>("[data-picker-category]").forEach(button => button.addEventListener("click", () => { pickerCategory = button.dataset.pickerCategory as typeof pickerCategory; render(); }));
  app.querySelectorAll<HTMLButtonElement>("[data-objective]").forEach(button => button.addEventListener("click", () => { const kind = button.dataset.objective as Objective["kind"]; objective = kind === "threshold" ? { kind, target: targetThreshold } : { kind }; calculate(); }));
  // Switching palettes only touches <html data-theme> and the pressed states, so focus and open panels stay put.
  app.querySelectorAll<HTMLButtonElement>("[data-theme-choice]").forEach(button => button.addEventListener("click", () => {
    theme = button.dataset.themeChoice === "amber" || button.dataset.themeChoice === "night" ? button.dataset.themeChoice : "mist";
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* keep the palette for this session */ }
    applyTheme(theme);
    app.querySelectorAll<HTMLButtonElement>("[data-theme-choice]").forEach(item => item.setAttribute("aria-pressed", String(item.dataset.themeChoice === theme)));
  }));
  app.querySelectorAll<HTMLButtonElement>("[data-layout-mode]").forEach(button => button.addEventListener("click", () => {
    layoutMode = button.dataset.layoutMode === "narrow" ? "narrow" : "full";
    try { localStorage.setItem(LAYOUT_MODE_KEY, layoutMode); } catch { /* keep the current view for this session */ }
    render();
  }));
  app.querySelector<HTMLInputElement>("#target")?.addEventListener("change", event => { targetInput = (event.target as HTMLInputElement).value.trim(); const target = Number(targetInput); if (!targetInput || !Number.isInteger(target) || !Number.isFinite(target) || target < 0) { cancelPendingCalculation(); result = null; calculationStatus = "idle"; calculationError = ""; targetError = "請輸入 0 或以上的整數分數。"; render(); return; } targetError = ""; targetThreshold = target; if (objective.kind === "threshold") objective = { kind: "threshold", target }; calculate(); });
  app.querySelector<HTMLSelectElement>("#simulations")?.addEventListener("change", event => { simulationCount = Number((event.target as HTMLSelectElement).value); calculate(); });
  app.querySelector<HTMLButtonElement>("#calculate")?.addEventListener("click", calculate);
  app.querySelector<HTMLButtonElement>("#retry-calculation")?.addEventListener("click", calculate);
  app.querySelector<HTMLButtonElement>("#dismiss-restored")?.addEventListener("click", () => { restoredSession = false; render(); });
  const openResetConfirmation = (trigger: string) => {
    if (state.selected.length || candidates.some(Boolean)) {
      resetReturnFocus = trigger;
      resetConfirmationOpen = true;
      render();
    } else resetCurrentGame();
  };
  app.querySelector<HTMLButtonElement>("#reset")?.addEventListener("click", () => openResetConfirmation("#reset"));
  app.querySelector<HTMLButtonElement>("[data-reset-open]")?.addEventListener("click", () => openResetConfirmation("[data-reset-open]"));
  app.querySelector<HTMLButtonElement>("[data-reset-cancel]")?.addEventListener("click", closeResetConfirmation);
  app.querySelector<HTMLButtonElement>("[data-reset-confirm]")?.addEventListener("click", resetCurrentGame);
  app.querySelector<HTMLButtonElement>("#undo")?.addEventListener("click", () => {
    const previous = turnSnapshots.pop();
    if (!previous) return;
    closeRunEdits();
    startRecordCorrection();
    state = cloneState(previous.state);
    starTargetIds = cloneTargets(previous.starTargets);
    selectedCandidateKey = "";
    pendingChoice = null;
    pendingOutcome = null;
    pendingTowerProc = null;
    pendingRemovedCardId = null;
    pendingEditIndex = null;
    pendingEditTowerProc = null;
    pendingEditRemovedCardId = null;
    candidates = [null, null, null];
    candidateColors = defaultSlotColors(); colorEditIndex = null;
    calculate();
  });
  app.querySelectorAll<HTMLButtonElement>("[data-slot-color]").forEach(button => button.addEventListener("click", () => {
    const index = Number(button.dataset.slotIndex);
    const color = button.dataset.slotColor as CardColor;
    candidateColors[index] = color;
    if (candidates[index]) candidates[index] = { ...candidates[index]!, color };
    colorEditIndex = null;
    calculate();
    app.querySelector<HTMLElement>(`#color-toggle-${index}`)?.focus();
  }));
  app.querySelectorAll<HTMLButtonElement>("[data-color-toggle]").forEach(button => button.addEventListener("click", () => {
    const index = Number(button.dataset.colorToggle);
    colorEditIndex = colorEditIndex === index ? null : index;
    render();
    app.querySelector<HTMLElement>(colorEditIndex === index ? `[data-slot-color][data-slot-index="${index}"][aria-pressed="true"]` : `#color-toggle-${index}`)?.focus();
  }));
  app.querySelectorAll<HTMLElement>("[data-pick]").forEach(trigger => trigger.addEventListener("click", () => { pickerCategory = "all"; const index = Number(trigger.dataset.pick); returnFocus = `[data-pick="${index}"]`; pickerIndex = index; render(); }));
  app.querySelectorAll<HTMLButtonElement>("[data-picker-direct-card]").forEach(button => button.addEventListener("click", () => applyPickerChoice(button.dataset.pickerDirectCard as CardId, button.dataset.pickerDirectColor as CardColor)));
  app.querySelectorAll<HTMLButtonElement>("[data-picker-cancel]").forEach(button => button.addEventListener("click", closeDialog));
  app.querySelector<HTMLButtonElement>("#add-history")?.addEventListener("click", () => { pickerCategory = "all"; returnFocus = "#add-history"; pickerIndex = -1; render(); });
  app.querySelectorAll<HTMLButtonElement>("[data-choose]").forEach(button => button.addEventListener("click", () => addHistory(button.dataset.choose as CardId, button.dataset.chooseColor as CardColor)));
  app.querySelectorAll<HTMLButtonElement>("[data-tower-proc]").forEach(button => button.addEventListener("click", () => { pendingTowerProc = button.dataset.towerProc === "true"; render(); }));
  app.querySelectorAll<HTMLButtonElement>("[data-final-star-target]").forEach(button => button.addEventListener("click", () => { const index = unresolvedStarIndex(); const target = state.selected.find(card => card.cardId === button.dataset.finalStarTarget); if (index < 0 || !target || target.cardId === "star" || target.removed) return; closeRunEdits(); startRecordCorrection(); target.removed = true; starTargetIds[index] = target.cardId; calculate(); app.querySelector<HTMLElement>("#completion-title")?.focus(); }));
  app.querySelectorAll<HTMLButtonElement>("[data-outcome]").forEach(button => button.addEventListener("click", () => {
    if (button.dataset.outcome === "cancel") { closeDialog(); return; }
    if (!pendingChoice || state.selected.length >= 5) return;
    const outcome = button.dataset.outcome as "success" | "failure";
    pendingOutcome = outcome;
    render();
  }));
  app.querySelector<HTMLButtonElement>("[data-commit-outcome]")?.addEventListener("click", () => { if (!pendingOutcome || (pendingOutcome === "success" && pendingChoice?.cardId === "tower" && pendingTowerProc === null)) return; commitOutcome(pendingOutcome); });
  app.querySelector<HTMLFormElement>("#actual-score-form")?.addEventListener("submit", event => {
    event.preventDefault();
    if (state.selected.length !== 5 || unresolvedStarIndex() !== -1) return;
    const raw = app.querySelector<HTMLInputElement>("#actual-final-score")!.value.trim();
    const value = raw === "" ? null : Number(raw);
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) { archiveNotice = "實得分數請填 0 或以上的整數，或留空。"; refreshArchiveBody(); return; }
    if (scoreEditing) startRecordCorrection();
    syncCurrentRecord();
    if (!currentRecord) return;
    currentRecord.status = "recorded";
    currentRecord.actualFinalScore = value;
    currentRecord.modelFinalScore = value === null ? Math.round(summarizeScore(state.selected, currentRecord.rulesSnapshot).meanScore) : null;
    currentRecord.evidenceLevel = value === null ? null : app.querySelector<HTMLSelectElement>("#score-evidence")!.value as EvidenceLevel;
    currentRecord.completedAt = new Date().toISOString();
    currentRecord.updatedAt = currentRecord.completedAt;
    scoreEditing = false;
    archiveNotice = cloudUser ? "已紀錄本局，並會同步到你的雲端帳號。" : "已紀錄本局，存在這台裝置；登入 GitHub 後可上傳到雲端。";
    persistSession();
    queueRecordSave();
    render();
  });
  app.querySelector<HTMLButtonElement>("#edit-actual-score")?.addEventListener("click", () => { scoreEditing = true; render(); app.querySelector<HTMLInputElement>("#actual-final-score")?.focus(); });
  app.querySelector<HTMLButtonElement>("#cancel-score-edit")?.addEventListener("click", () => { scoreEditing = false; render(); });
  bindArchiveEvents();
  bindCloudEvents();
}

function bindCloudEvents() {
  app.querySelector<HTMLButtonElement>("#cloud-sign-in")?.addEventListener("click", async () => {
    try { cloudStatus = "正在前往 GitHub 登入…"; refreshArchiveBody(); await signInWithGitHub(); }
    catch (error) { cloudStatus = `無法開始 GitHub 登入：${errorMessage(error)}`; refreshArchiveBody(); }
  });
  app.querySelector<HTMLButtonElement>("#cloud-sign-out")?.addEventListener("click", async () => {
    try { await signOutCloud(); cloudUser = null; resetCloudState(); cloudStatus = "已登出；這台裝置上的紀錄仍保留。"; }
    catch (error) { cloudStatus = `登出失敗：${errorMessage(error)}`; }
    refreshArchiveBody();
  });
  app.querySelector<HTMLButtonElement>("#cloud-sync")?.addEventListener("click", () => { void syncCloudGames(); });
  app.querySelector<HTMLButtonElement>("#upload-pending-games")?.addEventListener("click", () => { void uploadPendingGames(); });
}

// Supabase errors are plain objects with a message, not always Error instances.
function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === "object" && error !== null && "message" in error ? String(error.message) : "未知錯誤";
}

function resetCloudState() {
  cloudRevisions = null;
  cloudConflictIds = new Set();
  cloudSkipped = 0;
  cloudSyncedAt = null;
}

/** Applies a sign-in change once per user, then merges that player's cloud games automatically. */
function handleCloudUser(user: User | null) {
  if (user?.id === cloudUser?.id) return;
  cloudUser = user;
  resetCloudState();
  cloudStatus = user ? "已登入，正在同步雲端紀錄…" : "尚未登入；本機紀錄照常使用。";
  refreshArchiveBody();
  if (user) void syncCloudGames();
}

/** Downloads the signed-in player's games and merges them into the local archive. Only one run at a time. */
function syncCloudGames(): Promise<void> {
  const owner = cloudUser;
  if (!owner) return Promise.resolve();
  if (cloudSyncRun) return cloudSyncRun;
  cloudBusy = true;
  cloudStatus = "正在同步雲端紀錄…";
  refreshArchiveBody();
  cloudSyncRun = (async () => {
    try {
      await recordSaveQueue; // let pending local saves and uploads finish first
      const { games: remote, skipped } = await downloadRecordedGames();
      if (cloudUser?.id !== owner.id) return; // signed out during the download
      const merge = mergeGames(await listGames(), remote);
      await saveGames(merge.toStore);
      archiveGames = await listGames();
      cloudRevisions = new Map(remote.map(game => [game.id, game.revision]));
      cloudConflictIds = new Set(merge.conflictIds);
      cloudSkipped = skipped;
      cloudSyncedAt = new Date().toISOString();
      cloudStatus = merge.toStore.length ? `已從雲端取回 ${merge.toStore.length} 局。` : "已同步，雲端沒有新的牌局。";
    } catch (error) {
      cloudStatus = `雲端同步失敗，這台裝置的紀錄照常可用：${errorMessage(error)}`;
    } finally {
      cloudBusy = false;
      cloudSyncRun = null;
      refreshArchiveBody();
    }
  })();
  return cloudSyncRun;
}

/** Uploads recorded games that the cloud lacks or holds at an older revision, only after the player asks. */
async function uploadPendingGames() {
  const owner = cloudUser;
  if (!owner || !cloudRevisions || cloudBusy) return;
  const pending = gamesNeedingUpload(archiveGames, cloudRevisions, cloudConflictIds);
  if (!pending.length) return;
  cloudBusy = true;
  cloudStatus = `正在上傳 ${pending.length} 局…`;
  refreshArchiveBody();
  let failed = 0;
  for (const game of pending) {
    try {
      await uploadRecordedGame(game, owner);
      if (cloudUser?.id === owner.id) cloudRevisions?.set(game.id, game.revision);
    } catch { failed++; }
  }
  cloudBusy = false;
  cloudStatus = failed ? `已上傳 ${pending.length - failed} 局；${failed} 局失敗，本機紀錄保留，可再按一次上傳。` : `已上傳 ${pending.length} 局到你的雲端帳號。`;
  refreshArchiveBody();
}

function bindArchiveEvents() {
  app.querySelector<HTMLButtonElement>("#export-real-games")?.addEventListener("click", async () => {
    await recordSaveQueue;
    const games = [...archiveGames];
    if (currentRecord?.status === "recorded") {
      const index = games.findIndex(game => game.id === currentRecord!.id);
      if (index >= 0) games[index] = currentRecord;
      else games.push(currentRecord);
    }
    const blob = new Blob([JSON.stringify(exportEnvelope(games), null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `yuria-real-games-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
  });
  app.querySelector<HTMLInputElement>("#import-real-games")?.addEventListener("change", async event => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error("檔案超過 5 MB，請分批匯入。");
      const games = parseExport(JSON.parse(await file.text()));
      const result = await importGames(games);
      archiveGames = await listGames();
      archiveNotice = `匯入 ${result.added} 局；略過重複 ${result.skipped} 局。`;
    } catch (error) { archiveNotice = error instanceof Error ? error.message : "匯入失敗；沒有修改原有資料。"; }
    refreshArchiveBody();
  });
}

function renderActualScorePanel() {
  if (state.selected.length !== 5 || unresolvedStarIndex() !== -1) return "";
  const summary = summarizeScore(state.selected, currentRecord?.rulesSnapshot ?? RULES);
  const modelScore = Math.round(summary.meanScore);
  const range = summary.minScore === summary.maxScore ? "" : `（可能 ${summary.minScore}–${summary.maxScore} 分；非實得分數）`;
  if (currentRecord?.status === "recorded" && !scoreEditing) return `<section class="real-score-panel panel"><h3>本局已記錄</h3><p>模型估算平均 ${summary.meanScore.toFixed(1)} 分；${currentRecord.actualFinalScore !== null ? `遊戲實得 ${currentRecord.actualFinalScore.toLocaleString()} 分` : currentRecord.modelFinalScore != null ? `模型計算 ${currentRecord.modelFinalScore.toLocaleString()} 分${range}，實得分數未填` : "實得分數未填"}。</p><div class="real-score-actions"><button type="button" class="secondary-action" id="edit-actual-score">更正本局紀錄</button><button type="button" class="primary-action new-game-action" data-reset-open>開始新的一局</button></div></section>`;
  return `<section class="real-score-panel panel"><h3>紀錄這一局</h3><p>五回合已完成；按下「紀錄本局」才加入本機紀錄。實得分數留白時，另記模型計算 ${modelScore.toLocaleString()} 分${range}，不當作實得分數。</p><form id="actual-score-form"><label>遊戲實得分數（可留空） <input id="actual-final-score" type="number" min="0" step="1" value="${scoreEditing && currentRecord?.actualFinalScore !== null ? currentRecord?.actualFinalScore ?? "" : ""}" /></label><label>實得分數的證據來源 <select id="score-evidence"><option value="player_report">玩家回報</option><option value="screen_verified">已核對遊戲畫面</option></select></label><button class="primary-action" type="submit">紀錄本局</button>${scoreEditing ? `<button class="text-action" type="button" id="cancel-score-edit">取消更正</button>` : ""}</form></section>`;
}

function wilsonInterval(success: number, total: number): string {
  if (!total) return "樣本不足";
  const z = 1.96;
  const p = success / total;
  const denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const spread = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator;
  return `${Math.round((center - spread) * 100)}–${Math.round((center + spread) * 100)}%`;
}

function cloudLabel(game: RealGameRecordV1) {
  if (!cloudUser || !cloudRevisions) return "";
  if (cloudConflictIds.has(game.id)) return " · 兩邊內容不同";
  const remote = cloudRevisions.get(game.id);
  return remote === undefined ? " · 只在這台裝置" : remote < game.revision ? " · 更正未上傳" : " · 已同步";
}

function renderCloudSync() {
  if (!cloudUser) return `<div class="archive-sync"><h3>只存在這台裝置</h3><p>登入 GitHub 後，會自動合併你存在雲端的牌局。</p><p id="cloud-status" role="status">${esc(cloudStatus)}</p><div class="archive-actions"><button type="button" class="secondary-action" id="cloud-sign-in">使用 GitHub 登入</button></div></div>`;
  const revisions = cloudRevisions;
  const recorded = archiveGames.filter(game => game.status === "recorded");
  const pending = revisions ? gamesNeedingUpload(archiveGames, revisions, cloudConflictIds) : [];
  const syncedTime = cloudSyncedAt ? new Date(cloudSyncedAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }) : "";
  const stats = revisions ? archiveStats([
    ["總局數", recorded.length],
    ["雲端", revisions.size],
    ["只在這台", recorded.filter(game => !revisions.has(game.id)).length],
    ["待上傳", pending.length],
    ...(cloudConflictIds.size ? [["內容不同", cloudConflictIds.size, "is-warning"] as const] : [])
  ]) : `<p>還沒同步雲端。</p>`;
  const notes = [
    cloudConflictIds.size ? `${cloudConflictIds.size} 局兩邊內容不同：保留這台裝置的版本，沒有覆寫雲端；可匯出 JSON 核對。` : "",
    cloudSkipped ? `雲端有 ${cloudSkipped} 筆格式不相容，已略過。` : ""
  ].filter(Boolean).map(text => `<p class="archive-note">${esc(text)}</p>`).join("");
  return `<div class="archive-sync"><h3>這台裝置＋雲端${syncedTime ? `<small>上次同步 ${syncedTime}</small>` : ""}</h3>${stats}<p id="cloud-status" role="status">${esc(cloudStatus)}</p>${notes}
    <div class="archive-actions">${pending.length ? `<button type="button" class="primary-action" id="upload-pending-games">上傳這 ${pending.length} 局</button>` : ""}<button type="button" class="secondary-action" id="cloud-sync" aria-busy="${cloudBusy}">${cloudBusy ? "處理中…" : "重新同步"}</button><span class="archive-account">${esc(cloudUser.email ?? cloudUser.id)}<button type="button" class="text-action" id="cloud-sign-out">登出</button></span></div>
    <small>按「紀錄本局」後會自動同步；更早的本機紀錄要按「上傳」才會送出。</small></div>`;
}

/** Counts as a row of labelled numbers instead of a sentence. */
function archiveStats(items: ReadonlyArray<readonly [string, number, string?]>) {
  return `<dl class="archive-stats">${items.map(([label, value, tone]) => `<div class="${tone ?? ""}"><dt>${esc(label)}</dt><dd>${value.toLocaleString()}</dd></div>`).join("")}</dl>`;
}

function renderArchiveBody() {
  const summary = summarizeRealGames(archiveGames);
  const cardRows = [...summary.clickCounts].sort((a, b) => b[1].total - a[1].total).map(([id, count]) =>
    `<li>${esc(cardName(id))}：點選 ${count.total} 次、成功 ${count.success} 次；${count.total >= 30 ? `成功率 ${Math.round(count.success / count.total * 100)}%（95% 區間 ${wilsonInterval(count.success, count.total)}）` : "樣本不足，暫不校準機率"}</li>`).join("");
  const colorText = (color: CardColor) => `${colorLabel[color]} ${summary.offerColors[color]}`;
  const entries = archiveGames.slice(0, 12).map(game => `<li><time>${esc(game.createdAt.slice(0, 10))}</time> · ${game.rounds.length}/5 回合 · ${game.actualFinalScore !== null ? `實得 ${game.actualFinalScore} 分` : game.modelFinalScore != null ? `模型計算 ${game.modelFinalScore} 分（非實得）` : "實得分數未填"} · 修訂 ${game.revision}${cloudLabel(game)}</li>`).join("");
  const storageNote = cloudUser
    ? "紀錄存在這台瀏覽器，也會同步到你的雲端帳號；清除網站資料後，已上傳的局登入即可取回。"
    : "資料存在這台瀏覽器；清除網站資料會遺失。可匯出 JSON 備份，或登入 GitHub 同步到雲端。";
  return `${renderCloudSync()}<p role="status">${esc(archiveNotice)}</p>
    <h3>紀錄內容</h3>${archiveStats([["已記錄", summary.recordedCount], ["有實得分數", summary.scoredCount], ["模型計算分數", summary.modelScoredCount], ["五回合候選齊全", summary.completeWithOffersCount]])}
    <ul class="archive-facts">
      <li>實得平均：${summary.scoredCount < 30 ? `樣本不足（${summary.scoredCount}/30），暫不顯示個人達標率` : `${summary.averageScore!.toFixed(1)} 分`}</li>
      ${summary.modelScoredCount ? `<li>模型計算平均：${summary.modelAverageScore!.toFixed(1)} 分（不併入實測）</li>` : ""}
      <li>候選顏色：${colorText("blue")}／${colorText("purple")}／${colorText("red")}（共 ${summary.observedOffers} 張）</li>
      <li>終局預測與實得差：${summary.residualCount >= 30 ? `${summary.scoreResidualMean!.toFixed(1)} 分，n=${summary.residualCount}` : `樣本不足（${summary.residualCount}/30）`}</li>
    </ul>
    <details data-detail-key="archive-cards"${detailAttribute("archive-cards")}><summary>查看點選後成功次數</summary><ul>${cardRows || "<li>尚無完整實測</li>"}</ul><small>未點選牌不計為失敗；模擬局與舊五局分數不在這裡。</small></details>
    <details data-detail-key="archive-recent"${detailAttribute("archive-recent")}><summary>查看最近牌局</summary><ul>${entries || "<li>尚無牌局紀錄</li>"}</ul></details>
    <div class="archive-actions"><button type="button" class="secondary-action" id="export-real-games">匯出 JSON 備份</button><label>匯入 JSON <input id="import-real-games" type="file" accept="application/json,.json" /></label></div>
    <small>${storageNote}</small>`;
}

function startRecordCorrection() {
  if (!currentRecord || currentRecord.status !== "recorded") return;
  currentRecord.revisions.push({ at: new Date().toISOString(), previousScore: currentRecord.actualFinalScore, previousModelScore: currentRecord.modelFinalScore ?? null, previousRounds: structuredClone(currentRecord.rounds) });
  currentRecord.revision++;
  currentRecord.status = "draft";
  currentRecord.actualFinalScore = null;
  currentRecord.modelFinalScore = null;
  currentRecord.evidenceLevel = null;
  currentRecord.completedAt = null;
  scoreEditing = false;
}

function syncCurrentRecord() {
  if (!currentRecord && !state.selected.length) return;
  if (!currentRecord) currentRecord = createGameRecord(CALCULATION_SEED, simulationCount);
  currentRecord.rounds = state.selected.map((card, index): RealRound => {
    const previous = currentRecord!.rounds[index];
    return {
      turn: index + 1,
      offers: previous?.offers ?? null,
      objective: previous?.objective ?? structuredClone(objective),
      target: previous?.target ?? targetThreshold,
      recommendedCardId: previous?.recommendedCardId ?? null,
      predictions: previous?.predictions ?? null,
      chosen: { cardId: card.cardId, color: card.color },
      activated: card.activated,
      towerProc: card.cardId === "tower" && card.activated ? card.towerProc ?? null : null,
      starRemovedCardId: card.cardId === "star" && card.activated ? starTargetIds[index] ?? null : null
    };
  });
  if (currentRecord.status !== "recorded") currentRecord.status = "draft";
  currentRecord.updatedAt = new Date().toISOString();
}

function captureChosenRound(chosen: OfferedCard, activated: boolean): RealRound {
  const hasObservedOffers = pendingChoiceSource === "candidate" && candidatesReady() && candidates.some(card => card?.cardId === chosen.cardId && card.color === chosen.color);
  const offers = hasObservedOffers ? candidates.map(card => ({ cardId: card!.cardId, color: card!.color, catalogProbability: CARDS[card!.cardId].activationProbability, observedProbability: null })) as RealRound["offers"] : null;
  const predictions = hasObservedOffers && result?.ranked.length === 3 ? result.ranked.map(metric => ({ cardId: metric.candidate.cardId, meanScore: metric.meanScore,
    thresholdProbability: metric.thresholdProbability, p10: metric.p10, p50: metric.p50, p90: metric.p90, method: metric.method })) : null;
  return { turn: state.selected.length + 1, offers, objective: structuredClone(objective), target: targetThreshold,
    recommendedCardId: offers && result?.ranked[0] ? result.ranked[0].candidate.cardId : null, predictions,
    chosen: { ...chosen }, activated, towerProc: chosen.cardId === "tower" && activated ? pendingTowerProc : null,
    starRemovedCardId: chosen.cardId === "star" && activated ? pendingRemovedCardId : null };
}

function refreshArchiveBody() {
  const body = app.querySelector<HTMLElement>("#real-archive-body");
  if (body) {
    // Background syncs redraw this panel; keep open sections and the keyboard position.
    const active = document.activeElement instanceof HTMLElement && body.contains(document.activeElement) ? document.activeElement : null;
    const detailKey = active?.parentElement instanceof HTMLDetailsElement ? active.parentElement.dataset.detailKey : undefined;
    const selector = active?.id ? `#${active.id}` : detailKey ? `details[data-detail-key="${detailKey}"] > summary` : null;
    captureDetails();
    body.innerHTML = renderArchiveBody();
    bindArchiveEvents();
    bindCloudEvents();
    if (active) ((selector ? body.querySelector<HTMLElement>(selector) : null) ?? body.querySelector<HTMLElement>("#cloud-sync, #cloud-sign-in"))?.focus();
  }
  const status = app.querySelector<HTMLElement>("#record-save-status");
  if (status) status.textContent = archiveSaveState;
}

function queueRecordSave() {
  if (!currentRecord || currentRecord.status !== "recorded") return;
  const snapshot = structuredClone(currentRecord);
  const cloudOwner = cloudUser;
  archiveSaveState = "正在儲存牌局…";
  recordSaveQueue = recordSaveQueue.then(async () => {
    await saveGame(snapshot);
    archiveGames = await listGames();
    archiveSaveState = "已儲存於這台裝置";
    refreshArchiveBody();
    if (cloudOwner) {
      try {
        await uploadRecordedGame(snapshot, cloudOwner);
        if (cloudUser?.id === cloudOwner.id) cloudRevisions?.set(snapshot.id, snapshot.revision);
        cloudStatus = "本局已同步至你的雲端帳號。";
      } catch (error) { cloudStatus = `本機已儲存；雲端同步失敗，可稍後按「上傳」：${errorMessage(error)}`; }
      refreshArchiveBody();
    }
  }).catch(() => {
    archiveSaveState = "牌局資料庫儲存失敗；請先匯出 JSON，避免資料遺失。";
    refreshArchiveBody();
  });
}

async function loadArchive() {
  try { archiveGames = await listGames(); archiveSaveState = "本機牌局資料庫已就緒"; }
  catch { archiveSaveState = "牌局資料庫無法開啟；本局仍暫存在瀏覽器工作階段。"; }
  refreshArchiveBody();
}

function starEditTargets(index: number): SelectedCard[] {
  const currentTarget = starTargetIds[index];
  return state.selected.filter(card => card.cardId !== "star" &&
    (!card.removed || card.cardId === currentTarget) && (RULES.starRemovalPolicy === "uniformPresent" || card.activated)
  );
}

function editHistoryResult(index: number, activated: boolean) {
  const card = state.selected[index];
  if (!card) return;
  if (activated && card.cardId === "star" && state.selected.length < 5) {
    startRecordCorrection(); card.activated = true; calculate(); return;
  }
  if (activated && (card.cardId === "star" || card.cardId === "tower")) {
    pendingEditIndex = index;
    pendingEditTowerProc = card.cardId === "tower" && card.activated ? card.towerProc ?? null : null;
    pendingEditRemovedCardId = card.cardId === "star" && card.activated ? starTargetIds[index] : null;
    render();
    return;
  }
  startRecordCorrection();
  if (card.cardId === "star" && !activated && starTargetIds[index]) {
    const target = state.selected.find(item => item.cardId === starTargetIds[index]);
    if (target) target.removed = false;
    starTargetIds[index] = null;
  }
  if (card.cardId === "tower" && !activated) delete card.towerProc;
  card.activated = activated;
  calculate();
}

function closeEditDialog() {
  const index = pendingEditIndex;
  pendingEditIndex = null;
  pendingEditTowerProc = null;
  pendingEditRemovedCardId = null;
  render();
  if (index !== null) app.querySelector<HTMLElement>(`[data-history-result="${index}"][data-activated="true"]`)?.focus();
}

function commitEditResult() {
  const index = pendingEditIndex;
  if (index === null) return;
  const card = state.selected[index];
  if (!card) return;
  startRecordCorrection();
  if (card.cardId === "tower") {
    if (pendingEditTowerProc === null) return;
    card.towerProc = pendingEditTowerProc;
  }
  if (card.cardId === "star") {
    const targets = starEditTargets(index);
    if (targets.length && !pendingEditRemovedCardId) return;
    const oldTarget = state.selected.find(item => item.cardId === starTargetIds[index]);
    if (oldTarget) oldTarget.removed = false;
    const newTarget = state.selected.find(item => item.cardId === pendingEditRemovedCardId);
    if (newTarget) newTarget.removed = true;
    starTargetIds[index] = pendingEditRemovedCardId;
  }
  card.activated = true;
  pendingEditIndex = null;
  pendingEditTowerProc = null;
  pendingEditRemovedCardId = null;
  calculate();
  app.querySelector<HTMLElement>(`[data-history-result="${index}"][data-activated="true"]`)?.focus();
}

function renderEditOutcomeDialog() {
  const index = pendingEditIndex!;
  const card = state.selected[index]!;
  const targets = card.cardId === "star" ? starEditTargets(index) : [];
  const choices = card.cardId === "tower"
    ? `<fieldset><legend>高塔實際倍率</legend><div class="outcome-choice-row"><button type="button" data-edit-tower-proc="false" class="${pendingEditTowerProc === false ? "selected" : ""}">低倍率 +0.25</button><button type="button" data-edit-tower-proc="true" class="${pendingEditTowerProc === true ? "selected" : ""}">高倍率 +2.0</button></div></fieldset>`
    : targets.length ? `<fieldset><legend>星星移除哪張牌？</legend><div class="outcome-choice-row">${targets.map(target => `<button type="button" data-edit-remove-card="${target.cardId}" class="${pendingEditRemovedCardId === target.cardId ? "selected" : ""}">${esc(cardName(target.cardId))}／${colorLabel[target.color]}</button>`).join("")}</div></fieldset>` : `<p>當時沒有其他可移除卡片。</p>`;
  const incomplete = card.cardId === "tower" ? pendingEditTowerProc === null : targets.length > 0 && pendingEditRemovedCardId === null;
  return `<dialog class="picker-dialog outcome-dialog" aria-labelledby="edit-outcome-title"><h2 id="edit-outcome-title">更正第 ${index + 1} 回合 ${esc(cardName(card.cardId))} 的結果</h2><p>選擇遊戲中實際發生的效果。</p>${choices}<button type="button" class="primary-action" data-edit-commit ${incomplete ? "disabled" : ""}>儲存更正</button><button type="button" class="text-action" data-edit-cancel>取消</button></dialog>`;
}

function addHistory(cardId?: CardId, color?: CardColor) {
  if (state.selected.length >= 5) return;
  if (!cardId || !color || state.selected.some(card => card.cardId === cardId)) return;
  pendingChoice = { cardId, color };
  pendingChoiceSource = "candidate";
  returnFocus = `[data-choose="${cardId}"]`;
  render();
}

function closeDialog() {
  pickerIndex = null; pendingChoice = null; pendingChoiceSource = null; pendingOutcome = null; pendingTowerProc = null; pendingRemovedCardId = null;
  render();
  app.querySelector<HTMLElement>(returnFocus)?.focus();
}

function removableCards() {
  return state.selected.filter(card => card.cardId !== "star" && !card.removed && (RULES.starRemovalPolicy === "uniformPresent" || card.activated));
}

function unresolvedStarIndex() {
  return state.selected.length === 5 && removableCards().length ? state.selected.findIndex((card, index) => card.cardId === "star" && card.activated && !starTargetIds[index]) : -1;
}

function renderStarResolution() {
  if (unresolvedStarIndex() === -1) return "";
  return `<section class="panel star-resolution" aria-labelledby="star-resolution-title"><h3 id="star-resolution-title" tabindex="-1">最後一步：星星移除了哪張牌？</h3><p>五張牌都記錄後，依遊戲結算畫面選擇；選擇前分數只是暫估。</p><div class="star-targets">${removableCards().map(card => `<button type="button" class="secondary-action" data-final-star-target="${card.cardId}">${esc(cardName(card.cardId))}／${colorLabel[card.color]}</button>`).join("")}</div></section>`;
}

function commitOutcome(outcome: "success" | "failure") {
  if (!pendingChoice || state.selected.length >= 5) return;
  closeRunEdits();
  syncCurrentRecord();
  currentRecord ??= createGameRecord(CALCULATION_SEED, simulationCount);
  currentRecord.rounds.push(captureChosenRound(pendingChoice, outcome === "success"));
  snapshotCurrentState();
  state.selected.push({ ...pendingChoice, activated: outcome === "success", ...(outcome === "success" && pendingChoice.cardId === "tower" ? { towerProc: pendingTowerProc! } : {}) });
  starTargetIds = [...starTargetIds, null];
  state.turn = Math.min(5, state.selected.length + 1) as GameState["turn"];
  pendingChoice = null; pendingChoiceSource = null; pendingOutcome = null; pendingTowerProc = null; pendingRemovedCardId = null;
  candidates = [null, null, null]; candidateColors = defaultSlotColors(); colorEditIndex = null;
  calculate();
  app.querySelector<HTMLElement>(state.selected.length === 5 ? unresolvedStarIndex() !== -1 ? "#star-resolution-title" : "#completion-title" : '[data-pick="0"]')?.focus();
}

function renderOutcomeDialog() {
  const card = pendingChoice!;
  const needsTower = card.cardId === "tower" && pendingOutcome === "success";
  const detail = needsTower ? `<fieldset><legend>高塔實際倍率</legend><div class="outcome-choice-row"><button type="button" data-tower-proc="false" class="${pendingTowerProc === false ? "selected" : ""}">低倍率 +0.25</button><button type="button" data-tower-proc="true" class="${pendingTowerProc === true ? "selected" : ""}">高倍率 +2.0</button></div></fieldset>` : card.cardId === "star" && pendingOutcome === "success" ? `<p>星星移除的牌會在五張牌記錄完後確認。</p>` : "";
  return `<dialog class="picker-dialog outcome-dialog" aria-labelledby="outcome-title"><h2 id="outcome-title">記錄結果：${esc(cardName(card.cardId))}（${colorLabel[card.color]}）</h2>${pendingOutcome ? `<p>請完成必要的實際結果，再提交這一回合。</p>${detail}<button type="button" class="primary-action" data-commit-outcome ${needsTower && pendingTowerProc === null ? "disabled" : ""}>完成記錄</button>` : `<p>請依遊戲畫面選擇；取消不會記錄。</p><div class="outcome-actions"><button type="button" class="primary-action" data-outcome="success">成功啟用</button><button type="button" class="secondary-action" data-outcome="failure">啟用失敗</button></div>`}<button type="button" class="text-action" data-outcome="cancel">取消，繼續比較</button></dialog>`;
}

// An open correction panel closes on Escape or a click elsewhere on the page (dialogs keep it open).
document.addEventListener("keydown", event => {
  const open = app.querySelector<HTMLDetailsElement>(".run-edit[open]");
  if (event.key !== "Escape" || !open || app.querySelector("dialog")) return;
  open.open = false;
  open.querySelector<HTMLElement>("summary")?.focus();
});
document.addEventListener("click", event => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target || target.closest(".run-edit, dialog")) return;
  app.querySelectorAll<HTMLDetailsElement>(".run-edit[open]").forEach(details => { details.open = false; });
});

worker = createWorker();
loadSession();
syncCurrentRecord();
render();
void loadArchive();
watchCloudAuth(handleCloudUser);
// getUser() can fail offline; only let it confirm a session, never clear one (the auth listener reports sign-outs).
void currentCloudUser().then(user => { if (user) handleCloudUser(user); }).catch(() => {});
if (state.selected.length < 5 && candidatesReady()) calculate();
