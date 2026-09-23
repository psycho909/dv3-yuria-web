import {
  CARDS, REWARD_THRESHOLDS, RULES, calculateScore, colorClass, colorLabel, recommend, summarizeScore,
  type CardColor, type CardId, type GameState, type Objective, type OfferedCard, type SelectedCard
} from "./domain";
import {
  createGameRecord, exportEnvelope, importGames, isValidGameRecord, listGames, parseExport, saveGame, summarizeRealGames,
  type EvidenceLevel, type RealGameRecordV1, type RealRound
} from "./real-game-record";
import { currentCloudUser, downloadRecordedGames, signInWithGitHub, signOutCloud, uploadRecordedGame, watchCloudAuth } from "./cloud-games";
import type { User } from "@supabase/supabase-js";
import "./styles.css";
import "./knowledge.css";
import "./pending.css";
import "./usability.css";

const cardList = Object.values(CARDS);
const colorOptions: CardColor[] = ["blue", "purple", "red"];
let state: GameState = { turn: 1, selected: [] };
let targetThreshold = 1500;
let targetInput = "1500";
let targetError = "";
let objective: Objective = { kind: "threshold", target: targetThreshold };
let candidates: Array<OfferedCard | null> = [null, null, null];
let candidateColors: CardColor[] = ["blue", "blue", "blue"];
type PickerDraft = { cardId: CardId | ""; color: CardColor };
let pickerIndex: number | null = null;
let pickerDraft: PickerDraft | null = null;
let simulationCount = 10000;
let result: ReturnType<typeof recommend> | null = null;
let pendingChoice: OfferedCard | null = null;
let pendingOutcome: "success" | "failure" | null = null;
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
let pickerSearch = "";
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
let cloudStatus = "GitHub 登入設定完成後可跨裝置同步；本機紀錄不需登入。";
const detailOpen = new Map<string, boolean>();

const STORAGE_KEY = "yuria-web-session-v1";
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
    target === null || (selected[index]?.cardId === "star" && isCardId(target) && target !== "star" && selected.slice(0, index).some(card => card.cardId === target))
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
    candidateColors = saved.candidateColors === undefined ? ["blue", "blue", "blue"] : saved.candidateColors.length === 3 && saved.candidateColors.every(isColor) ? [...saved.candidateColors] : ["blue", "blue", "blue"];
    targetThreshold = typeof saved.targetThreshold === "number" && Number.isFinite(saved.targetThreshold) && Number.isInteger(saved.targetThreshold) && saved.targetThreshold >= 0 ? saved.targetThreshold : 1500;
    if (saved.objective?.kind === "threshold" && Number.isInteger(saved.objective.target) && saved.objective.target >= 0) targetThreshold = saved.objective.target;
    objective = saved.objective?.kind === "expected" || saved.objective?.kind === "stability" ? { kind: saved.objective.kind } : { kind: "threshold", target: targetThreshold };
    targetInput = String(targetThreshold);
    simulationCount = saved.simulationCount === 5000 || saved.simulationCount === 20000 ? saved.simulationCount : 10000;
    currentRecord = saved.currentRecord && isValidGameRecord(saved.currentRecord) && saved.currentRecord.rounds.length === state.selected.length &&
      saved.currentRecord.rounds.every((round, index) => round.chosen.cardId === state.selected[index]!.cardId && round.chosen.color === state.selected[index]!.color && round.activated === state.selected[index]!.activated) ? saved.currentRecord : null;
    restoredSession = Boolean(state.selected.length || candidates.some(Boolean));
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch { storageFailureNotice(); }
  }
}

function objectiveMetric(metric: NonNullable<typeof result>["ranked"][number]) {
  if (objective.kind === "expected") return { label: "預期最終分數", value: metric.meanScore.toFixed(1) };
  if (objective.kind === "stability") return { label: "保守分數 P10", value: metric.p10.toLocaleString() };
  const value = metric.thresholdProbability === 0 ? metric.method === "exact" ? "依目前模型為 0" : `抽樣 ${metric.simulations.toLocaleString()} 次未命中` : formatPercent(metric.thresholdProbability);
  return { label: `達到 ${targetThreshold.toLocaleString()} 分`, value };
}

function cardFace(id: CardId) {
  const card = CARDS[id];
  const effect = card.specialEffect?.kind === "tower" ? `高塔：成功 +${card.specialEffect.procMultiplier} 倍，否則 +${card.specialEffect.fallbackMultiplier} 倍` : card.specialEffect?.kind === "removeOtherCard" ? `星星：成功移除一張牌，倍率 +${card.specialEffect.multiplier}` : card.specialEffect?.kind === "failedCardScore" ? `月亮：基礎 +${card.specialEffect.baseScore}，每張失敗 +${card.specialEffect.perFailedCard}` : card.specialEffect?.kind === "activeCountMultiplier" ? `太陽：倍率 +${card.specialEffect.baseMultiplier}，每張有效牌 +${card.specialEffect.perActiveCard}` : card.specialEffect?.kind === "highestActiveScore" ? `世界：最高成功分數 ×${card.specialEffect.factor}` : card.category === "score" ? `+${card.scoreValue} 分` : card.category === "multiplier" ? `倍率 +${card.multiplierValue}` : "特殊效果";
  return `<span class="face-category">${card.category === "score" ? "分數卡" : card.category === "multiplier" ? "倍率卡" : "特殊卡"}</span><strong>${esc(card.name)}</strong><small class="card-effect">${effect}</small><small>啟用 ${Math.round(card.activationProbability * 100)}%</small>`;
}

