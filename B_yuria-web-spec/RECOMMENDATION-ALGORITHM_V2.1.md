# 尤里亞推薦演算法 V2.1 — 直接改良任務

## 目標

直接改良目前 `V2 bounded two-step`，目標是提升 **Expected Score 平均終局分數**。

目前正式 production 仍維持 V1。

V2.1 是研究版，不得直接取代 V1。

這次不要再做大量 diagnostic benchmark，也不要重新討論 V1/V2 架構。

核心修改：

```text
V2 current
=
1 層 lookahead
+
pilotSamples = 4
+
completeGreedy()
+
immediatePolicy()
```

修改成：

```text
V2.1
=
較可靠的 future action evaluation
+
bounded multi-step lookahead
+
改良 cutoff evaluator
+
Round 5 exact solver
```

---

# 1. 開始前

閱讀：

```text
AGENTS.md
PROJECT.md
SPEC.md

src/domain.ts
src/recommendation-v2.ts
src/recommend.worker.ts
src/main.ts

tests/
目前推薦演算法說明
```

以現有程式碼為準。

不要重寫整個推薦系統。

---

# 2. Production 不變

目前正式推薦：

```text
V1
```

必須保持。

不可：

```text
把 V2.1 設為 production default
修改 UI 預設推薦版本
刪除 V1
```

V2.1 只提供：

```text
benchmark
dev
experimental
```

使用。

---

# 3. V2.1 Expected Objective

這個版本只優化：

```text
Expected Final Score
```

所有 future decision 必須使用：

```text
expectedScore 最大化
```

不得在中途改用：

```text
達標率
P10
CVaR
immediate score
```

除非只是 deterministic tie-break。

排序：

```text
1. expectedScore
2. targetProbability
3. CVaR10
4. cardId
```

但主要 objective 永遠是：

```text
expectedScore
```

---

# 4. 修改一：提高 Future Action Evaluation 品質

目前：

```text
pilotSamples = 4
```

太低。

V2.1 預設改為：

```text
pilotSamples = 32
```

Config 可調：

```ts
interface V21Config {
  scenarioCount: number;
  pilotSamples: number;
  searchDepth: number;
  seed: number;
}
```

預設：

```text
pilotSamples = 32
searchDepth = 2
```

允許：

```text
pilotSamples 16 / 32 / 64
```

但 production 不使用。

不要硬編死在函式內。

---

# 5. 修改二：移除「一層後立刻 completeGreedy」

目前：

```text
candidate
↓
future offer
↓
chooseFuture()
↓
completeGreedy()
```

V2.1 改成：

```text
candidate
↓
future offer
↓
evaluate future action
↓
如果 searchDepth 還沒結束
    繼續 lookahead
否則
    使用 V2.1 cutoff evaluator
↓
Round 5
    exact solver
```

建立類似：

```ts
evaluateState(
  state,
  depthRemaining,
  context
)
```

以及：

```ts
evaluateAction(
  state,
  candidate,
  depthRemaining,
  context
)
```

---

# 6. Search Depth

V2.1 預設：

```text
searchDepth = 2
```

意思：

```text
目前 action
+
最多再真正評估 2 個 future decision nodes
```

不要直接 Full Expectimax。

目的：

```text
比目前 V2 多看實際 future decisions
但避免計算量爆炸
```

若剩餘回合小於 depth：

直接搜尋至 Round 5。

---

# 7. Round 5 必須保持 Exact

沿用目前：

```text
exactFinalDistribution()
```

Round 5：

```text
不 Monte Carlo
不 pilot
不 greedy
```

必須 exact enumerate：

```text
success/failure
Tower
Star
World
Red integer branches
其他現有 stochastic branches
```

不要修改既有規則。

---

# 8. 修改三：建立 V2.1 Cutoff Evaluator

如果：

```text
depthRemaining === 0
```

但尚未 Round 5，

禁止直接使用目前：

```text
immediate()
```

或只用：

```text
current score
```

建立：

```ts
estimateStateValueV21(state)
```

它必須估計：

```text
目前已取得的確定價值
+
顏色進度價值
+
倍率進度
+
剩餘回合潛力
+
特殊卡 synergy potential
```

但不要使用 LLM / Jev。

---

# 9. Cutoff Evaluator — 基本結構

建議：

```ts
stateValue =
  baseExpectedScore
  + colorPotential
  + multiplierPotential
  + specialPotential
```

所有數值必須：

