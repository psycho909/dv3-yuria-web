# 尤里亞推薦演算法 V2

## 0. 任務目標

將目前：

```text
Round 1–4
Monte Carlo
+
單步 Greedy rollout

Round 5
Exact enumeration
```

升級為：

```text
Round 1–4
Goal-aware Sampled Expectimax / Multi-step Lookahead
+
Common Random Numbers

Round 5
Exact enumeration
```

核心目標：

> 當玩家選擇「達標率／預期分數／穩定」時，從目前這一手到第 5 回合，都必須使用相同決策目標。

不是只改善 UI 排序，也不是增加 Monte Carlo 次數。

---

# Part A — Codex 修改 Prompt

```text
你正在修改「尤里亞的占卜計算器」的推薦演算法。

開始前必須先閱讀：

- AGENTS.md
- PROJECT.md
- SPEC.md
- 目前的推薦演算法文件
- src/domain.ts
- src/main.ts
- src/recommend.worker.ts
- src/real-game-record.ts
- tests/

本 Ticket 的目標不是重構整個專案，也不是重新設計 UI。

目標只有：

將 Round 1–4 現有的單步 greedy rollout，
升級為 goal-aware multi-step Expectimax / sampled lookahead，
並保留 Round 5 現有 exact enumeration。

==================================================
一、禁止事項
==================================================

1. 不可修改已驗證的遊戲計分公式，除非現有測試證明程式與規格不一致。

2. 不可讓 Jev、LLM 或任何生成式 AI 參與：
   - 卡片成功率計算
   - 最終分數計算
   - Monte Carlo
   - Expectimax
   - 卡片推薦排名

3. 不可把模型模擬結果寫入「真實遊戲紀錄」。

4. 不可把目前未驗證假設改寫成已確認遊戲規則。

5. 不可移除：
   - seeded reproducibility
   - Web Worker
   - Round 5 exact solver
   - rulesVersion / catalogVersion
   - 真實遊戲紀錄版本資訊

6. 不要單純把 simulations 從 10,000 提高到更大的數字來代替演算法修改。

==================================================
二、目前需要修正的核心問題
==================================================

目前 Round 1–4 的未來決策使用單步 greedy：

未來出現三張候選
→ 比較成功／失敗後的「當下預期分數」
→ 選當下最高
→ 前往下一回合

這會忽略：

- 未來顏色組合
- 藍色 3/4/5 張門檻
- 紫色 3/4/5 張門檻
- 紅色終局倍率
- 特殊卡與其他卡片的交互作用
- 為後續回合保留某張卡的價值
- 不同推薦模式的長期目標

因此修改成：

Current State
    ↓
Current Candidate
    ↓
success / fail / special branches
    ↓
Future candidate set samples
    ↓
對每組候選遞迴比較三個 Action
    ↓
選擇符合目前 objective 的最佳 future action
    ↓
直到 Round 5
    ↓
Exact Solver
    ↓
回傳整體 distribution / utility

==================================================
三、推薦模式必須貫穿全部剩餘回合
==================================================

建立明確的 RecommendationObjective：

1. target
2. expected
3. stable

不可只在目前畫面的三張候選排序時套用 objective。

未來模擬中的所有決策節點都必須使用同一 objective。

### target

主要：

P(finalScore >= targetScore)

Tie-break：

1. expectedScore
2. CVaR10
3. deterministic card id

### expected

主要：

expectedScore

Tie-break：

1. targetProbability
2. CVaR10
3. deterministic card id

### stable

主要：

CVaR10

CVaR10 定義：

最差 10% 最終結果的平均分數。

Tie-break：

1. P10
2. expectedScore
3. deterministic card id

UI 可以繼續顯示 P10，
但 stable 的主要內部排序不得再只依靠 P10。

==================================================
四、V2 Search Algorithm
==================================================

實作一個獨立 Planner。

建議名稱：

src/recommendation/
  planner.ts
  objective.ts
  distribution.ts
  random.ts

若現有架構更適合放在 domain.ts，可保留現有結構，
但不得讓 UI main.ts 承擔演算法。

核心 API 建議：

recommendCandidatesV2({
  state,
  candidates,
  objective,
  config,
  rules
})

回傳：

RecommendationResult[]

--------------------------------------------------
A. Round 5
--------------------------------------------------

完全沿用現在 exact enumeration。

Round 5：

- 不使用 Monte Carlo
- simulations = 0
- method = "exact"

列舉：

- card success / failure
- Tower 50/50
- Star removal targets
- red integer percentage branches
- 其他現有 exact branches

輸出完整 weighted score distribution。

--------------------------------------------------
B. Round 1–4
--------------------------------------------------

使用 sampled Expectimax。

Pseudo flow：

evaluateAction(state, candidate, round, context)

1. 枚舉或抽樣此 candidate 的狀態轉移。
2. 對每個 resulting state：
   - 若 nextRound == 5：
       sample future candidate sets
       對每組 candidate set：
           使用 Round 5 exact solver
           依 objective 選最佳 future action
   - 若 nextRound < 5：
       sample future candidate sets
       對每組 candidate set：
           遞迴 evaluate 每張 future candidate
           依 objective 選最佳 future action
3. 合併所有 weighted terminal distributions。
4. 計算：
   - mean
   - targetProbability
   - P10
   - P50
   - P90
   - min
   - max
   - CVaR10
5. 回傳 ActionEvaluation。

重要：

Expectimax 的 Max node：

玩家選擇哪張牌。

Chance node：

- 成功／失敗
- 特殊卡隨機分支
- 未來候選生成
- 顏色
- 其他已建模 RNG

==================================================
五、避免組合爆炸
==================================================

不要暴力枚舉所有未來三張牌組合。

Round 1–4 的未來候選使用 sampled candidate sets。

建立：

PlannerConfig

至少包含：

{
  scenarioCount,
  maxDepth,
  seed,
  useCommonRandomNumbers,
  stableTailPercent
}

預設：

scenarioCount：
沿用使用者選擇的 5000 / 10000 / 20000 作為整體 scenario budget，
不要讓每個 recursion node 都重新跑 10000 次。

必須設計「總預算」或分層 sample budget，
避免：

3 × 10000 × 3 × 10000 ...

這種指數爆炸。

建議方式：

每個 root candidate 共用 Scenario Path。

Scenario Path 事先產生：

Scenario #1
  round 1 random values
  round 2 random values
  round 3 random values
  round 4 random values
  round 5 random values

Scenario #2
  ...

Planner 在每條 scenario path 中，
每個 decision node 根據 objective 選最佳 action。

不要在每個節點重新建立全新的 Monte Carlo universe。

==================================================
六、Common Random Numbers
==================================================

目前三張 root candidate 使用不同衍生 seed。

V2 改成 Common Random Numbers。

目的：

比較 A / B / C 時，
盡量讓它們面對相同的未來隨機環境，
降低 Monte Carlo ranking noise。

例如：

Scenario 001

A：
  successUniform = 0.42
  futureCategoryUniforms = [...]
  futureCardUniforms = [...]
  futureColorUniforms = [...]

B：
  使用同一組 uniforms

C：
  使用同一組 uniforms

因為不同 State 的 available pool 可能不同，
同一 uniform 不保證抽到同一張卡，
但必須由相同 deterministic random coordinate 導出。

不要依：

candidateId → independent RNG stream

改為：

baseSeed
+
scenarioIndex
+
round
+
eventType
+
slot
+
branch coordinate

例如：

u = deterministicRandom({
  seed,
  scenario,
  round,
  event: "future-card",
  slot: 1
})

要求：

相同：
- game state
- rules
- objective
- seed
- simulation count

必須產生完全相同結果。

==================================================
七、Distribution 必須是第一級資料
==================================================

不要讓 recursive planner 只回傳單一 expected value。

建立 ScoreDistribution abstraction。

可以使用：

WeightedScore[]

interface WeightedScore {
  score: number;
  weight: number;
}

或適合現有架構的 histogram。

至少支援：

mean()
probabilityAtLeast(target)
quantile(0.10)
quantile(0.50)
quantile(0.90)
cvarLower(0.10)
min()
max()

注意浮點權重誤差。

最後總 weight 應約等於 1。

允許 tolerance，例如：

1e-9 / 1e-6

視目前實作選擇。

==================================================
八、Objective Comparator
==================================================

所有：

- root candidate ranking
- future action selection
- Round 5 action selection

必須使用同一個 comparator。

禁止出現：

root 使用 expected
future Round 5 卻使用 target

建立單一函式，例如：

compareActionEvaluation(
  a,
  b,
  objective
)

所有地方共用。

不要複製三套排序邏輯。

==================================================
九、Game State
==================================================

Planner 使用 immutable state。

禁止 recursive branch 共用並修改同一個 selectedCards array。

每個 transition 回傳新的 GameState。

State 至少需要：

- currentRound
- selected cards
- card color
- status
- removed state
- special effect resolution
- used card ids

既有真實遊戲 Record type 與 Simulation State 不要強行混成同一型別。

真實紀錄是 observation。

Simulation State 是 planner internal state。

==================================================
十、特殊卡
==================================================

沿用目前規則：

Tower：
成功後：
  +200%：50%
  +25%：50%

Star：
成功 +240%
並移除自身以外一張可移除牌。

Moon：
+20
每張尚未移除 failure +100

Sun：
目前規則仍：
+40%
每張成功且未移除卡再 +40%
Sun 自己算成功卡。

World：
最高成功、未移除「分數卡」分數 ×2。

不要在此 Ticket 修改這些規則。

但所有特殊卡 stochastic branch
必須能進入 Expectimax distribution。

==================================================
十一、Future Candidate Generator
==================================================

沿用目前假設：

Round 1–4：

score : multiplier : special
10 : 10 : 5

Round 5：

5 : 10 : 20

同一候選組內：

- 三張 card id 不得重複
- 不得包含本局已選過 card
- category 內剩餘 card 等權
- category 空時 fallback 到其他 category

Color：

Blue / Purple / Red
各 1/3。

這些仍標註：

MODEL ASSUMPTION

不要更名為 observed probability。

==================================================
十二、Performance
==================================================

Web Worker 必須保留。

建議增加 telemetry：

RecommendationDiagnostics {
  method: "sampled-expectimax" | "exact";
  scenarios: number;
  nodesEvaluated: number;
  exactLeafCount: number;
  cacheHits: number;
  durationMs: number;
  seed: number;
}

UI 不一定全部顯示，
但 debug / development 可取得。

主要要求：

一般桌機：
10,000 scenario 的推薦不能造成 UI thread freeze。

Worker 可以長時間運算，
但不可讓頁面無回應。

若 V2 計算量顯著高於 V1，
允許：

- memoization
- pre-generated scenario paths
- batched processing
- early aggregation

不可用錯誤近似偷偷回到 greedy。

==================================================
十三、Memoization
==================================================

可以建立 memo key：

{
  normalizedState,
  round,
  objective,
  targetScore,
  rulesVersion,
  scenario coordinate
}

但只有在語意完全一致時才能 cache。

不要因 cache 導致不同 scenario 共用不應共享的 RNG branch。

Round 5 exact evaluation 特別適合 memoize。

==================================================
十四、V1 / V2 對照模式
==================================================

若修改成本合理，
保留：

algorithmVersion:
  "v1-greedy"
  "v2-expectimax"

正式 UI 預設：

v2-expectimax

V1 可只保留 development / test 用途。

目的：

用固定 fixtures 比較：

V1 recommendation
vs
V2 recommendation

不要求兩者一定不同。

但需要確認：
當存在 delayed reward case 時，
V2 能避免 V1 的短視選擇。

==================================================
十五、輸出資料
==================================================

RecommendationResult 至少：

{
  cardId,
  color,
  acquisitionProbability,

  expectedScore,
  targetProbability,

  p10,
  p50,
  p90,
  cvar10,

  minScore,
  maxScore,

  method,
  simulations,

  rank,

  diagnostics?
}

可加入：

decisionReason

但 decisionReason 必須由 deterministic metrics 組合產生，
不要呼叫 AI。

例如：

「此選擇的 1500 分達標率較其他候選高 8.4 個百分點。」

==================================================
十六、測試
==================================================

完成修改後必須：

npm test
npm run typecheck
npm run build

如果 repo 有 lint：

npm run lint

全部通過。

新增 V2 專用測試。

具體驗收條件見下方 Acceptance Tests。

==================================================
十七、完成回報
==================================================

完成後不要只說「已完成」。

回報：

1. 修改檔案
2. V1 → V2 核心差異
3. Planner search strategy
4. Common Random Numbers 實作方式
5. stable/CVaR10 實作方式
6. performance 結果
7. 新增測試
8. npm test / typecheck / build 結果
9. 仍存在的模型假設
10. 是否有任何規則因實作需要而被改動

如果發現現有規則文件與程式碼不同：

不要自行猜測。

保留目前正式規則，
列出 conflict，
以 regression tests 與目前推薦演算法文件為優先依據。
```

