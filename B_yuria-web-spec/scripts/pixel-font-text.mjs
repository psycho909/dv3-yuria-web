// Every string that app.css renders in the pixel font ("Yuria Pixel"). The subset is built from these
// characters only, and tests/pixel-font.test.ts fails if a listed character is missing from the font.
// When you add pixel-font text in main.ts or app.css, add it here and run `npm run font`.
export const CARD_NAMES = ["愚者", "魔術師", "女祭司", "女皇", "皇帝", "教皇", "戀人", "戰車", "隱者", "吊人", "惡魔", "力量", "命運之輪", "正義", "死亡", "節制", "審判", "高塔", "星星", "月亮", "太陽", "世界"];

export const PIXEL_TEXT = [
  // Title, progress and card-slot numbers.
  "尤里亞的占卜計算器", "尤里亞占卜計算器", "第 / 5 回合", "五回合完成", "五回合已記錄", "推薦", "＋",
  // Verdict band titles (card names and colors are interpolated).
  "建議選 候選 1：（藍）（紫）（紅）", "填入遊戲中的 3 張候選牌（已填 0/3）", "正在比較三張牌…", "推薦暫時無法更新", "目標分數需要修正",
  // Picker dialog titles.
  "加入已確定卡片", "選擇第 張候選牌",
  // Numbers and metric values: scores, percentages, "<0.1%", zero states.
  "0123456789", ",.%<>/-–~ ", "未命中",
  ...CARD_NAMES
];

export const pixelCharacters = () => [...new Set([...PIXEL_TEXT.join("")])].sort();