function renderHistory() {
  return state.selected.map((card, index) => `<div class="history-row ${colorClass[card.color]} ${card.removed ? "is-removed" : ""}">
    <div class="card-face ${colorClass[card.color]} ${card.activated ? "" : "is-failed"}">${cardFace(card.cardId)}<span class="face-status">第 ${index + 1} 回合 · ${card.removed ? "已移除" : card.activated ? "成功" : "失敗"}</span></div>
    <label>牌色<select data-history-color="${index}" aria-label="${esc(cardName(card.cardId))} 牌色" ${targetError ? "disabled" : ""}>${colorOptions.map(color => `<option value="${color}" ${color === card.color ? "selected" : ""}>${colorLabel[color]}色</option>`).join("")}</select></label>
    <div class="history-result">${[true, false].map(activated => `<button type="button" data-history-result="${index}" data-activated="${activated}" aria-pressed="${card.activated === activated}" class="${card.activated === activated ? "selected" : ""}" ${targetError ? "disabled" : ""}>${activated ? "成功" : "失敗"}</button>`).join("")}</div>
    <label class="removed-toggle"><input type="checkbox" data-history-removed="${index}" ${card.removed ? "checked" : ""} ${targetError || starTargetIds.some((target, starIndex) => target === card.cardId && state.selected[starIndex]?.activated) ? "disabled" : ""} />已被移除</label>
    ${card.cardId === "star" && card.activated && starTargetIds[index] ? `<small class="history-special-link">移除：${esc(cardName(starTargetIds[index]!))}（按「成功」可更正）</small>` : card.cardId === "tower" && card.activated ? `<small class="history-special-link">高塔倍率：${card.towerProc ? "高" : "低"}（按「成功」可更正）</small>` : ""}
  </div>`).join("") + (state.selected.length < 5 ? `<button class="history-add" id="add-history" type="button" ${targetError ? "disabled" : ""}><span>＋</span>加入已確定卡片<small>接續進行中的牌局</small></button>` : "");
}

function candidatesReady(): boolean {
  if (candidates.some(candidate => candidate == null)) return false;
  const ids = candidates.map(candidate => candidate!.cardId);
  return new Set(ids).size === ids.length && !ids.some(id => state.selected.some(selected => selected.cardId === id));
}

function candidateInputHint() {
  if (candidates.some(candidate => candidate == null)) return "請先選擇三張候選牌，完成後才會開始計算。";
  if (!candidatesReady()) return "候選牌不可重複，也不能與已確定卡片重複。";
  return "顏色是每次出牌的實例。";
}

function renderPendingCandidate(index: number, candidate: OfferedCard | null) {
  const color = candidate?.color ?? candidateColors[index]!;
  return `<article class="candidate-card pending-card ${colorClass[color]}">
    <div class="candidate-top"><span class="rank">${String(index + 1).padStart(2, "0")}</span>${colorBadge(color)}<span class="category">候選槽</span></div>
    <button type="button" class="candidate-slot-button ${candidate ? `card-face ${colorClass[color]}` : ""}" data-pick="${index}" aria-label="選擇第 ${index + 1} 張候選牌">${candidate ? cardFace(candidate.cardId) : `<span class="slot-plus">＋</span><strong>選擇卡片</strong><small>點擊填入候選牌</small>`}</button>
    <div class="candidate-color-buttons" role="group" aria-label="第 ${index + 1} 張候選牌顏色">${colorOptions.map(option => `<button type="button" class="candidate-color-button ${colorClass[option]} ${color === option ? "selected" : ""}" data-slot-color="${option}" data-slot-index="${index}" aria-pressed="${color === option}">${colorLabel[option]}</button>`).join("")}</div>
    <div class="pending-copy">${candidate ? "已填入候選牌" : "請選擇候選牌"}</div>
  </article>`;
}

function renderPicker() {
  if (pickerIndex === null || !pickerDraft) return "";
  const selectedCard = pickerDraft.cardId ? CARDS[pickerDraft.cardId] : null;
  const visibleCards = cardList.filter(card => (pickerCategory === "all" || card.category === pickerCategory) && card.name.includes(pickerSearch.trim()));
  const categories = [["all", "全部"], ["score", "分數卡"], ["multiplier", "倍率卡"], ["special", "特殊卡"]] as const;
  const categoryCount = (value: typeof categories[number][0]) => value === "all" ? cardList.length : cardList.filter(card => card.category === value).length;
  const usageLabel = (id: CardId) => {
    if (state.selected.some(card => card.cardId === id)) return "本局已選";
    const slot = candidates.findIndex((candidate, index) => index !== pickerIndex && candidate?.cardId === id);
    return slot >= 0 ? `候選 ${slot + 1} 已使用` : "";
  };
  return `<dialog class="picker-dialog" aria-labelledby="picker-title">
    <div class="picker-header"><div><p class="eyebrow">CARD PICKER</p><h2 id="picker-title">${pickerIndex === -1 ? "加入已確定卡片" : `選擇第 ${pickerIndex + 1} 張候選牌`}</h2></div><button type="button" class="picker-close" data-picker-cancel aria-label="關閉選擇器">×</button></div>
    <div class="picker-search"><label for="card-search">搜尋卡片名稱</label><div class="search-control"><input id="card-search" type="search" placeholder="例如：月亮、力量…" value="${esc(pickerSearch)}" autocomplete="off" /><button type="button" id="clear-search" class="secondary-action" aria-label="清除搜尋" ${pickerSearch ? "" : "hidden"}>清除</button></div></div>
    <div class="picker-section"><div class="picker-section-heading"><strong>1. 選擇卡片</strong><small>${selectedCard ? `目前：${esc(selectedCard.name)}` : "尚未選擇"}</small></div><div class="picker-categories" role="group" aria-label="牌庫分類">${categories.map(([value, label]) => `<button type="button" data-picker-category="${value}" aria-pressed="${pickerCategory === value}" class="${pickerCategory === value ? "selected" : ""}">${label} <span>${categoryCount(value)}</span></button>`).join("")}</div><div class="picker-card-grid">${cardList.map(card => { const usage = usageLabel(card.id); return `<button type="button" class="picker-card ${pickerDraft!.cardId === card.id ? "selected" : ""}" data-picker-card="${card.id}" aria-pressed="${pickerDraft!.cardId === card.id}" ${usage ? "disabled" : ""} ${visibleCards.includes(card) ? "" : "hidden"}><strong>${esc(card.name)}</strong><small>${card.category === "score" ? `分數卡 · +${card.scoreValue}` : card.category === "multiplier" ? `倍率卡 · +${Math.round((card.multiplierValue ?? 0) * 100)}%` : "特殊卡"}</small><span>${usage || `啟用 ${Math.round(card.activationProbability * 100)}%`}</span></button>`; }).join("")}</div><p id="search-empty" aria-live="polite" ${visibleCards.length ? "hidden" : ""}>找不到卡片，請換個名稱或分類。</p></div>
    <div class="picker-section"><div class="picker-section-heading"><strong>2. 選擇卡牌顏色</strong><small>${colorLabel[pickerDraft.color]}</small></div><div class="picker-color-options">${colorOptions.map(color => `<button type="button" class="picker-color ${colorClass[color]} ${pickerDraft!.color === color ? "selected" : ""}" data-picker-color="${color}" aria-pressed="${pickerDraft!.color === color}">${colorLabel[color]}</button>`).join("")}</div></div>
    <div class="picker-footer"><span>${selectedCard ? `${esc(selectedCard.name)}／${colorLabel[pickerDraft.color]}` : "請先選擇一張卡片"}</span><div><button type="button" class="secondary-action" data-picker-cancel>取消</button><button type="button" class="primary-action" data-picker-apply ${selectedCard ? "" : "disabled"}>${pickerIndex === -1 ? "下一步：記錄結果" : "套用候選"}</button></div></div>
  </dialog>`;
}

