# B — 尤里亞網頁版規格包

包含：

- `PROJECT.md`：定位、技術、分期、可信度原則
- `SPEC.md`：完整功能與驗收規格
- `ALGORITHM-DATA-STRUCTURE.md`：資料結構與推薦演算法
- `WIREFRAME.md`：Mobile/Desktop Wireframe、Component Tree、RWD

建議開發順序：

```text
1. Domain card data + exact score calculator
2. Regression tests
3. Monte Carlo Web Worker（已完成）
4. Mobile input flow
5. Analytics / assumptions UI
```

核心原則：先把數學與規則驗證穩定，再加入 Jev 或其他 AI 層。

## 目前可執行 MVP

`src/domain.ts` 與 `src/main.ts` 已把 A 專案目前的 22 張牌資料、啟用率、失敗補償、藍／紫／紅顏色級距、特殊牌效果與推薦統計帶入瀏覽器版。數學在本機以 seeded deterministic engine 執行；Jev 不參與機率、分數或排序計算。

畫面包含：

- 本局 5 回合牌面與成功／失敗／移除狀態
- 3 張候選牌的達標率、預期分數、P10／P50／P90、分數範圍與點選獲得率
- 達標率與預期分數的雙重推薦；達標率全為 0 時改列預期分數最高選項
- 5 局實測與 30 局模型自我模擬統計、獎勵門檻、22 張牌目錄與公式限制

在此目錄執行：

```bash
npm install
npm run dev
```

目前紅色預設為 A 專案的整數百分比模型；1648 實測所提示的連續紅色／中間取整假設會在資料可信度區塊明示。祝福尚未建模。