---

# Part B — V2 資料結構

## 1. Recommendation Objective

```ts
export type RecommendationMode =
  | "target"
  | "expected"
  | "stable";

export interface RecommendationObjective {
  mode: RecommendationMode;

  /**
   * target 模式使用。
   * 其他模式仍可計算 targetProbability，
   * 方便 UI 顯示。
   */
  targetScore: number;

  /**
   * stable 預設 0.10。
   */
  lowerTailFraction: number;
}
```

---

## 2. Planner Config

```ts
export interface PlannerConfig {
  algorithmVersion: "v2-expectimax";

  /**
   * Root Monte Carlo scenario 數。
   * 例如 5000 / 10000 / 20000。
   */
  scenarioCount: number;

  seed: number;

  /**
   * 預設 true。
   */
  useCommonRandomNumbers: boolean;

  /**
   * 目前最多搜尋到第五回合。
   */
  maxRound: 5;

  /**
   * Stable mode，例如 0.10。
   */
  stableTailFraction: number;

  /**
   * 可選：效能保護。
   * 不應改變演算法語意。
   */
  batchSize?: number;
}
```

---

## 3. Simulation State

不要直接拿真實紀錄當模擬 State。

```ts
export type CardResolution =
  | "success"
  | "failure";

export interface SimulatedSelectedCard {
  cardId: string;

  color:
    | "blue"
    | "purple"
    | "red";

  resolution: CardResolution;

  removed: boolean;

  specialResolution?: {
    towerMultiplierBonus?: number;

    starRemovedCardId?: string | null;
  };
}

export interface SimulationGameState {
  /**
   * 已完成幾次選牌。
   * 0 ~ 5
   */
  selectionsCompleted: number;

  selectedCards: readonly SimulatedSelectedCard[];

  usedCardIds: ReadonlySet<string>;

  rulesVersion: string;

  catalogVersion: string;
}
```