function renderEvidencePanel() {
  const currentScore = summarizeScore(state.selected, RULES);
  return `<section class="panel evidence-panel"><div class="section-heading"><div><p class="eyebrow">RECORDED EVIDENCE</p><h2>統計與實測</h2></div><span class="rule-pill">5 局</span></div>
    <div class="current-score"><span>目前估算平均</span><strong>${currentScore.meanScore.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong></div>
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
  return `<section class="knowledge-grid"><details class="panel knowledge-panel" open><summary><span><p class="eyebrow">REWARD LADDER</p><h2>尤里亞的祝福門檻</h2></span><span>⌄</span></summary><div class="reward-table">${REWARD_THRESHOLDS.map((threshold, index) => `<div><span>Lv.${index + 1}</span><strong>${threshold.toLocaleString()}</strong><small>${threshold === 0 ? "起始" : threshold >= 2700 ? "最高級" : "累積幸運分數"}</small></div>`).join("")}</div><p class="knowledge-note">推薦目標可自行輸入；門檻只作為參考，不會取代你設定的目標。</p></details><details class="panel knowledge-panel"><summary><span><p class="eyebrow">CARD CATALOG</p><h2>完整牌庫 · 22 張</h2></span><span>⌄</span></summary><div class="catalog">${cardsByCategory}</div></details><details class="panel knowledge-panel"><summary><span><p class="eyebrow">FORMULA & LIMITS</p><h2>公式與目前限制</h2></span><span>⌄</span></summary><div class="formula"><code>floor(SUM × MULT × (1 + RED_BONUS))</code><p>SUM 包含成功分數卡、失敗卡每張 +20、藍色級距、月亮與世界；MULT 將倍率卡、紫色級距、高塔、星星、太陽加總後再加 1。</p><p>目前採 A 版整數百分比紅色模型；1648 實測仍提示連續值或中間取整可能存在。未來出牌類別內等權、同色出現分布與太陽是否計自己仍是明示假設。</p></div></details></section>`;
}

function renderCandidate(slotIndex: number, metric: NonNullable<typeof result>["ranked"][number], rank: number) {
  const card = CARDS[metric.candidate.cardId];
  const isTop = rank === 1;
  const primary = objectiveMetric(metric);
  const targetLabel = metric.thresholdProbability === 0 ? (metric.method === "monte_carlo" ? `抽樣 ${metric.simulations.toLocaleString()} 次未命中` : "依目前模型為 0") : formatPercent(metric.thresholdProbability);
  return `<article class="candidate-card ${isTop ? "is-top" : ""} ${colorClass[metric.candidate.color]}">
    <div class="candidate-top"><span class="rank">候選 ${slotIndex + 1}</span>${colorBadge(metric.candidate.color)}<span class="category">${card.category === "score" ? "分數" : card.category === "multiplier" ? "倍率" : "特殊"}</span>${isTop ? `<span class="recommend-badge">推薦 #1</span>` : `<span class="rank">排名 #${rank}</span>`}</div>
    <button class="card-face ${colorClass[metric.candidate.color]}" data-pick="${slotIndex}" aria-label="修改${esc(card.name)}">${cardFace(card.id)}</button>
    <div class="metric-main"><span>${primary.label}</span><strong>${primary.value}</strong></div>
    <div class="metric-row"><span>${objective.kind === "threshold" ? "預期最終分數" : `達到 ${targetThreshold.toLocaleString()} 分`}</span><strong>${objective.kind === "threshold" ? metric.meanScore.toFixed(1) : targetLabel}</strong></div>
    <div class="metric-row"><span>${objective.kind === "stability" ? "預期最終分數" : "保守分數 P10"}</span><strong>${objective.kind === "stability" ? metric.meanScore.toFixed(1) : metric.p10.toLocaleString()}</strong></div>
    <div class="metric-row"><span>模型分數範圍</span><strong>${metric.minScore.toLocaleString()}～${metric.maxScore.toLocaleString()}</strong></div>
    <div class="percentile"><span>P10 ${metric.p10}</span><span>P50 ${metric.p50}</span><span>P90 ${metric.p90}</span></div>
    <div class="activation">點選獲得率 <b>${Math.round(card.activationProbability * 100)}%</b></div>
    <button type="button" class="edit-candidate" data-pick="${slotIndex}">編輯卡片／顏色</button>
    <button class="choose-card" data-choose="${metric.candidate.cardId}" data-choose-color="${metric.candidate.color}">選擇這張</button>
  </article>`;
}

function render() {
  captureDetails();
  const focused = document.activeElement as HTMLElement | null;
  const dialogFocus = Boolean(focused?.closest("dialog"));
  const focusSelector = focused?.dataset.pickerCard ? `[data-picker-card="${focused.dataset.pickerCard}"]` : focused?.dataset.pickerColor ? `[data-picker-color="${focused.dataset.pickerColor}"]` : focused?.dataset.pickerCategory ? `[data-picker-category="${focused.dataset.pickerCategory}"]` : focused?.dataset.slotColor ? `[data-slot-color="${focused.dataset.slotColor}"][data-slot-index="${focused.dataset.slotIndex}"]` : focused?.dataset.towerProc ? `[data-tower-proc="${focused.dataset.towerProc}"]` : focused?.dataset.removeCard ? `[data-remove-card="${focused.dataset.removeCard}"]` : focused?.dataset.editTowerProc ? `[data-edit-tower-proc="${focused.dataset.editTowerProc}"]` : focused?.dataset.editRemoveCard ? `[data-edit-remove-card="${focused.dataset.editRemoveCard}"]` : focused?.dataset.outcome ? `[data-outcome="${focused.dataset.outcome}"]` : focused?.dataset.objective ? `[data-objective="${focused.dataset.objective}"]` : focused?.id ? `#${focused.id}` : null;
  const pickerScroll = app.querySelector(".picker-dialog")?.scrollTop ?? 0;
  const bestMean = result ? [...result.ranked].sort((a, b) => b.meanScore - a.meanScore)[0]! : null;
  const ranked = result?.ranked ?? [];
  const resultReady = calculationStatus === "ready" && Boolean(result);
  const fallback = result?.mode === "highest_expected_score_fallback";
  const exactZero = Boolean(result && result.ranked.length > 0 && result.ranked.every(metric => metric.method === "exact" && metric.thresholdProbability === 0));
  const currentScore = calculateScore(state.selected, () => .5, RULES);
  const scoreSummary = summarizeScore(state.selected, RULES);
  const activeCounts = state.selected.filter(c => c.activated && !c.removed).reduce((counts, c) => { counts[c.color]++; return counts; }, { blue: 0, purple: 0, red: 0 } as Record<CardColor, number>);
  const workspaceTitle = state.selected.length === 5 ? "本局已完成" : resultReady ? "比較結果，選一張並記錄" : calculationStatus === "calculating" ? "正在計算推薦" : calculationStatus === "error" ? "推薦暫時無法更新" : "填入遊戲中的 3 張候選牌";
  const statusText = calculationStatus === "calculating" ? "計算中…" : calculationStatus === "error" ? "需要重試" : `${candidates.filter(Boolean).length} / 3 已填入`;
  const scoreMethod = scoreSummary.method === "exact" ? "紅色整數百分比完整枚舉" : "紅色效果取樣估算";
  app.innerHTML = `<main class="shell">
    <header class="header">
      <div><p class="eyebrow">YURIA / 選牌助手</p><h1>尤里亞的占卜計算器</h1><p class="subhead">填入三張牌 → 比較推薦 → 記錄遊戲結果</p></div>
      <div class="header-meta"><span>目前估算平均</span><strong class="score-total">${scoreSummary.meanScore.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong><span>分</span></div>
    </header>
    ${restoredSession ? `<div class="restored-note" role="status"><span>已恢復這台裝置上的上一局資料。</span><button type="button" class="text-action" id="dismiss-restored">知道了</button></div>` : ""}
    <section class="control-bar panel">
      <div class="control-group"><label>推薦目標</label><div class="segmented"><button data-objective="threshold" class="${objective.kind === "threshold" ? "active" : ""}">達標率</button><button data-objective="expected" class="${objective.kind === "expected" ? "active" : ""}">預期分數</button><button data-objective="stability" class="${objective.kind === "stability" ? "active" : ""}">穩定</button></div></div>
      <label class="target-field">目標分數 <input id="target" type="number" min="0" step="100" value="${esc(targetInput)}" aria-invalid="${Boolean(targetError)}" aria-describedby="target-error" /><small id="target-error" class="field-error" ${targetError ? "" : "hidden"}>${esc(targetError)}</small></label>
      <label class="simulation-field">模擬次數 <select id="simulations"><option value="5000" ${simulationCount === 5000 ? "selected" : ""}>5,000（快速）</option><option value="10000" ${simulationCount === 10000 ? "selected" : ""}>10,000（標準）</option><option value="20000" ${simulationCount === 20000 ? "selected" : ""}>20,000（精細）</option></select></label>
      <button class="primary-action" id="calculate" aria-live="polite" ${!candidatesReady() || state.selected.length === 5 || calculationStatus === "calculating" || targetError ? "disabled" : ""}>${calculationStatus === "error" ? "重試計算" : calculationStatus === "calculating" ? "計算中…" : "更新推薦"}</button>
    </section>
    <div class="layout">
      <section class="workspace"><div class="workspace-heading"><div><p class="eyebrow">第 ${state.turn} / 5 回合</p><h2>${workspaceTitle}</h2></div><span class="calculation-time" aria-live="polite">${statusText}</span></div>
        ${state.selected.length === 5 ? `<section class="panel completion"><h3 id="completion-title" tabindex="-1">五回合已記錄</h3><p>目前模型估算平均 ${scoreSummary.meanScore.toLocaleString(undefined, { maximumFractionDigits: 1 })} 分（P10 ${scoreSummary.p10.toLocaleString()}～P90 ${scoreSummary.p90.toLocaleString()}）；${scoreMethod}，隨機效果與祝福可能使遊戲結果不同。</p><p>可撤回上一回合修正，或重設本局重新開始。</p></section>` : `<div class="candidate-grid">${resultReady ? candidates.map((candidate, slotIndex) => { const metric = ranked.find(item => item.candidate.cardId === candidate?.cardId); if (!metric) return ""; const rank = ranked.findIndex(item => item.candidate.cardId === candidate?.cardId) + 1; return renderCandidate(slotIndex, metric, rank); }).join("") : candidates.map((candidate, index) => renderPendingCandidate(index, candidate)).join("")}</div>`}
        ${renderActualScorePanel()}
        <section class="decision-panel panel ${resultReady ? "" : "pending-decision"}" ${state.selected.length === 5 ? "hidden" : ""}><div><p class="eyebrow">${resultReady ? "選牌建議" : calculationStatus === "error" ? "計算錯誤" : calculationStatus === "calculating" ? "正在計算" : "操作提示"}</p><h2>${resultReady ? (fallback ? exactZero ? "依目前模型，達標機率為 0%" : "達標率皆為零，改看預期分數" : "依你的目標比較推薦") : calculationStatus === "error" ? "輸入已保留，請重試" : calculationStatus === "calculating" ? "正在整理三張牌的比較結果" : "先選擇本回合三張候選牌"}</h2><p>${resultReady ? (fallback ? exactZero ? "目前精確模型沒有支援達標的結果，系統仍以預期最終分數最高者排序。" : "目前抽樣沒有達到目標，系統改以預期最終分數最高者排序。" : "先在遊戲中選牌，再按「選擇這張」記錄啟用結果。") : calculationStatus === "error" ? calculationError : calculationStatus === "calculating" ? "計算完成後會在原本的候選槽顯示指標，不會改變牌的順序。" : candidateInputHint()}</p></div>${resultReady && bestMean ? `<div class="decision-values"><div><span>目前目標推薦</span><strong>${esc(CARDS[result!.ranked[0]!.candidate.cardId].name)}／${colorLabel[result!.ranked[0]!.candidate.color]}</strong></div><div><span>預期分數最高</span><strong>${esc(CARDS[bestMean.candidate.cardId].name)}／${colorLabel[bestMean.candidate.color]}</strong></div></div>` : calculationStatus === "error" ? `<button type="button" class="secondary-action retry-action" id="retry-calculation">重新計算</button>` : ""}</section>
      </section>
      <aside class="sidebar">
        <section class="panel history-panel"><div class="section-heading"><div><p class="eyebrow">CURRENT RUN</p><h2>已確定卡片</h2></div><span class="turn-counter">${state.selected.length} / 5</span></div>
          <div class="progress"><span style="width:${state.selected.length * 20}%"></span></div>
          <div class="color-counts"><span class="blue-text">藍 ${activeCounts.blue}</span><span class="purple-text">紫 ${activeCounts.purple}</span><span class="red-text">紅 ${activeCounts.red}</span></div>
          <div class="history-actions">${state.selected.length ? `<button class="secondary-action" id="undo">撤回上一回合</button>` : `<span class="history-hint">先填入本回合候選牌</span>`}<button class="secondary-action" id="reset">↺ 重設本局</button></div>
          <div class="history-list">${renderHistory()}</div>
        </section>
        <details class="supplement"><summary>查看統計與實測</summary>${renderEvidencePanel()}</details>
        <details class="supplement real-archive" data-detail-key="real-archive"${detailAttribute("real-archive")}><summary>真實牌局紀錄</summary><section class="panel real-archive-panel"><p id="record-save-status" role="status">${esc(archiveSaveState)}</p><div id="real-archive-body">${renderArchiveBody()}</div></section></details>
        <details class="supplement" data-detail-key="cloud-games"${detailAttribute("cloud-games")}><summary>GitHub 登入與跨裝置紀錄</summary><section class="panel cloud-panel"><p>${cloudUser ? `已登入 ${esc(cloudUser.email ?? cloudUser.id)}` : "尚未登入；本機牌局仍可照常使用。"}</p><p id="cloud-status" role="status">${esc(cloudStatus)}</p><div class="archive-actions">${cloudUser ? `<button type="button" class="secondary-action" id="download-cloud-games">載入雲端牌局</button><button type="button" class="secondary-action" id="upload-current-game" ${currentRecord?.status === "recorded" ? "" : "disabled"}>同步本局</button><button type="button" class="text-action" id="cloud-sign-out">登出</button>` : `<button type="button" class="secondary-action" id="cloud-sign-in">使用 GitHub 登入</button>`}</div><small>只有按下「紀錄本局」的完整牌局會儲存；登入後的新紀錄會同步，舊資料可自行匯出或逐局核對。</small></section></details>
        <details class="panel data-panel"><summary>資料可信度與模型限制</summary>
          <div class="confidence"><div><span class="confidence-icon verified">✓</span><p><strong>22 張牌資料</strong><small>使用者提供並記錄</small></p></div><div><span class="confidence-icon warning">△</span><p><strong>未驗證出牌分布</strong><small>類別內暫採等權</small></p></div><div><span class="confidence-icon warning">△</span><p><strong>紅色抽樣模型</strong><small>整數預設；1648 暗示連續值</small></p></div><div><span class="confidence-icon muted">—</span><p><strong>Jev 僅語意路由</strong><small>不參與數學計算</small></p></div></div>
        </details>
      </aside>
    </div>
    <section class="score-breakdown" aria-label="目前計分"><strong>目前分數組成</strong><span>分數 ${currentScore.sum} × 倍率 ${currentScore.multiplier.toFixed(2)} × 紅色加成 ${(1 + currentScore.redBonus).toFixed(2)} = <b>${currentScore.finalScore}</b></span><small>組成列取紅色中間值；上方估算平均使用${scoreMethod}，祝福尚未納入。</small></section>
    ${renderKnowledgePanels()}
    <footer class="footer"><span>數學結果由本機 deterministic engine 計算</span><span>特殊卡、顏色級距與失敗補償已納入</span><span>祝福尚未建模</span></footer>
    ${renderPicker()}
    <p class="sr-only" aria-live="polite">${resultReady ? "推薦已更新" : calculationStatus === "calculating" ? "正在計算推薦" : calculationStatus === "error" ? "推薦計算失敗，可重試" : state.selected.length === 5 ? "本局已完成" : ""}</p>
    ${pendingChoice ? renderOutcomeDialog() : ""}
    ${pendingEditIndex !== null ? renderEditOutcomeDialog() : ""}
  </main>`;
  bindEvents();
  const dialog = app.querySelector<HTMLDialogElement>("dialog");
  document.body.classList.toggle("modal-open", Boolean(dialog));
  if (dialog) {
    dialog.showModal();
    dialog.addEventListener("cancel", event => { event.preventDefault(); if (pendingEditIndex !== null) closeEditDialog(); else closeDialog(); });
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
    const nextFocus = restoredFocus ?? (pendingEditIndex !== null ? app.querySelector<HTMLElement>("[data-edit-tower-proc], [data-edit-remove-card], [data-edit-commit]") : pickerIndex !== null ? app.querySelector<HTMLElement>("#card-search") : pendingChoice && pendingOutcome && pendingChoice.cardId === "tower" ? app.querySelector<HTMLElement>('[data-tower-proc="false"]') : pendingChoice && pendingOutcome && pendingChoice.cardId === "star" ? app.querySelector<HTMLElement>("[data-remove-card]") : pendingChoice ? app.querySelector<HTMLElement>('[data-outcome="success"]') : null);
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
  if (pickerIndex === null) render();
}

function handleWorkerError(source: Worker) {
  if (source !== worker) return;
  replaceWorker();
  requestId++;
  if (calculationStatus !== "calculating") return;
  result = null;
  calculationStatus = "error";
  calculationError = "推薦計算執行失敗，輸入仍保留，請重試。";
  if (pickerIndex === null) render();
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
      worker?.postMessage({ type: "RECOMMEND", requestId: currentRequest, state: cloneState(state), candidates: candidates as OfferedCard[], objective, simulations: simulationCount, seed: CALCULATION_SEED, rules: RULES, targetThreshold });
    } catch {
      handleWorkerError(worker!);
    }
  }, 150);
}

