# 尤里亞占卜計算器：UI B 階段工作交接

記錄日期：2026-09-29（Asia/Taipei）
專案：`B_yuria-web-spec/`
目前分支：`main`
目前狀態：**B 階段未提交、未部署**。

## 1. 已完成基線

- A 階段已提交並推送：`7fbb4c5 feat: put the recommendation first in the workbench`。
- A 已由 Vercel 自動部署；B 開工前正式站基線是 A 版。
- A 階段的行為包括：結論帶、候選主要指標依排序依據顯示、顏色按鈕收在「改色」、已確定小卡、更正浮層收合、底部次要資訊收合。
- B 尚未 commit；不要把目前 working tree 當成正式站版本。

## 2. B 階段已完成的程式工作

### B1／B2：樣式集中與牌圖取色

- 新增 `B_yuria-web-spec/src/app.css`，`main.ts` 目前只載入 `./app.css`。
- 已刪除舊的五份樣式檔：
  - `src/styles.css`
  - `src/knowledge.css`
  - `src/pending.css`
  - `src/usability.css`
  - `src/workbench.css`
- 新 token 來自遊戲素材的實際顏色：
  - 霧藍紙：`#EDF3F4`
  - 牌面白：`#FBFBF6`
  - 像素描邊墨色：`#282020`
  - 金框：`#F8C838`
  - 藍牌：`#186088`
  - 紫牌：`#800098`
  - 紅牌：`#C00800`
- 牌色只表示藍／紫／紅牌；主要操作使用墨色；金色只用於推薦，避免牌色和操作語意混淆。
- CSS 從 A 版約 57 KB 收斂為 app.css build 產物約 22.88 KB（未壓縮）。

### B3：像素字體管線

- `package.json` 新增精確版本 dev dependency：`fonteditor-core@2.6.3`。
- 新增 `scripts/build-pixel-font.mjs`：
  - 固定 Cubic 11 release `v1.500`。
  - 使用 Git blob SHA 驗證下載內容，避免來源漂移。
  - 從 `scripts/pixel-font-text.mjs` 產生字元子集。
  - 將字體識別名稱改為 `Yuria Pixel`，不改動原始版權／授權文字。
  - 輸出 `public/fonts/yuria-pixel.woff2`、字元清單與 `OFL.txt`。
- 新增 `scripts/pixel-font-text.mjs` 與型別宣告 `scripts/pixel-font-text.d.mts`。
- 新增 `tests/pixel-font.test.ts`，檢查：
  - 所有像素字字元都在字體清單。
  - 22 張牌名與顏色字都被列入。
  - woff2 不超過 60 KB 且附 OFL 1.1 授權檔。
- `npm run font` 已通過：124 個字元、`7,980 bytes`。
- `.gitignore` 已忽略 `.cache/`；下載的原始 Cubic 11 不提交，只提交改名後的 subset 與授權檔。

### B4：推薦牌像素視覺

- `@font-face` 載入 `Yuria Pixel`。
- 頁面標題、回合、分數、結論、推薦牌主要數字使用像素字。
- 字級遵守整數倍方向：一般像素文字 24px、候選一般主要數字 36px、推薦牌主要數字 48px。
- 推薦候選卡以階梯式 `box-shadow` 做「墨色外框＋金色內框」像素金框。
- 空槽使用霧藍棋盤牌背；推薦空槽使用淡金底；牌圖維持 `image-rendering: pixelated`。

## 3. 已完成的局部驗證

- `npm run font`：通過。
- `npm run build`：通過。
  - Vite 產物當時為 CSS 約 22.88 KB、JS 約 298.29 KB。
- `npx vitest run tests/pixel-font.test.ts`：3 passed。
- 臨時 DOM runner 已確認：
  - `document.fonts.check('24px "Yuria Pixel"', '尤里亞')` 為 true。
  - 390、768、1024、1440 寬度的 `scrollWidth` 等於 viewport 寬度。
  - 沒有 page error。
- 後續不需要再產生截圖；使用者已指定避免多圖請求造成「image dimensions exceed max allowed size」錯誤。