若 `ReadonlySet` 不方便 serialize 到 Worker，可用：

```ts
readonly string[]
```

並在 domain layer 轉換。

---

## 4. Candidate

```ts
export interface CandidateCard {
  cardId: string;

  color:
    | "blue"
    | "purple"
    | "red";
}
```

---

## 5. Score Distribution

推薦使用 histogram，避免大量重複 score samples。

```ts
export interface WeightedScoreBucket {
  score: number;
  weight: number;
}

export interface ScoreDistribution {
  buckets: readonly WeightedScoreBucket[];

  totalWeight: number;
}
```

Domain functions：

```ts
export function distributionMean(
  distribution: ScoreDistribution
): number;

export function probabilityAtLeast(
  distribution: ScoreDistribution,
  targetScore: number
): number;

export function distributionQuantile(
  distribution: ScoreDistribution,
  quantile: number
): number;

export function lowerTailCVaR(
  distribution: ScoreDistribution,
  fraction: number
): number;
```

CVaR 注意：

如果 10% cutoff 落在某個 bucket 中間，
只取該 bucket 對應所需的部分 weight。

不要簡單：

```ts
scores.slice(0, Math.floor(n * 0.1))
```

因為 exact distribution 有 weighted branches。

---

## 6. Action Metrics

```ts
export interface ActionMetrics {
  expectedScore: number;

  targetProbability: number;

  p10: number;
  p50: number;
  p90: number;

  cvar10: number;

  minScore: number;
  maxScore: number;
}
```