function bindEvents() {
  app.querySelectorAll<HTMLSelectElement>("[data-history-color]").forEach(select => select.addEventListener("change", () => { startRecordCorrection(); state.selected[Number(select.dataset.historyColor)]!.color = select.value as CardColor; calculate(); }));
  app.querySelectorAll<HTMLButtonElement>("[data-history-result]").forEach(button => button.addEventListener("click", () => editHistoryResult(Number(button.dataset.historyResult), button.dataset.activated === "true")));
  app.querySelectorAll<HTMLInputElement>("[data-history-removed]").forEach(input => input.addEventListener("change", () => { startRecordCorrection(); state.selected[Number(input.dataset.historyRemoved)]!.removed = input.checked; calculate(); }));
  app.querySelectorAll<HTMLButtonElement>("[data-edit-tower-proc]").forEach(button => button.addEventListener("click", () => { pendingEditTowerProc = button.dataset.editTowerProc === "true"; render(); }));
  app.querySelectorAll<HTMLButtonElement>("[data-edit-remove-card]").forEach(button => button.addEventListener("click", () => { pendingEditRemovedCardId = button.dataset.editRemoveCard as CardId; render(); }));
  app.querySelector<HTMLButtonElement>("[data-edit-commit]")?.addEventListener("click", commitEditResult);
  app.querySelector<HTMLButtonElement>("[data-edit-cancel]")?.addEventListener("click", closeEditDialog);
  app.querySelector<HTMLInputElement>("#card-search")?.addEventListener("input", event => {
    pickerSearch = (event.target as HTMLInputElement).value;
    const matches = cardList.filter(card => (pickerCategory === "all" || card.category === pickerCategory) && card.name.includes(pickerSearch.trim()));
    app.querySelectorAll<HTMLButtonElement>("[data-picker-card]").forEach(button => { const card = CARDS[button.dataset.pickerCard as CardId]; button.hidden = !(pickerCategory === "all" || card.category === pickerCategory) || !card.name.includes(pickerSearch.trim()); });
    app.querySelector<HTMLElement>("#search-empty")!.hidden = matches.length > 0;
    app.querySelector<HTMLButtonElement>("#clear-search")?.toggleAttribute("hidden", !pickerSearch);
  });
  app.querySelector<HTMLButtonElement>("#clear-search")?.addEventListener("click", () => { pickerSearch = ""; render(); app.querySelector<HTMLInputElement>("#card-search")?.focus(); });
  app.querySelectorAll<HTMLButtonElement>("[data-picker-category]").forEach(button => button.addEventListener("click", () => { pickerCategory = button.dataset.pickerCategory as typeof pickerCategory; render(); }));
  app.querySelectorAll<HTMLButtonElement>("[data-objective]").forEach(button => button.addEventListener("click", () => { const kind = button.dataset.objective as Objective["kind"]; objective = kind === "threshold" ? { kind, target: targetThreshold } : { kind }; calculate(); }));
  app.querySelector<HTMLInputElement>("#target")?.addEventListener("change", event => { targetInput = (event.target as HTMLInputElement).value.trim(); const target = Number(targetInput); if (!targetInput || !Number.isInteger(target) || !Number.isFinite(target) || target < 0) { cancelPendingCalculation(); result = null; calculationStatus = "idle"; calculationError = ""; targetError = "請輸入 0 或以上的整數分數。"; render(); return; } targetError = ""; targetThreshold = target; if (objective.kind === "threshold") objective = { kind: "threshold", target }; calculate(); });
  app.querySelector<HTMLSelectElement>("#simulations")?.addEventListener("change", event => { simulationCount = Number((event.target as HTMLSelectElement).value); calculate(); });
  app.querySelector<HTMLButtonElement>("#calculate")?.addEventListener("click", calculate);
  app.querySelector<HTMLButtonElement>("#retry-calculation")?.addEventListener("click", calculate);
  app.querySelector<HTMLButtonElement>("#dismiss-restored")?.addEventListener("click", () => { restoredSession = false; render(); });
  app.querySelector<HTMLButtonElement>("#reset")?.addEventListener("click", () => { if ((state.selected.length || candidates.some(Boolean)) && !window.confirm("清除本局卡片與候選牌，重新開始？已按「紀錄本局」的牌局會保留。")) return; state = { turn: 1, selected: [] }; turnSnapshots = []; starTargetIds = []; candidates = [null, null, null]; candidateColors = ["blue", "blue", "blue"]; currentRecord = null; scoreEditing = false; pickerIndex = null; pickerDraft = null; restoredSession = false; targetError = ""; try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore unavailable storage */ } calculate(); });
  app.querySelector<HTMLButtonElement>("#undo")?.addEventListener("click", () => {
    const previous = turnSnapshots.pop();
    if (!previous) return;
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
    candidateColors = ["blue", "blue", "blue"];
    calculate();
  });
  app.querySelectorAll<HTMLButtonElement>("[data-slot-color]").forEach(button => button.addEventListener("click", () => { const index = Number(button.dataset.slotIndex); const color = button.dataset.slotColor as CardColor; candidateColors[index] = color; if (candidates[index]) candidates[index] = { ...candidates[index]!, color }; calculate(); }));
  app.querySelectorAll<HTMLElement>("[data-pick]").forEach(trigger => trigger.addEventListener("click", () => { pickerSearch = ""; pickerCategory = "all"; const index = Number(trigger.dataset.pick); returnFocus = `[data-pick="${index}"]`; const candidate = candidates[index]; pickerIndex = index; pickerDraft = { cardId: candidate?.cardId ?? "", color: candidate?.color ?? candidateColors[index]! }; render(); }));
  app.querySelectorAll<HTMLButtonElement>("[data-picker-card]").forEach(button => button.addEventListener("click", () => { if (!pickerDraft) return; pickerDraft = { ...pickerDraft, cardId: button.dataset.pickerCard as CardId }; render(); }));
  app.querySelectorAll<HTMLButtonElement>("[data-picker-color]").forEach(button => button.addEventListener("click", () => { if (!pickerDraft) return; pickerDraft = { ...pickerDraft, color: button.dataset.pickerColor as CardColor }; render(); }));
  app.querySelectorAll<HTMLButtonElement>("[data-picker-cancel]").forEach(button => button.addEventListener("click", closeDialog));
  app.querySelector<HTMLButtonElement>("[data-picker-apply]")?.addEventListener("click", () => { if (pickerIndex === null || !pickerDraft?.cardId) return; if (pickerIndex === -1) { pendingChoice = { cardId: pickerDraft.cardId, color: pickerDraft.color }; pendingChoiceSource = "manual"; pickerIndex = null; pickerDraft = null; render(); return; } candidates[pickerIndex] = { cardId: pickerDraft.cardId, color: pickerDraft.color }; candidateColors[pickerIndex] = pickerDraft.color; pickerIndex = null; pickerDraft = null; calculate(); app.querySelector<HTMLElement>(returnFocus)?.focus(); });
  app.querySelector<HTMLButtonElement>("#add-history")?.addEventListener("click", () => { pickerSearch = ""; pickerCategory = "all"; returnFocus = "#add-history"; pickerIndex = -1; pickerDraft = { cardId: "", color: "blue" }; render(); });
  app.querySelectorAll<HTMLButtonElement>("[data-choose]").forEach(button => button.addEventListener("click", () => addHistory(button.dataset.choose as CardId, button.dataset.chooseColor as CardColor)));
  app.querySelectorAll<HTMLButtonElement>("[data-tower-proc]").forEach(button => button.addEventListener("click", () => { pendingTowerProc = button.dataset.towerProc === "true"; render(); }));
  app.querySelectorAll<HTMLButtonElement>("[data-remove-card]").forEach(button => button.addEventListener("click", () => { pendingRemovedCardId = button.dataset.removeCard as CardId; render(); }));
  app.querySelectorAll<HTMLButtonElement>("[data-outcome]").forEach(button => button.addEventListener("click", () => {
    if (button.dataset.outcome === "cancel") { closeDialog(); return; }
    if (!pendingChoice || state.selected.length >= 5) return;
    const outcome = button.dataset.outcome as "success" | "failure";
    pendingOutcome = outcome;
    render();
  }));
  app.querySelector<HTMLButtonElement>("[data-commit-outcome]")?.addEventListener("click", () => { if (!pendingOutcome || (pendingOutcome === "success" && pendingChoice?.cardId === "tower" && pendingTowerProc === null) || (pendingOutcome === "success" && pendingChoice?.cardId === "star" && removableCards().length && pendingRemovedCardId === null)) return; commitOutcome(pendingOutcome); });
  app.querySelector<HTMLFormElement>("#actual-score-form")?.addEventListener("submit", event => {
    event.preventDefault();
    if (state.selected.length !== 5) return;
    const raw = app.querySelector<HTMLInputElement>("#actual-final-score")!.value.trim();
    const value = raw === "" ? null : Number(raw);
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) { archiveNotice = "實得分數請填 0 或以上的整數，或留空。"; refreshArchiveBody(); return; }
    if (scoreEditing) startRecordCorrection();
    syncCurrentRecord();
    if (!currentRecord) return;
    currentRecord.status = "recorded";
    currentRecord.actualFinalScore = value;
    currentRecord.evidenceLevel = value === null ? null : app.querySelector<HTMLSelectElement>("#score-evidence")!.value as EvidenceLevel;
    currentRecord.completedAt = new Date().toISOString();
    currentRecord.updatedAt = currentRecord.completedAt;
    scoreEditing = false;
    archiveNotice = "已按你的操作紀錄本局；沒有自動上傳。";
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
    try { cloudStatus = "正在前往 GitHub 登入…"; render(); await signInWithGitHub(); }
    catch (error) { cloudStatus = error instanceof Error ? error.message : "無法開始 GitHub 登入"; render(); }
  });
  app.querySelector<HTMLButtonElement>("#cloud-sign-out")?.addEventListener("click", async () => {
    try { await signOutCloud(); cloudUser = null; cloudStatus = "已登出；本機紀錄仍保留。"; render(); }
    catch (error) { cloudStatus = error instanceof Error ? error.message : "登出失敗"; render(); }
  });
  app.querySelector<HTMLButtonElement>("#download-cloud-games")?.addEventListener("click", async () => {
    try { const games = await downloadRecordedGames(); const count = await importGames(games); archiveGames = await listGames(); cloudStatus = `雲端 ${games.length} 局；新增 ${count.added} 局，略過相同 ${count.skipped} 局。`; }
    catch (error) { cloudStatus = error instanceof Error ? error.message : "載入雲端牌局失敗"; }
    render();
  });
  app.querySelector<HTMLButtonElement>("#upload-current-game")?.addEventListener("click", async () => {
    if (!cloudUser || currentRecord?.status !== "recorded") return;
    try { await uploadRecordedGame(currentRecord, cloudUser); cloudStatus = "本局已同步至你的雲端帳號。"; }
    catch (error) { cloudStatus = error instanceof Error ? error.message : "本局同步失敗；本機紀錄仍保留。"; }
    render();
  });
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
  if (state.selected.length !== 5) return "";
  if (currentRecord?.status === "recorded" && !scoreEditing) return `<section class="real-score-panel panel"><h3>本局已記錄</h3><p>模型估算平均 ${summarizeScore(state.selected, RULES).meanScore.toFixed(1)} 分；遊戲實得 ${currentRecord.actualFinalScore === null ? "未填" : `${currentRecord.actualFinalScore.toLocaleString()} 分`}。兩者分開保存。</p><button type="button" class="secondary-action" id="edit-actual-score">更正本局紀錄</button></section>`;
  return `<section class="real-score-panel panel"><h3>紀錄這一局</h3><p>五回合已完成；按下「紀錄本局」才加入本機紀錄。遊戲實得分數可留空，模型分數不會代填。</p><form id="actual-score-form"><label>遊戲實得分數（可留空） <input id="actual-final-score" type="number" min="0" step="1" value="${scoreEditing && currentRecord?.actualFinalScore !== null ? currentRecord?.actualFinalScore ?? "" : ""}" /></label><label>證據來源 <select id="score-evidence"><option value="player_report">玩家回報</option><option value="screen_verified">已核對遊戲畫面</option></select></label><button class="primary-action" type="submit">紀錄本局</button>${scoreEditing ? `<button class="text-action" type="button" id="cancel-score-edit">取消更正</button>` : ""}</form></section>`;
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

