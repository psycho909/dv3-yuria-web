# 2026-09-30 推薦研究交接

Repository：`D:\Codex\dv3\_publish`；工作專案 `B_yuria-web-spec`；分支 main；已提交來源 `e94545ac73f10506d1fb00e56828b3d3e26fccaa`。

## 完成结論

正式引擎維持 `b-deterministic-2026-09-29-exact-final-step`（改良 V1）。研究用逐卡出牌模型能改善候選集合機率的吻合，但完整五回合測試未證明改善分數／2400 達標率，因此沒有上線。

使用者目前主要目標為 **2400 分**。這是研究主門檻；正式畫面預設目標未於此次修改。

## 證據入口

1. [140 場真實紀錄審查](B_yuria-web-spec/reports/REAL-GAMES-AUDIT-2026-09-30.md)：140 筆有效，133 有實際分數；紅色可達集合及四場範圍異常仍待核對，沒有第 50 場截圖。
2. [候選出牌模型](B_yuria-web-spec/reports/OFFER-MODEL-BENCHMARK-2026-09-30.md)：84／28／28 時間切分，驗證選出逐卡固定權重；歷史資料已被審查，不是全新前瞻測試。
3. [2400 主目標重播](B_yuria-web-spec/reports/OFFER-OBJECTIVES-2400-2026-09-30.md)：28 場歷史前綴的條件決策分析，不能相加當完整牌局。
4. [完整五回合對照](B_yuria-web-spec/reports/FULL-GAMES-2400-2026-09-30.md)：800 場合成主測試＋160 場相同種子高預算重跑；沒有新增真實遊玩場數。
5. `B_yuria-web-spec/scripts/` 中 audit／benchmark／replay／compare／summarize 腳本及 `reports/` 的 JSON：重現指令在各報告；13 項研究測試、31 項既有測試與型別檢查通過。

## 工作樹與接手限制

研究腳本、報告及本交接文件隨本次收尾提交納入 Git；收尾提交以 `git log -1 -- HANDOFF-2026-09-30-RESEARCH.md` 為準。正式 main.ts／worker／domain.ts 未修改。接手先同步 main 並看 `git status --short`；研究成果不是正式引擎升級。

原始真實資料 `C:\Users\chingchen\Downloads\yuria-real-games-2026-09-30.json` 不在 Git 中；SHA256 `34149a07bfdd9d33a2a6534330f3beca9bcbf79afc3ba9c45a492e48a056523f`。跨電腦要重新取得相同匯出檔才能重跑真實資料審查；完整合成牌局測試不需要此檔。

不要以 LLM／Jev 替代確定性計分／機率。不得将推送視為部署完成；此次收尾只保存研究證據，未手動部署，也沒有宣稱真實分數改善。Git 連動的平台可能自動建置，但正式引擎程式碼不變。沒有新增雲端資料或付費模型呼叫。

## 後續取捨

此次完整對照任务已完成。新增真實 2400 局時，優先保存結算截圖與特殊卡狀態，再驗證出牌權重與世界／月亮、紅色規則；不要僅因更多研究模擬就直接切換正式算法。若日後修改計分或策略，重新在隔離研究測試與真實證據中驗證。