---

## 7. Action Evaluation

```ts
export interface ActionEvaluation {
  candidate: CandidateCard;

  acquisitionProbability: number;

  distribution: ScoreDistribution;

  metrics: ActionMetrics;

  method:
    | "sampled-expectimax"
    | "exact";

  simulations: number;

  diagnostics?: PlannerDiagnostics;
}
```

---

## 8. Planner Diagnostics

```ts
export interface PlannerDiagnostics {
  nodesEvaluated: number;

  chanceBranchesEvaluated: number;

  exactLeafCount: number;

  cacheHits: number;

  scenarioCount: number;

  seed: number;

  durationMs: number;
}
```

---

# Part C — 核心 Planner 介面

```ts
export interface RecommendCandidatesInput {
  state: SimulationGameState;

  candidates: readonly CandidateCard[];

  objective: RecommendationObjective;

  config: PlannerConfig;

  rules: GameRules;

  catalog: CardCatalog;
}

export interface RecommendationResult
  extends ActionEvaluation {
  rank: number;
}

export function recommendCandidatesV2(
  input: RecommendCandidatesInput
): RecommendationResult[];
```

---

# Part D — Objective Comparator

建立唯一排序入口：

```ts
export function compareEvaluations(
  a: ActionEvaluation,
  b: ActionEvaluation,
  objective: RecommendationObjective
): number;
```