function renderArchiveBody() {
  const summary = summarizeRealGames(archiveGames);
  const cardRows = [...summary.clickCounts].sort((a, b) => b[1].total - a[1].total).map(([id, count]) =>
    `<li>${esc(cardName(id))}：點選 ${count.total} 次、成功 ${count.success} 次；${count.total >= 30 ? `成功率 ${Math.round(count.success / count.total * 100)}%（95% 區間 ${wilsonInterval(count.success, count.total)}）` : "樣本不足，暫不校準機率"}</li>`).join("");
  const colorText = (color: CardColor) => `${colorLabel[color]} ${summary.offerColors[color]}`;
  const entries = archiveGames.slice(0, 12).map(game => `<li><time>${esc(game.createdAt.slice(0, 10))}</time> · ${game.rounds.length}/5 回合 · ${game.actualFinalScore === null ? "實得分數未填" : `${game.actualFinalScore} 分`} · 修訂 ${game.revision}</li>`).join("");
  return `<p role="status">${esc(archiveNotice)}</p><p>本機已記錄 ${summary.recordedCount} 局；有實得分數 ${summary.scoredCount} 局；五回合候選齊全 ${summary.completeWithOffersCount} 局。${summary.scoredCount < 30 ? "分數樣本不足，不顯示個人達標率。" : `實測平均 ${summary.averageScore!.toFixed(1)} 分。`}</p>
    <p>完成局中的候選顏色紀錄：${colorText("blue")}／${colorText("purple")}／${colorText("red")}（共 ${summary.observedOffers} 張）。</p>
    <p>終局預測與實得分數差：${summary.residualCount >= 30 ? `${summary.scoreResidualMean!.toFixed(1)} 分，n=${summary.residualCount}` : `樣本不足（${summary.residualCount}/30）`}。</p>
    <details><summary>查看點選後成功次數</summary><ul>${cardRows || "<li>尚無完整實測</li>"}</ul><small>未點選牌不計為失敗；模擬局與舊五局分數不在這裡。</small></details>
    <details><summary>查看最近牌局</summary><ul>${entries || "<li>尚無本機牌局</li>"}</ul></details>
    <div class="archive-actions"><button type="button" class="secondary-action" id="export-real-games">匯出 JSON 備份</button><label>匯入 JSON <input id="import-real-games" type="file" accept="application/json,.json" /></label></div>
    <small>資料只儲存在此瀏覽器；清除網站資料會遺失。JSON 可自行帶到另一台電腦匯入。沒有自動上傳。</small>`;
}

