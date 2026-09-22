import {
  CARDS, REWARD_THRESHOLDS, RULES, calculateScore, colorClass, colorLabel, recommend,
  type CardColor, type CardId, type GameState, type Objective, type OfferedCard, type SelectedCard
} from "./domain";
import "./styles.css";
import "./knowledge.css";
import "./pending.css";

const cardList = Object.values(CARDS);
const colorOptions: CardColor[] = ["blue", "purple", "red"];
let state: GameState = { turn: 1, selected: [] };
let targetThreshold = 1500;
let objective: Objective = { kind: "threshold", target: targetThreshold };
let candidates: Array<OfferedCard | null> = [null, null, null];
let candidateColors: CardColor[] = ["blue", "blue", "blue"];
type PickerDraft = { cardId: CardId | ""; color: CardColor };
let pickerIndex: number | null = null;
let pickerDraft: PickerDraft | null = null;
let simulationCount = 10000;
let result: ReturnType<typeof recommend> | null = null;

const REAL_SCORES = [748, 972, 1270, 840, 1648];
const REAL_AVERAGE = REAL_SCORES.reduce((sum, score) => sum + score, 0) / REAL_SCORES.length;
const MODEL_STATS = { games: 30, mean: 1118.6, median: 949, over1000: 12, over1500: 9, maximum: 2542 };

const app = document.querySelector<HTMLDivElement>("#app")!;
const esc = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const cardName = (id: CardId) => CARDS[id].name;
const colorBadge = (color: CardColor) => `<span class="color-chip ${colorClass[color]}">${colorLabel[color]}</span>`;
const pct = (value: number) => `${(value * 100).toFixed(2)}%`;