```text
由 deterministic code 計算
```

---

# 10. Base Expected Score

先計算：

```text
若目前牌局立即終止
目前 state 的 expected/final score
```

作為 baseline。

例如：

```ts
const base = evaluateCurrentStateScore(state);
```

不要直接把這個當全部 value。

---

# 11. Color Potential

顏色具有非線性門檻：

```text
2
3
4
5
```

所以 cutoff evaluator 要能辨識：

```text
1 blue
與
2 blue
與
3 blue
```

不是線性等價。

例如可估：

```text
距離下一個 color threshold 越近
→ potential 越高
```

藍：

```text
+40
+80
+160
+250
```

紫：

```text
+40%
+80%
+150%
+240%
```

紅：

```text
10~20%
20~30%
40~60%
60~90%
```

不要任意發明巨大的 magic constant。

優先從：

```text
下一級 threshold 的實際 expected marginal value
```

估算。

---

# 12. Remaining Round Potential

例如目前：

```text
3 / 5 cards selected
```

還有 2 回合。

與：

```text
4 / 5
```

只剩 1 回合。

同一個：

```text
距離 4-blue 差一張
```

價值不同。

Cutoff evaluator 必須知道：

```text
remainingSelections
```

---

# 13. Multiplier Potential

成功倍率牌對已有 SUM 的價值會增加。

例如：

```text
SUM 很高
+
目前倍率不高
```

未來倍率卡的 expected value 比：

```text
SUM 很低
```

更高。

因此 multiplier potential 不應只看：

```text
目前倍率卡張數
```

而應至少考慮：

```text
current SUM
current MULT
remaining rounds
```

---

# 14. Special Card Potential

不需要建立超複雜 heuristic。

只處理明顯關係：

```text
World：
已有成功高分 score card
→ World future potential 增加

Moon：
已有 failure cards
→ Moon potential 增加

Sun：
已有多張 successful non-removed cards
→ Sun potential 增加
```

Tower / Star：

可使用它們目前已知 expected contribution 的簡化估計。

不要發明新遊戲規則。

---

# 15. Future Candidate Sampling

沿用現有模型：

```text
Round 1–4
10 : 10 : 5

Round 5
5 : 10 : 20
```

顏色：

```text
1/3 blue
1/3 purple
1/3 red
```

同類別剩餘牌：

```text
等權
```

不要修改。

---

# 16. Common Random Numbers

如果目前 V2 已有 deterministic seeded scenario：

沿用。

V2.1 root candidate 比較必須盡量使用：

```text
同 scenario
同 future random coordinates
```

不可重新退回：

```text
Candidate A 一條 RNG
Candidate B 另一條完全獨立 RNG
```

---

# 17. Scenario Budget

這版不要追求：

```text
1024
2048
```

正式 V2.1 預設 benchmark：

```text
scenarioCount = 256
```

因為先前已證明：

```text
大幅增加 scenario
→ 成本爆炸
```

V2.1 的目標是：

> 在較合理 scenarioCount 下，
> 用更好的 decision quality 提升平均分。

---

# 18. 計算量控制

避免：

```text
256
× 32 pilot
× 3 actions
× depth
× 3 actions
...
```

完全暴力展開。

允許：

```text
shared future scenarios
memoization
batched pilot evaluation
pre-generated random paths
distribution reuse
Round 5 cache
```

但不可偷偷變回 immediate greedy。

---

# 19. Memoization

優先 cache：

```text
Round 5 exact distribution
```

以及相同：

```text
state
depth
scenario coordinate
```

的 evaluation。

Cache key 必須包含：

```text
selected cards
status
removed
colors
round
depth
rulesVersion
catalogVersion
```

不可因錯誤 cache 污染 branch。

---

# 20. 資料結構

建議新增：

```ts
interface V21Evaluation {
  expectedScore: number;

  targetProbability: number;

  p10: number;
  p50: number;
  p90: number;

  cvar10: number;

  minScore: number;
  maxScore: number;

  distribution?: ScoreDistribution;
}
```

Planner：

```ts
interface V21PlannerContext {
  config: V21Config;
  rules: GameRules;
  catalog: CardCatalog;
}
```

---

# 21. 不要讓 Cutoff Heuristic 污染 Final Metrics

注意：

```text
cutoff evaluator
```

只用來：

```text
在 bounded search 內選 future action
```

最終 root candidate 的：

```text
expectedScore
targetProbability
P10
CVaR
```

