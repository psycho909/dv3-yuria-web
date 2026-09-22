# WIREFRAME.md — 尤里亞的占卜計算器

## 1. Mobile First

```text
┌──────────────────────────────┐
│ 尤里亞的占卜計算器      [?] │
│ 第 3 / 5 次                  │
├──────────────────────────────┤
│ 推薦目標                     │
│ [平均最高] [Lv.7達標] [穩定]│
├──────────────────────────────┤
│ 目前狀態                     │
│ 幸運分數區間  820 ~ 1,120    │
│ 🔵 1   🟣 1   🔴 0          │
│                              │
│ 已選                          │
│ ① 🔵戀人   ✓ 啟用           │
│ ② 🟣力量   ✓ 啟用           │
├──────────────────────────────┤
│ 下一組 3 張                  │
│                              │
│ ┌────────┐ ┌────────┐ ┌────┐│
│ │🔵 隱者 │ │🟣 正義 │ │🔴惡魔││
│ │60%     │ │80%     │ │50% ││
│ │        │ │        │ │    ││
│ │★推薦   │ │        │ │高波││
│ │Lv7 31% │ │Lv7 28% │ │25% ││
│ │EV 2180 │ │EV 2105 │ │2260││
│ └────────┘ └────────┘ └────┘│
├──────────────────────────────┤
│ 為什麼推薦？                 │
│ 藍色隱者若成功可湊成藍2張， │
│ 提高 SUM；本模式優先比較     │
│ Lv.7 達標率。                │
│                              │
│ [查看完整機率分布 ▾]         │
├──────────────────────────────┤
│ 規則可信度                   │
│ ✓ 核心公式已實測             │
│ △ 太陽自計數仍為假設         │
│ △ 祝福尚未建模               │
├──────────────────────────────┤
│ [重設]          [確認選這張] │ ← sticky
└──────────────────────────────┘
```

### 手機互動

- 點 3 張牌其中一張 → 顯示 active state，但尚未真正提交。
- 按「確認選這張」→ 將卡加入歷史。
- 下一步用二選一：`啟用成功 / 啟用失敗`。
- 特殊牌才展開必要補充，例如高塔是否 proc、星星移除哪張。

避免一次讓使用者填整張表單。

## 2. Desktop

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ 尤里亞的占卜計算器  第3/5次                   規則狀態  設定  說明      │
├───────────────────┬───────────────────────────────┬─────────────────────┤
│ 本局狀態          │ 下一組 3 張                   │ 分布 / 目標          │
│                   │                               │                     │
│ ① 🔵戀人 ✓       │ ┌────────┐ ┌────────┐ ┌────┐ │ Lv5  █████ 91%       │
│ ② 🟣力量 ✓       │ │🔵 隱者 │ │🟣 正義 │ │🔴惡魔│ │ Lv6  ████  63%       │
│                   │ │★推薦   │ │        │ │    │ │ Lv7  ██    31%       │
│ 顏色              │ │Lv7 31% │ │28%     │ │25% │ │                     │
│ 藍 1 紫 1 紅 0    │ │EV 2180 │ │2105    │ │2260│ │ P10  1,620           │
│                   │ └────────┘ └────────┘ └────┘ │ P50  2,110           │
│ 目標              │                               │ P90  2,860           │
│ ● Lv7達標         │ 推薦理由                      │                     │
│ ○ 平均最高        │ ...                           │ 規則可信度           │
│ ○ 穩定            │                               │ ✓ / △ / △           │
│                   │ [確認選擇]                    │                     │
├───────────────────┴───────────────────────────────┴─────────────────────┤
│ 卡片資料 / 規則 / 模擬設定 / 實測回報                                  │
└─────────────────────────────────────────────────────────────────────────┘
```

## 3. Component tree

```text
YuriaPage
├─ Header
├─ ObjectiveSegmentedControl
├─ GameWorkspace
│  ├─ HistoryPanel
│  │  ├─ TurnProgress
│  │  ├─ ColorCounter
│  │  └─ SelectedCardList
│  ├─ CandidatePanel
│  │  ├─ CandidateCard ×3
│  │  ├─ RecommendationReason
│  │  └─ ConfirmSelectionBar
│  └─ AnalyticsPanel
│     ├─ ThresholdProbabilityBars
│     ├─ PercentileSummary
│     ├─ DistributionChart
│     └─ RuleConfidencePanel
└─ ReferenceAccordion
   ├─ CardTable
   ├─ Rules
   └─ SimulationAssumptions
```

## 4. Candidate Card hierarchy

```text
[Color + Card name]
[activation probability]

[Rank badge]
[primary metric]
[mean score]

[risk tag]
[details]
```

使用者選擇 `Lv.7 達標` 時，primary metric 必須是 `Lv.7 xx%`，不要仍把平均分數做最大字。

## 5. Visual priority

層級：

```text
1. 推薦哪張
2. 達標率 / EV
3. 為什麼
4. 已選歷史
5. 完整分布
6. 規則文件
```

不要讓卡片百科資訊搶走主決策區。

## 6. 狀態

### calculating
候選牌上顯示小型 skeleton；不要把整頁 lock 住。

### assumption warning
只在有影響的牌出現時提升警示。例如候選含太陽時，Card 內顯示 `△ 規則尚未完全驗證`。

### invalid
同一卡片已選過時，直接禁止再選並說明「已選卡不會再次出現」。

## 7. Design tokens 建議

```text
radius-card: 16px
space-page-mobile: 16px
space-page-desktop: 24~32px
min-touch-target: 44px
max-content: 1280px
```

顏色 token 不直接寫死在元件：

```text
--card-blue
--card-purple
--card-red
--surface
--surface-raised
--text-primary
--text-secondary
--success
--warning
```

顏色卡同時顯示文字標籤，避免色覺差異造成辨識問題。