function startRecordCorrection() {
  if (!currentRecord || currentRecord.status !== "recorded") return;
  currentRecord.revisions.push({ at: new Date().toISOString(), previousScore: currentRecord.actualFinalScore, previousRounds: structuredClone(currentRecord.rounds) });
  currentRecord.revision++;
  currentRecord.status = "draft";
  currentRecord.actualFinalScore = null;
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
  if (body) { body.innerHTML = renderArchiveBody(); bindArchiveEvents(); }
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
      try { await uploadRecordedGame(snapshot, cloudOwner); cloudStatus = "本局已同步至你的雲端帳號。"; }
      catch (error) { cloudStatus = `本機已儲存；雲端同步失敗：${error instanceof Error ? error.message : "未知錯誤"}`; }
      const cloudNode = app.querySelector<HTMLElement>("#cloud-status");
      if (cloudNode) cloudNode.textContent = cloudStatus;
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
  return state.selected.slice(0, index).filter(card =>
    (!card.removed || card.cardId === currentTarget) && (RULES.starRemovalPolicy === "uniformPresent" || card.activated)
  );
}

function editHistoryResult(index: number, activated: boolean) {
  const card = state.selected[index];
  if (!card) return;
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
  pickerIndex = null; pickerDraft = null; pendingChoice = null; pendingChoiceSource = null; pendingOutcome = null; pendingTowerProc = null; pendingRemovedCardId = null;
  render();
  app.querySelector<HTMLElement>(returnFocus)?.focus();
}