## 4. 尚未完成

1. 跑完整 `npm test`，確認 B 的 CSS／字體導入沒有影響既有功能測試。
2. 跑完整瀏覽器驗收：
   - `browser-acceptance.cjs`
   - `history-special-edit.cjs`
   - `keyboard-flow.cjs`
   - `real-game-flow.cjs`
   - 驗證只用 DOM、computed style、font loading、overflow 與 page error，不截圖。
3. 做 125%／150% 縮放檢查：以 CSS zoom 或 viewport／computed layout 數值驗證，不截圖、不註冊 image artifact。
4. 做自動對比檢查：文字至少 4.5:1、焦點／控制邊界至少 3:1；不要只依賴視覺截圖。
5. 更新 `DESIGN.md` §25：補入 B 的 tokens、字體來源與授權、B 驗收結果；說明舊 §6 的色彩／字體規則已被 B 取代。
6. 跑 `git diff --check`，清理暫存檔與 `.cache/`（`.cache/` 已被 gitignore，不會提交）。
7. 使用者確認後，才 commit、push、部署 B；目前沒有 B commit。

## 5. 目前 working tree

本次 B 變更包含：

- `B_yuria-web-spec/.gitignore`
- `B_yuria-web-spec/package.json`
- `B_yuria-web-spec/package-lock.json`
- `B_yuria-web-spec/src/main.ts`
- `B_yuria-web-spec/src/app.css`（新增）
- `B_yuria-web-spec/src/styles.css`（刪除）
- `B_yuria-web-spec/src/knowledge.css`（刪除）
- `B_yuria-web-spec/src/pending.css`（刪除）
- `B_yuria-web-spec/src/usability.css`（刪除）
- `B_yuria-web-spec/src/workbench.css`（刪除）
- `B_yuria-web-spec/scripts/build-pixel-font.mjs`（新增）
- `B_yuria-web-spec/scripts/pixel-font-text.mjs`（新增）
- `B_yuria-web-spec/scripts/pixel-font-text.d.mts`（新增）
- `B_yuria-web-spec/public/fonts/yuria-pixel.woff2`（新增）
- `B_yuria-web-spec/public/fonts/yuria-pixel.chars.txt`（新增）
- `B_yuria-web-spec/public/fonts/OFL.txt`（新增）
- `B_yuria-web-spec/tests/pixel-font.test.ts`（新增）

## 6. 已知事項

- `npm audit` 顯示 2 個 moderate advisory，來源是既有 Vitest 依賴的 `@vitest/mocker`；自動修復會升級到 Vitest 5，屬 breaking change。本階段沒有擅自升級測試框架，待另行決定。
- 像素字體的來源是 GitHub `ACh-K/Cubic-11` release v1.500，授權為 SIL OFL 1.1；原始授權檔已隨 subset 提交。
- B 仍未驗證真人 5 秒找到推薦、真人觸控與螢幕閱讀器；這些不能用 DOM 自動檢查宣稱完成。

## 7. 恢復工作順序

```cmd
npm --prefix "d:\Codex\dv3\_publish\B_yuria-web-spec" run font
npm --prefix "d:\Codex\dv3\_publish\B_yuria-web-spec" run typecheck
npm --prefix "d:\Codex\dv3\_publish\B_yuria-web-spec" test
npm --prefix "d:\Codex\dv3\_publish\B_yuria-web-spec" run build
```

接著用不產生圖片的瀏覽器 DOM 驗證完成第 4 點，再更新 `DESIGN.md`，最後回報使用者是否要 commit／push／部署。

## 8. 後續驗證更新（2026-09-29）