function renderHistory() {
  if (!state.selected.length) return `<div class="empty-state"><span>◌</span><p>尚未加入已選牌。新一局從第 1 回合開始。</p></div>`;
  return state.selected.map((card, index) => `<div class="history-row">
    <span class="turn-no">${index + 1}</span>${colorBadge(card.color)}<strong>${esc(cardName(card.cardId))}</strong>
    <span class="status ${card.activated ? "success" : "failed"}">${card.activated ? "啟用" : "失敗"}</span>${card.removed ? `<span class="removed">已移除</span>` : ""}
  </div>`).join("");
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
    <button type="button" class="candidate-slot-button" data-pick="${index}" aria-label="選擇第 ${index + 1} 張候選牌"><span class="slot-plus">${candidate ? "✦" : "＋"}</span><strong>${candidate ? esc(cardName(candidate.cardId)) : "選擇卡片"}</strong><small>${candidate ? "點擊修改卡片" : "請選擇候選卡片"}</small></button>
    <div class="candidate-color-buttons" role="group" aria-label="第 ${index + 1} 張候選牌顏色">${colorOptions.map(option => `<button type="button" class="candidate-color-button ${colorClass[option]} ${color === option ? "selected" : ""}" data-slot-color="${option}" data-slot-index="${index}" aria-pressed="${color === option}">${colorLabel[option]}</button>`).join("")}</div>
    <div class="pending-copy">${candidate ? "已填入候選牌" : "請選擇候選牌"}</div>
  </article>`;
}

function renderPicker() {
  if (pickerIndex === null || !pickerDraft) return "";
  const usedByOtherSlot = new Set(candidates.flatMap((candidate, index) => index === pickerIndex || !candidate ? [] : [candidate.cardId]));
  const selectedCard = pickerDraft.cardId ? CARDS[pickerDraft.cardId] : null;
  return `<div class="picker-backdrop" data-picker-backdrop><section class="picker-dialog" role="dialog" aria-modal="true" aria-labelledby="picker-title">
    <div class="picker-header"><div><p class="eyebrow">CARD PICKER</p><h2 id="picker-title">選擇第 ${pickerIndex + 1} 張候選牌</h2></div><button type="button" class="picker-close" data-picker-cancel aria-label="關閉選擇器">×</button></div>
    <div class="picker-section"><div class="picker-section-heading"><strong>1. 選擇卡片</strong><small>${selectedCard ? `目前：${esc(selectedCard.name)}` : "尚未選擇"}</small></div><div class="picker-card-grid">${cardList.map(card => `<button type="button" class="picker-card ${pickerDraft!.cardId === card.id ? "selected" : ""}" data-picker-card="${card.id}" ${usedByOtherSlot.has(card.id) ? "disabled" : ""}><strong>${esc(card.name)}</strong><small>${card.category === "score" ? `分數卡 · +${card.scoreValue}` : card.category === "multiplier" ? `倍率卡 · +${Math.round((card.multiplierValue ?? 0) * 100)}%` : "特殊卡"}</small><span>${Math.round(card.activationProbability * 100)}%</span></button>`).join("")}</div></div>
    <div class="picker-section"><div class="picker-section-heading"><strong>2. 選擇卡牌顏色</strong><small>${colorLabel[pickerDraft.color]}</small></div><div class="picker-color-options">${colorOptions.map(color => `<button type="button" class="picker-color ${colorClass[color]} ${pickerDraft!.color === color ? "selected" : ""}" data-picker-color="${color}" aria-pressed="${pickerDraft!.color === color}">${colorLabel[color]}</button>`).join("")}</div></div>
    <div class="picker-footer"><span>${selectedCard ? `${esc(selectedCard.name)}／${colorLabel[pickerDraft.color]}` : "請先選擇一張卡片"}</span><div><button type="button" class="secondary-action" data-picker-cancel>取消</button><button type="button" class="primary-action" data-picker-apply ${selectedCard ? "" : "disabled"}>套用候選</button></div></div>
  </section></div>`;
}

function renderEvidencePanel() {
  const currentScore = state.selected.length ? calculateScore(state.selected, () => .5, RULES).finalScore : 0;
  return `<section class="panel evidence-panel"><div class="section-heading"><div><p class="eyebrow">RECORDED EVIDENCE</p><h2>統計與實測</h2></div><span class="rule-pill">5 局</span></div>
    <div class="current-score"><span>目前估算分數</span><strong>${currentScore.toLocaleString()}</strong></div>
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

function renderCandidate(index: number, metric: NonNullable<typeof result>["ranked"][number]) {
  const card = CARDS[metric.candidate.cardId];
  const isTop = index === 0;
  const slotIndex = candidates.findIndex(candidate => candidate?.cardId === metric.candidate.cardId);
  const pLabel = metric.thresholdProbability === 0 ? (metric.method === "monte_carlo" ? `抽樣 ${metric.simulations.toLocaleString()} 次未命中` : "模型為 0") : pct(metric.thresholdProbability);
  return `<article class="candidate-card ${isTop ? "is-top" : ""} ${colorClass[metric.candidate.color]}">
    <div class="candidate-top"><span class="rank">${String(index + 1).padStart(2, "0")}</span>${colorBadge(metric.candidate.color)}<span class="category">${card.category === "score" ? "分數" : card.category === "multiplier" ? "倍率" : "特殊"}</span>${isTop ? `<span class="recommend-badge">推薦</span>` : ""}</div>
    <h3>${esc(card.name)}</h3>
    <div class="card-effect">${card.category === "score" ? `+${card.scoreValue} 分` : card.category === "multiplier" ? `+${Math.round((card.multiplierValue ?? 0) * 100)}%` : "特殊效果"}</div>
    <div class="metric-main"><span>達標機率</span><strong>${pLabel}</strong></div>
    <div class="metric-row"><span>預期最終分數</span><strong>${metric.meanScore.toFixed(1)}</strong></div>
    <div class="metric-row"><span>分數範圍</span><strong>${metric.minScore}～${metric.maxScore}</strong></div>
    <div class="percentile"><span>P10 ${metric.p10}</span><span>P50 ${metric.p50}</span><span>P90 ${metric.p90}</span></div>
    <div class="activation">點選獲得率 <b>${Math.round(card.activationProbability * 100)}%</b></div>
    <button type="button" class="edit-candidate" data-pick="${slotIndex}">編輯卡片／顏色</button>
    <button class="choose-card" data-choose="${metric.candidate.cardId}" data-choose-color="${metric.candidate.color}">選擇這張</button>
  </article>`;
}

function render() {
  const bestMean = result ? [...result.ranked].sort((a, b) => b.meanScore - a.meanScore)[0]! : null;
  const fallback = result?.mode === "highest_expected_score_fallback";
  const activeCounts = state.selected.filter(c => c.activated && !c.removed).reduce((counts, c) => { counts[c.color]++; return counts; }, { blue: 0, purple: 0, red: 0 } as Record<CardColor, number>);
  app.innerHTML = `<main class="shell">
    <header class="header">
      <div><p class="eyebrow">YURIA / DECISION ENGINE</p><h1>尤里亞的占卜計算器</h1><p class="subhead">把牌面規則攤開，讓每一次選擇有可追溯的數字。</p></div>
      <div class="header-meta"><span class="live-dot"></span><span>本機計算</span><span class="rule-pill">22 張資料</span></div>
    </header>
    <section class="control-bar panel">
      <div class="control-group"><label>推薦目標</label><div class="segmented"><button data-objective="threshold" class="${objective.kind === "threshold" ? "active" : ""}">達標率</button><button data-objective="expected" class="${objective.kind === "expected" ? "active" : ""}">預期分數</button><button data-objective="stability" class="${objective.kind === "stability" ? "active" : ""}">穩定</button></div></div>
      <label class="target-field">目標分數 <input id="target" type="number" min="0" step="100" value="${targetThreshold}" /></label>
      <label class="simulation-field">模擬次數 <select id="simulations"><option value="5000" ${simulationCount === 5000 ? "selected" : ""}>5,000（快速）</option><option value="10000" ${simulationCount === 10000 ? "selected" : ""}>10,000（標準）</option><option value="20000" ${simulationCount === 20000 ? "selected" : ""}>20,000（精細）</option></select></label>
      <button class="primary-action" id="calculate">重新計算 <span>↗</span></button>
    </section>
    <div class="layout">
      <aside class="sidebar">
        <section class="panel history-panel"><div class="section-heading"><div><p class="eyebrow">CURRENT RUN</p><h2>已確定卡片</h2></div><span class="turn-counter">${state.selected.length} / 5</span></div>
          <div class="progress"><span style="width:${state.selected.length * 20}%"></span></div>
          <div class="color-counts"><span class="blue-text">藍 ${activeCounts.blue}</span><span class="purple-text">紫 ${activeCounts.purple}</span><span class="red-text">紅 ${activeCounts.red}</span></div>
          <div class="history-list">${renderHistory()}</div>
          <div class="history-actions">${result || state.selected.length ? `<button class="secondary-action" id="add-history">＋ 加入已選牌</button>` : `<span class="history-hint">先完成右側三張候選牌</span>`}<button class="text-action" id="reset">重設本局</button></div>
        </section>
        ${renderEvidencePanel()}
        <section class="panel data-panel"><div class="section-heading"><div><p class="eyebrow">MODEL STATUS</p><h2>資料可信度</h2></div><span class="status-dot verified"></span></div>
          <div class="confidence"><div><span class="confidence-icon verified">✓</span><p><strong>22 張牌資料</strong><small>使用者提供並記錄</small></p></div><div><span class="confidence-icon warning">△</span><p><strong>未驗證出牌分布</strong><small>類別內暫採等權</small></p></div><div><span class="confidence-icon warning">△</span><p><strong>紅色抽樣模型</strong><small>整數預設；1648 暗示連續值</small></p></div><div><span class="confidence-icon muted">—</span><p><strong>Jev 僅語意路由</strong><small>不參與數學計算</small></p></div></div>
        </section>
      </aside>
      <section class="workspace"><div class="workspace-heading"><div><p class="eyebrow">TURN ${state.turn} / CANDIDATES</p><h2>這回合的 3 張候選</h2></div><span class="calculation-time">seed 20260922 · ${simulationCount.toLocaleString()} 次</span></div>
        <div class="candidate-grid">${result ? result.ranked.map((metric, index) => renderCandidate(index, metric)).join("") : candidates.map((candidate, index) => renderPendingCandidate(index, candidate)).join("")}</div>
        <section class="decision-panel panel ${result ? "" : "pending-decision"}"><div><p class="eyebrow">${result ? "DECISION SPLIT" : "FIRST STEP"}</p><h2>${result ? (fallback ? "達標率皆為零，改看預期分數" : "兩種推薦同時保留") : "先選擇本回合三張候選牌"}</h2><p>${result ? (fallback ? "目前沒有模擬結果達到目標，系統選擇預期最終分數最高的牌。" : "你可以選擇拚目標，或選擇平均拿分最高的牌。") : candidateInputHint()}</p></div>${result && bestMean ? `<div class="decision-values"><div><span>達標率最高</span><strong>${esc(CARDS[result.ranked[0]!.candidate.cardId].name)}／${colorLabel[result.ranked[0]!.candidate.color]}</strong></div><div><span>預期分數最高</span><strong>${esc(CARDS[bestMean.candidate.cardId].name)}／${colorLabel[bestMean.candidate.color]}</strong></div></div>` : ""}</section>
        ${renderKnowledgePanels()}
      </section>
    </div>
    <footer class="footer"><span>數學結果由本機 deterministic engine 計算</span><span>特殊卡、顏色級距與失敗補償已納入</span><span>祝福尚未建模</span></footer>
    ${renderPicker()}
  </main>`;
  bindEvents();
}

function calculate() { result = candidatesReady() ? recommend(state, candidates as OfferedCard[], objective, simulationCount, 20260922, RULES, targetThreshold) : null; render(); }
function bindEvents() {
  app.querySelectorAll<HTMLButtonElement>("[data-objective]").forEach(button => button.addEventListener("click", () => { const kind = button.dataset.objective as Objective["kind"]; objective = kind === "threshold" ? { kind, target: targetThreshold } : { kind }; calculate(); }));
  app.querySelector<HTMLInputElement>("#target")?.addEventListener("change", event => { const target = Number((event.target as HTMLInputElement).value); targetThreshold = Number.isFinite(target) && target >= 0 ? target : 1500; if (objective.kind === "threshold") objective = { kind: "threshold", target: targetThreshold }; calculate(); });
  app.querySelector<HTMLSelectElement>("#simulations")?.addEventListener("change", event => { simulationCount = Number((event.target as HTMLSelectElement).value); calculate(); });
  app.querySelector<HTMLButtonElement>("#calculate")?.addEventListener("click", calculate);
  app.querySelector<HTMLButtonElement>("#reset")?.addEventListener("click", () => { state = { turn: 1, selected: [] }; candidates = [null, null, null]; candidateColors = ["blue", "blue", "blue"]; pickerIndex = null; pickerDraft = null; calculate(); });
  app.querySelectorAll<HTMLButtonElement>("[data-slot-color]").forEach(button => button.addEventListener("click", () => { const index = Number(button.dataset.slotIndex); const color = button.dataset.slotColor as CardColor; candidateColors[index] = color; if (candidates[index]) candidates[index] = { ...candidates[index]!, color }; calculate(); }));
  app.querySelectorAll<HTMLElement>("[data-pick]").forEach(trigger => trigger.addEventListener("click", () => { const index = Number(trigger.dataset.pick); const candidate = candidates[index]; pickerIndex = index; pickerDraft = { cardId: candidate?.cardId ?? "", color: candidate?.color ?? candidateColors[index]! }; render(); }));
  app.querySelectorAll<HTMLButtonElement>("[data-picker-card]").forEach(button => button.addEventListener("click", () => { if (!pickerDraft) return; pickerDraft = { ...pickerDraft, cardId: button.dataset.pickerCard as CardId }; render(); }));
  app.querySelectorAll<HTMLButtonElement>("[data-picker-color]").forEach(button => button.addEventListener("click", () => { if (!pickerDraft) return; pickerDraft = { ...pickerDraft, color: button.dataset.pickerColor as CardColor }; render(); }));
  app.querySelectorAll<HTMLButtonElement>("[data-picker-cancel]").forEach(button => button.addEventListener("click", () => { pickerIndex = null; pickerDraft = null; render(); }));
  app.querySelector<HTMLElement>("[data-picker-backdrop]")?.addEventListener("click", event => { if (event.target === event.currentTarget) { pickerIndex = null; pickerDraft = null; render(); } });
  app.querySelector<HTMLButtonElement>("[data-picker-apply]")?.addEventListener("click", () => { if (pickerIndex === null || !pickerDraft?.cardId) return; candidates[pickerIndex] = { cardId: pickerDraft.cardId, color: pickerDraft.color }; candidateColors[pickerIndex] = pickerDraft.color; pickerIndex = null; pickerDraft = null; calculate(); });
  app.querySelector<HTMLButtonElement>("#add-history")?.addEventListener("click", () => addHistory());
  app.querySelectorAll<HTMLButtonElement>("[data-choose]").forEach(button => button.addEventListener("click", () => addHistory(button.dataset.choose as CardId, button.dataset.chooseColor as CardColor)));
}

function addHistory(cardId?: CardId, color?: CardColor) {
  if (state.selected.length >= 5) return;
  const id = cardId ?? "fool"; const cardColor = color ?? "blue";
  const activated = window.confirm(`${cardName(id)}／${colorLabel[cardColor]}：按「確定」記為啟用，按「取消」記為失敗。`);
  state.selected = [...state.selected, { cardId: id, color: cardColor, activated }];
  state.turn = Math.min(5, state.selected.length + 1) as GameState["turn"];
  calculate();
}

render();