function removableCards() {
  return state.selected.filter(card => card.cardId !== "star" && !card.removed && (RULES.starRemovalPolicy === "uniformPresent" || card.activated));
}

function commitOutcome(outcome: "success" | "failure") {
  if (!pendingChoice || state.selected.length >= 5) return;
  syncCurrentRecord();
  currentRecord ??= createGameRecord(CALCULATION_SEED, simulationCount);
  currentRecord.rounds.push(captureChosenRound(pendingChoice, outcome === "success"));
  snapshotCurrentState();
  if (pendingRemovedCardId) state.selected = state.selected.map(card => card.cardId === pendingRemovedCardId ? { ...card, removed: true } : card);
  state.selected.push({ ...pendingChoice, activated: outcome === "success", ...(outcome === "success" && pendingChoice.cardId === "tower" ? { towerProc: pendingTowerProc! } : {}) });
  starTargetIds = [...starTargetIds, pendingChoice.cardId === "star" ? pendingRemovedCardId : null];
  state.turn = Math.min(5, state.selected.length + 1) as GameState["turn"];
  pendingChoice = null; pendingChoiceSource = null; pendingOutcome = null; pendingTowerProc = null; pendingRemovedCardId = null;
  candidates = [null, null, null]; candidateColors = ["blue", "blue", "blue"];
  calculate();
  app.querySelector<HTMLElement>(state.selected.length === 5 ? "#completion-title" : '[data-pick="0"]')?.focus();
}

