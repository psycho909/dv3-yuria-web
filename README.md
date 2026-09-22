# DV3 Yuria

這個 repository 同時保存尤里亞占卜計算器的 deterministic domain prototype 與瀏覽器 MVP。

## Projects

- `A_yuria-codex-jev-prototype/` — A 版規則、分數計算、Monte Carlo／終局精確分布、Jev 語意目標路由與回歸證據。
- `B_yuria-web-spec/` — B 版 Vite 網頁介面，使用 A 版目前 22 張牌資料與規則，在本機計算達標率、預期分數、分位數與 fallback。

數學結果由 deterministic code 計算；Jev 不得產生或覆寫卡片機率、顏色效果、特殊卡效果或最終分數。`.env`、依賴與 build 產物不進版控。

## Quick start

```powershell
cd B_yuria-web-spec
npm install
npm run dev
```

開啟 Vite 顯示的本機網址即可使用。A 版驗證命令與規則限制請看其 `AGENTS.md`、`CODEX_TASK.md`、`docs/ALGORITHM.md`。

B 的 production 網址：[dv3-yuria-web.vercel.app](https://dv3-yuria-web.vercel.app/)。部署與接手狀態記錄在 `HANDOFF-2026-09-22.md`。