- `npm run font`：通過，124 字元、7,980 bytes。
- `npm run typecheck`：通過。
- `npm test`：12 個測試檔，62 passed、10 skipped；包含 pixel font、domain、recommendation、performance 與 V2/V2.1 既有測試。
- `npm run build`：通過；CSS 22.88 KB、JS 298.29 KB（Vite 未壓縮產物）。
- DOM-only Playwright 驗證：全部通過，沒有使用 `page.screenshot()`：
  - `Yuria Pixel` 載入成功。
  - 390／768／1024／1440 寬度沒有水平溢位。
  - 推薦牌為單一推薦、桌機主要數字 48px、使用 Yuria Pixel、像素金框存在。
  - 「改色」收合／展開正確。
  - 標題、結論、分數、主要按鈕、輔助文字對比皆 ≥ 4.5:1；實測比值約 5.81–15.35。
  - 等效 125%（819 CSS px）與 150%（682 CSS px）版面無溢位，記錄按鈕仍在內容範圍內。
  - 390px 選牌 dialog 在 viewport 內，沒有 page error。
- 不含 screenshot 的瀏覽器流程：`keyboard-flow.cjs` 通過；`history-special-edit.cjs` 通過。
- 依使用者要求，未執行會產生截圖的 `browser-acceptance.cjs` 與 `real-game-flow.cjs`；沒有新增或註冊任何圖片 artifact。截圖驗證屬未執行，不以 DOM 驗證冒充視覺人工驗收。

## 9. 最新狀態覆寫（以本節為準）

- B 的 `font`、`typecheck`、完整 `test`、`build` 已完成並通過；完整測試結果為 12 檔、62 passed、10 skipped。
- B 的 DOM-only 驗證已完成並通過：字體、tokens、推薦 48px／金框、改色、390／768／1024／1440 溢位、等效 125%／150% viewport、對比與 mobile dialog。
- `keyboard-flow.cjs`、`history-special-edit.cjs` 已通過；不含 screenshot。
- 截圖型 `browser-acceptance.cjs`、`real-game-flow.cjs` 依使用者要求未執行，故不可宣稱完整視覺截圖驗收通過。
- B 尚未 commit、push、deploy；`DESIGN.md` B 段落已補上。
- 後續若恢復工作，優先做真人／觸控／螢幕閱讀器驗證，之後再由使用者決定是否提交 B。

## 10. 複驗與修正（2026-09-29，覆寫 §9）

- 對照 A 版 DOM 稽核後修正了 3 個 B 回歸，改動只在 `src/app.css`：更正浮層「已被移除」折行、主要數字從中間斷行、1024×768 首屏超出。細節與驗收數字見 `DESIGN.md` B 段落。
- 修正後的結果：font、typecheck、全套 Vitest（64 passed、8 skipped）、build 通過；`browser-acceptance.cjs`、`real-game-flow.cjs`、`keyboard-flow.cjs`、`history-special-edit.cjs` 也都通過（用 no-op shim 攔截 screenshot，沒有產生任何影像）。
- 仍未做：真人、觸控、螢幕閱讀器驗證。
- 使用者已授權 commit、push、部署：B 為 `3a28090`，已推送到 `main` 並由 Vercel 部署。正式站煙霧測試（字體、48px、單行數字、1024×768 首屏、keyboard／history 流程）通過。

## 11. 頁面色系切換（2026-09-29）

- 新增霧藍（預設）、琥珀、夜紫三種色系，切換鈕放在標題右側；tokens、驗收數字與設計理由見 `DESIGN.md`「頁面色系切換」一節。
- 改動檔案：`src/app.css`（色系 tokens，寫死的顏色改成 tokens）、`src/main.ts`（切換鈕、記憶、theme-color）、`index.html`（首次繪製前套用色系，並修正殘留的 theme-color）。
- 三種色系的 DOM 稽核與既有瀏覽器流程都通過。使用者已授權 commit、push、部署：以包含本段的 commit 推送到 `main`，由 Vercel 部署；SHA 以 `git log` 為準。

## 12. UI 微調（2026-09-29）

- 修正 `.more-panel h3` 貼邊（改用 `margin-block`，不再用簡寫蓋掉父層的左右邊距）。
- 預設色系改為琥珀；霧藍、夜紫仍可切換。
- 模擬次數預設 10,000 → 20,000；目標分數預設維持 3000。
- 改動檔案：`src/app.css`、`src/main.ts`、`index.html`。typecheck、build、全套 Vitest（64 passed、8 skipped）與四個既有瀏覽器流程都通過；commit、push、部署待使用者授權。