function renderOutcomeDialog() {
  const card = pendingChoice!;
  const needsTower = card.cardId === "tower" && pendingOutcome === "success";
  const targets = removableCards();
  const needsStar = card.cardId === "star" && pendingOutcome === "success" && targets.length > 0;
  const detail = needsTower ? `<fieldset><legend>高塔實際倍率</legend><div class="outcome-choice-row"><button type="button" data-tower-proc="false" class="${pendingTowerProc === false ? "selected" : ""}">低倍率 +0.25</button><button type="button" data-tower-proc="true" class="${pendingTowerProc === true ? "selected" : ""}">高倍率 +2.0</button></div></fieldset>` : needsStar ? `<fieldset><legend>星星移除哪張牌？</legend><div class="outcome-choice-row">${targets.map(target => `<button type="button" data-remove-card="${target.cardId}" class="${pendingRemovedCardId === target.cardId ? "selected" : ""}">${esc(cardName(target.cardId))}／${colorLabel[target.color]}</button>`).join("")}</div></fieldset>` : "";
  return `<dialog class="picker-dialog outcome-dialog" aria-labelledby="outcome-title"><h2 id="outcome-title">記錄 ${esc(cardName(card.cardId))}／${colorLabel[card.color]}</h2>${pendingOutcome ? `<p>請完成必要的實際結果，再提交這一回合。</p>${detail}<button type="button" class="primary-action" data-commit-outcome ${needsTower && pendingTowerProc === null || needsStar && pendingRemovedCardId === null ? "disabled" : ""}>完成記錄</button>` : `<p>請依遊戲畫面選擇；取消不會記錄。</p><div class="outcome-actions"><button type="button" class="primary-action" data-outcome="success">成功啟用</button><button type="button" class="secondary-action" data-outcome="failure">啟用失敗</button></div>`}<button type="button" class="text-action" data-outcome="cancel">取消，繼續比較</button></dialog>`;
}

worker = createWorker();
loadSession();
syncCurrentRecord();
render();
void loadArchive();
watchCloudAuth(user => { cloudUser = user; cloudStatus = user ? "已登入；新紀錄會在按下紀錄本局後同步。" : "尚未登入；本機紀錄仍可照常使用。"; render(); });
void currentCloudUser().then(user => { if (user?.id !== cloudUser?.id) { cloudUser = user; render(); } }).catch(() => {});
if (state.selected.length < 5 && candidatesReady()) calculate();