語意：

```ts
switch (objective.mode) {
  case "target":
    // 1. targetProbability
    // 2. expectedScore
    // 3. cvar10
    break;

  case "expected":
    // 1. expectedScore
    // 2. targetProbability
    // 3. cvar10
    break;

  case "stable":
    // 1. cvar10
    // 2. p10
    // 3. expectedScore
    break;
}
```

最後 deterministic tie-break：

```text
cardId
color
```

確保 seeded run 排名穩定。

---

# Part E — V2 Search Pseudocode

```ts
function evaluateAction(
  state,
  candidate,
  context
): ScoreDistribution {

  if (state.selectionsCompleted === 4) {
    return exactRoundFiveActionDistribution(
      state,
      candidate,
      context
    );
  }

  const aggregate = createDistribution();

  for (const scenario of context.scenarios) {

    const transition =
      resolveCandidateUsingScenarioRandomness(
        state,
        candidate,
        scenario
      );

    const nextState = transition.state;

    if (nextState.selectionsCompleted === 5) {
      aggregate.add(
        scoreFinalState(nextState),
        transition.weight
      );

      continue;
    }

    const nextCandidates =
      generateFutureCandidates(
        nextState,
        scenario
      );

    const evaluations =
      nextCandidates.map(nextCandidate =>
        evaluateAction(
          nextState,
          nextCandidate,
          context.nextDepth()
        )
      );

    const best =
      chooseBestEvaluation(
        evaluations,
        context.objective
      );

    aggregate.merge(best);
  }

  return aggregate.normalize();
}
```

實際實作可比這更有效率。

重點不是逐字照抄，而是：

> 未來 decision node 必須真的重新比較三個 action，而不是使用單步 immediate score heuristic。

---

# Part F — Common Random Numbers

建議不要維護 mutable RNG position。

改成 deterministic coordinate RNG：

```ts
interface RandomCoordinate {
  seed: number;
  scenario: number;
  round: number;

  event:
    | "card-success"
    | "future-category"
    | "future-card"
    | "future-color"
    | "tower"
    | "star-removal";

  slot?: number;

  branch?: number;
}
```

API：