仍必須來自實際 simulation terminal outcomes。

不能直接把 heuristic value 當最終玩家看到的分數。

---

# 22. 最重要的 Correctness Fixture

保留：

```text
delayed-blue
```

新增：

```text
delayed-purple
```

以及：

```text
special-world
```

---

# 23. Delayed Blue

建立人工 case：

```text
A
當下 immediate EV 高

B
當下稍低
但能進入下一個 blue threshold
最終 expected score > A
```

要求：

```text
V1 greedy → A
V2.1 → B
```

---

# 24. Delayed Purple

同樣：

```text
A
短期好

B
讓未來紫色倍率 threshold 更有價值
```

要求：

```text
V2.1 能選 B
```

---

# 25. World Synergy

例如：

```text
目前已有成功高分 Score card
```

另一個選擇：

```text
保留 / 建立有利 World 的 state
```

要求：

```text
V2.1 lookahead 能辨識 World future value
```

不用要求 V1 一定錯。

---

# 26. Regression

不得改壞：

```text
Tower
Star
Moon
Sun
World
failure +20
removed rules
color rules
red rules
Round 5 exact
```

既有測試全部保留。

---

# 27. 最小 Benchmark

修改完成後不要再做大規模矩陣。

只做：

```text
V1 Expected
vs
V2 current
vs
V2.1
```

固定：

```text
scenarioCount = 256
pilotSamples = 32
Expected objective
固定 deterministic seeds
```

使用現有 benchmark corpus。

不要再測：

```text
S512
S1024
S2048
```

除非 V2.1 在 S256 已明顯改善。

---

# 28. V2.1 驗收標準

第一階段只要求：

```text
V2.1 mean > current V2 mean
```

並且：

```text
delayed-blue PASS
delayed-purple PASS
World interaction PASS
```

理想：

```text
V2.1 mean >= V1 mean
```

但如果沒有：

不要為了達標修改遊戲機率。

---

# 29. 效能驗收

記錄：

```text
V1 runtime
V2 runtime
V2.1 runtime
```

目標：

```text
V2.1 不得接近先前 S2048 的 300× 級別
```

希望控制：

```text
<= V1 20×
```

若超過：

回報瓶頸。

不要犧牲正確性硬壓。

---

# 30. 禁止事項

本 Ticket 禁止：

```text
改 V1 production
改卡牌成功率
改類別權重
改顏色機率
改特殊卡規則
增加 Jev
增加 LLM
RL
MCTS
Neural Network
Full Expectimax
大量 benchmark matrix
為了讓 V2.1 贏而調遊戲機率
```

---

# 31. 完成後執行

```text
npm test
npm run typecheck
npm run build
```

如果有 lint：

```text
npm run lint
```

全部需要通過。

---

# 32. 最終回報格式

```text
# V2.1 Implementation Result

## 修改內容

pilotSamples:
before:
after:

search:
before:
after:

cutoff evaluator:
before:
after:

## 新增檔案 / 修改檔案
...

## Correctness Fixtures

Delayed Blue:
PASS / FAIL

Delayed Purple:
PASS / FAIL

World Interaction:
PASS / FAIL

## Small Benchmark

V1:
Mean:
>=1500:
P10:
CVaR10:
Runtime:

V2 current:
Mean:
>=1500:
P10:
CVaR10:
Runtime:

V2.1:
Mean:
>=1500:
P10:
CVaR10:
Runtime:

## Tests

npm test:
npm run typecheck:
npm run build:

## 結論

V2.1 是否比 V2 改善：
...

是否已超過 V1：
...

是否適合 production：
否，除非另外取得明確 benchmark 證據。

## 尚未處理

future model calibration
Target objective
Stable objective
Full Expectimax
real-game probability calibration
```

---

# Definition of Done

```text
[ ] production V1 完全不變
[ ] V2.1 獨立存在
[ ] pilotSamples 預設提升到 32
[ ] 不再一層後直接 completeGreedy
[ ] searchDepth = 2
[ ] cutoff evaluator 不再只是 immediate score
[ ] color potential 有納入
[ ] remaining rounds 有納入
[ ] multiplier potential 有納入
[ ] basic special synergy 有納入
[ ] Round 5 exact 保留
[ ] delayed-blue PASS
[ ] delayed-purple PASS
[ ] World synergy PASS
[ ] V2.1 mean > 原 V2
[ ] npm test PASS
[ ] typecheck PASS
[ ] build PASS
```
