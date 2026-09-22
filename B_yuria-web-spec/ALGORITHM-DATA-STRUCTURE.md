# ALGORITHM-DATA-STRUCTURE.md

## 1. Domain types

```ts
type CardCategory = "score" | "multiplier" | "special";
type CardColor = "blue" | "purple" | "red";

type CardId =
  | "fool" | "magician" | "high_priestess" | "empress" | "emperor"
  | "hierophant" | "lovers" | "chariot" | "hermit" | "hanged_man" | "devil"
  | "strength" | "wheel_of_fortune" | "justice" | "death" | "temperance" | "judgement"
  | "tower" | "star" | "moon" | "sun" | "world";

interface CardDefinition {
  id: CardId;
  category: CardCategory;
  activationProbability: number;
  scoreValue?: number;
  failedScoreBonus?: number;
  multiplierValue?: number;
  fallbackMultiplierValue?: number;
  specialEffect?: SpecialEffect;
}

interface OfferedCard {
  cardId: CardId;
  color: CardColor;
}

interface SelectedCard extends OfferedCard {
  activated: boolean;
  removed?: boolean;
  towerProc?: boolean;
}

interface GameState {
  turn: 1 | 2 | 3 | 4 | 5;
  selected: SelectedCard[];
}
```

## 2. Rule configuration

所有未完全驗證的規則都放設定，不散落在 if/else：

```ts
interface RuleConfig {
  failureScore: 20;
  sunCountsSelf: boolean;
  redRollMode: "integerPercent" | "continuous" | "empirical";
  blessingMode: "disabled" | "empirical";
  withinCategoryWeightMode: "uniform" | "empirical";
  futureColorModel: "independentUniform" | "oneEach";
  starRemovalPolicy: "uniformPresent" | "uniformActive";
}
```

正式版要把 `ruleVersion` 一起保存到每一局紀錄，避免改公式後舊資料失去可追溯性。

## 3. Score calculation

```ts
function calculateScore(
  selected: SelectedCard[],
  rules: RuleConfig,
  rng: Rng
): ScoreBreakdown
```

輸出：

```ts
interface ScoreBreakdown {
  sum: number;
  multiplier: number;
  redBonus: number;
  finalScore: number;
  failedCount: number;
  activeColorCounts: {
    blue: number;
    purple: number;
    red: number;
  };
}
```

計算順序必須固定：

```text
1. 移除 removed card
2. 區分 active / failed
3. SUM
4. MULT
5. Red bonus
6. floor
7. Blessing（未驗證前 disabled）
```

## 4. Candidate simulation

```ts
interface SimulationConfig {
  simulations: number;
  seed: number;
  targetThresholds: number[]; // [1400, 2000, 2700]
}

interface CandidateDistribution {
  card: OfferedCard;
  mean: number;
  stdDev: number;
  p10: number;
  p50: number;
  p90: number;
  thresholdRates: Record<number, number>;
}
```

核心：

```ts
for candidate in currentOffer:
  repeat N times:
    state1 = resolve(candidate activation/special RNG)
    stateFinal = rolloutFutureTurns(state1)
    score = calculateScore(stateFinal)
    collect(score)
```

## 5. Future offer generator

```ts
function generateOffer(
  state: GameState,
  turn: number,
  rng: Rng,
  rules: RuleConfig
): [OfferedCard, OfferedCard, OfferedCard]
```

目前 A 版同步的假設：

```text
顏色：每個未來候選位置獨立從 Blue / Purple / Red 等機率抽取；可出現同色
卡種：依遊戲公布類別權重抽取
同類別卡：剩餘卡片等權
已選過卡：排除
同一 offer：禁止卡片 identity 重複
```

未來收集實測資料後，將同類別等權替換為 empirical distribution。

## 6. Decision policy

### V1 — Monte Carlo rollout

未來 offer 中用快速單步 expected value 做 rollout policy。

優點：
- 實作快
- 10k 次模擬可在前端運算
- 容易回歸測試

限制：
- 不保證全局最佳策略

### V2 — Expectimax

狀態價值：

```text
V(state) = E_offer [ max_action Q(state, action) ]
```

```text
Q(state, action)
= Σ outcome P(outcome | action) × V(nextState)
```

用 memoization 對 canonical state hash 快取。

### V3 — MCTS / sampled Expectimax

當 Future-offer distribution 已透過實測確認後，再比較：
- Monte Carlo rollout
- sampled Expectimax
- MCTS

以離線 benchmark 的 regret、計算時間、手機耗電決定正式策略。

## 7. Objective

```ts
type Objective =
  | { kind: "expected_score" }
  | { kind: "threshold_probability"; threshold: 1400 | 2000 | 2700 }
  | { kind: "stability" };
```

排序：

```ts
expected_score:
  desc(mean)

threshold_probability:
  desc(P(score >= threshold)), desc(mean)

stability:
  desc(p10), desc(mean), asc(stdDev)
```

第 5 回合且 `redRollMode = "integerPercent"` 時，使用 activation、Tower 分支、Star 移除目標與所有紅色整數百分比的完整加權分布；因此 `calculationMethod = "exact"`，`simulations = 0`。其他回合仍使用 seeded Monte Carlo 與單步未來牌策略。

## 8. Jev integration boundary

Jev 不接收「幫我算哪張牌最高」這種數學任務。

只允許：

```text
state:
  userGoal: "我想保守一點，但最好至少 2000 分"

Choice:
  expected_score
  threshold_probability
  stability
```

回傳 typed objective 後，由 deterministic simulator 計算。

如果 Jev API 不可用，UI 仍可正常使用三個手動模式。

## 9. Anonymous observed-game record

Phase 2：

```ts
interface ObservedGameRecord {
  id: string;
  createdAt: string;
  gameVersion: string;
  ruleVersion: string;
  selections: Array<{
    turn: number;
    offered?: OfferedCard[];
    chosen: OfferedCard;
    activated: boolean;
    removedCardId?: CardId;
    towerProc?: boolean;
  }>;
  actualFinalScore: number;
}
```

用途：
- 驗證太陽自計數
- 驗證紅色 roll 分布
- 驗證類別內 card weight
- 驗證祝福公式

不要保存玩家帳號、角色名稱等不必要個資。

## 10. Web Worker contract

主執行緒：

```ts
worker.postMessage({
  type: "RECOMMEND",
  requestId,
  state,
  candidates,
  objective,
  simulationConfig,
  ruleConfig
});
```

Worker：

```ts
postMessage({
  type: "RECOMMEND_RESULT",
  requestId,
  result
});
```

新 request 到達時，舊 request 可標記取消，避免手機連續輸入時堆積運算。