```ts
export function random01(
  coordinate: RandomCoordinate
): number;
```

例如：

```ts
const successU = random01({
  seed: 20260922,
  scenario: 183,
  round: 3,
  event: "card-success",
});
```

A / B / C root candidate 在 scenario 183 都使用相同 `successU`。

卡片成功率不同，因此結果仍可能不同：

```text
U = 0.62

A success rate = 80%
→ success

B success rate = 60%
→ failure
```

這正是 CRN 想要的相關性。

---

# Part G — 驗收測試

## Test 1：Seed 可重現

相同：

```text
state
candidates
objective
rules
seed
scenarioCount
```

連續執行兩次：

```ts
expect(result1).toEqual(result2);
```

必須：

* ranking 相同
* EV 相同
* probability 相同
* P10/P50/P90 相同
* CVaR10 相同

---

## Test 2：Candidate 順序不應改變推薦結果

輸入：

```text
[A, B, C]
```

與：

```text
[C, A, B]
```

經 cardId 對齊後：

```ts
expect(metricsByCard).toEqual(...)
```

排名只依 metric / deterministic tie-break。

不可因 input array order 改變 RNG universe。

---

## Test 3：Round 5 保持 Exact

當：

```ts
state.selectionsCompleted === 4
```

推薦結果必須：

```ts
method === "exact"
simulations === 0
```

且與 V1 已有 Round 5 regression fixture 完全一致。

---

## Test 4：Expected 模式貫穿未來

建立人工 fixture：

```text
Candidate A：
當下分數較高，
但破壞未來高價值顏色組合。

Candidate B：
當下分數略低，
但讓 Round 4/5 有明顯更高最終 EV。
```

要求：

V1 greedy：

```text
A
```

V2 expected：

```text
B
```

此測試非常重要。

它證明 V2 不是：

> 換名字的 Greedy。

---

## Test 5：Target 模式與 Expected 可以選不同牌

建立 fixture：

```text
A：
平均 1900
達到 2000 = 35%

B：
平均 1800
達到 2000 = 55%
```

target = 2000。

要求：

Expected：

```text
A
```

Target：

```text
B
```

---

## Test 6：Stable 使用 CVaR，不只是 P10

建立 weighted distributions：

```text
A：
P10 = 1000
CVaR10 = 700

B：
P10 = 990
CVaR10 = 920
```

要求 stable：

```text
B
```

證明排序主要依 CVaR10。

---

## Test 7：CVaR Weighted Bucket 正確

Distribution：

```text
score 500  weight 0.05
score 900  weight 0.10
score 1500 weight 0.85
```

CVaR10：

最差 10%：

```text
5% × 500
+
5% × 900
```

所以：

```text
CVaR10 = 700
```

要求結果在浮點 tolerance 內等於 700。

---

## Test 8：同 Objective 貫穿 Round 5

建立 Round 4 fixture。

未來三張牌中：

```text
A：
EV 高

B：
target probability 高

C：
CVaR 高
```

要求：

Expected planner → A

Target planner → B

Stable planner → C

不可三個模式全部使用 target comparator。

---

## Test 9：World 規則 Regression

World 只能複製：

```text
successful
+
not removed
+
score card
```

最高 base score × 2。

不得包含：

* multiplier card
* special card
* failed card
* removed card

---

## Test 10：Sun Regression

目前規則：

```text
Sun success 時
Sun 自己計入 successful-card count
```

V2 不得改動。

建立既有 fixture 保護。

---

## Test 11：Star Removal 進入 Distribution

Star 成功後，若有：

```text
3 個合法 removal target
```

在目前等權假設下：

每個 target：

```text
1/3
```

必須進入 weighted distribution。

不能只挑一個 target 模擬。

---

## Test 12：Tower Branch

Tower 成功：

```text
+200% 0.5
+25%  0.5
```

Exact / simulation transition 都必須符合。

---

## Test 13：失敗牌規則

failure 且未 removed：

```text
+20 SUM
```

但：

```text
不計 color
不觸發 card effect
```

