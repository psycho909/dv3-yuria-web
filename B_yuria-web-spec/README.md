# B — 尤里亞網頁版規格包

包含：

- `PROJECT.md`：定位、技術、分期、可信度原則
- `SPEC.md`：完整功能與驗收規格
- `ALGORITHM-DATA-STRUCTURE.md`：資料結構與推薦演算法
- `RECOMMENDATION-ALGORITHM.md`：目前已實作的推薦、計分與模擬規則；日後調整以此核對現況
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
- 真實五回合牌局：完成後按「紀錄本局」才存入 IndexedDB；遊戲實得分數可留空，並與模型估算分開顯示
- 本機牌局 JSON 匯出／匯入、修訂紀錄及只讀統計；GitHub 登入與 Supabase 跨裝置同步程式已接入

在此目錄執行：

```bash
npm install
npm run dev
```

目前紅色預設為 A 專案的整數百分比模型；1648 實測所提示的連續紅色／中間取整假設會在資料可信度區塊明示。祝福尚未建模。

新牌局先在本機操作。完成五回合後可留白或填入遊戲實得分數，再按「紀錄本局」；完成不會自動入庫。瀏覽器清除網站資料會移除 IndexedDB 紀錄，請用「匯出 JSON 備份」保存。舊五局總分與模擬局不會自動灌入此庫。資料結構、驗收及校準門檻見根目錄 `REAL_GAME_DATA_PLAN.md`。

雲端專案為獨立的 Supabase `dv3-yuria`（ref `kihgibfacsvbmvvmohuc`），RLS 限定帳號只能讀寫自己的 `real_games`。前端只使用公開 publishable key。GitHub OAuth 已在正式站完成登入、登出、重新登入與空資料下載測試；完整牌局上傳、非空跨裝置下載、跨帳號隔離仍待驗證。**Secret 只在控制台輸入，不要放進 Git 或聊天。** 本機預覽若要測登入，另外將 `http://127.0.0.1:4174/` 加入允許的 Redirect URLs。詳細測試證據見根目錄 `HANDOFF-2026-09-22.md`。