V2 Planner 不得因 recursion 改變此規則。

---

## Test 14：Removed Card

removed：

```text
不加失敗 20
不加成功效果
不計 color
不提供 Moon failure count
不提供 World source
```

---

## Test 15：CRN

使用 debug hook 或 deterministic RNG spy。

同一 scenario：

```text
A root candidate
B root candidate
C root candidate
```

必須在相同：

```text
round/event/slot
```

取得同一 random uniform。

例如：

```ts
expect(
  random01({
    seed,
    scenario: 10,
    round: 3,
    event: "future-color",
    slot: 1
  })
).toBe(
  sameCoordinateFromOtherCandidate
);
```

---

## Test 16：增加 scenarioCount 不改 deterministic architecture

例如：

```text
5000
10000
20000
```

三者都必須：

* 正常完成
* weight normalized
* 無 NaN
* 無 Infinity
* probability ∈ [0,1]

不要求排名必定完全一樣。

---

## Test 17：Distribution Weight

任何 exact distribution：

```ts
Math.abs(totalWeight - 1) < tolerance
```

Sampled distribution 最終 normalize 後同樣成立。

---

## Test 18：Three Current Candidates Required

仍維持目前 UI/domain constraint：

```text
三個候選
不同 card id
本局未使用
```

不因 V2 Planner 放寬。

---

## Test 19：Real Game Record Isolation

執行：

```ts
recommendCandidatesV2(...)
```

不得建立：

```text
RealGameRecord
```

不得修改：

```text
real game history
```

只有玩家按：

```text
紀錄本局
```

才建立正式紀錄。

---

## Test 20：Performance Smoke Test

建立固定 mid-game fixture：

```text
2/5 selections completed
3 current candidates
10,000 scenarios
```

要求：

* Worker 成功完成
* UI thread 不直接執行 planner
* 沒有 stack overflow
* 沒有 exponential memory growth
* diagnostics.durationMs 有值

不要設定過度嚴格、與硬體綁死的 CI 毫秒上限。

可另外記錄 benchmark baseline。

---

# Part H — 建議新增 Regression Fixture

新增：

```text
tests/fixtures/
  delayed-blue-combo.ts
  delayed-purple-combo.ts
  target-vs-expected.ts
  stable-cvar.ts
  round5-exact.ts
```

尤其需要：

## delayed-blue-combo

故意設計：

```text
Greedy 選 A

但 A：
只提高當下 SUM

B：
讓未來更容易達到 3 / 4 Blue threshold

完整最終 EV：
B > A
```

V2 必須選 B。

這會成為 V2 最重要的演算法驗收案例。

---

# Part I — 完成定義 Definition of Done

此 Ticket 只有在以下全部成立時才算完成：

```text
[ ] Round 1–4 不再使用 immediate-score greedy
[ ] Future decision 使用 multi-step lookahead
[ ] Target objective 貫穿全部回合
[ ] Expected objective 貫穿全部回合
[ ] Stable objective 貫穿全部回合
[ ] Stable 改為 CVaR10 主排序
[ ] Round 5 exact solver 保留
[ ] Common Random Numbers 完成
[ ] 相同 seed 完全可重現
[ ] V1 existing scoring regression 全數通過
[ ] V2 delayed reward fixture 通過
[ ] Simulation 不污染真實紀錄
[ ] Worker 架構保留
[ ] npm test 通過
[ ] npm run typecheck 通過
[ ] npm run build 通過
```

---

# Part J — 暫時不要做的 V3

這個 Ticket 不處理：

```text
真實類別出現率重新估計
真實顏色機率重新估計
Bayesian calibration
Jev 自動選策略
尤里亞祝福公式
自動學習 card probability
強化學習 RL
MCTS
Neural Network
```

原因：

V2 先解決的是：

> 「在目前既定遊戲模型下，選牌策略是否足夠接近全局最佳。」

等累積真實完整牌局後，再進入：

```text
Algorithm V3
=
Empirical Calibration
+
Model Validation
```

而不是現在就增加更多 AI。
