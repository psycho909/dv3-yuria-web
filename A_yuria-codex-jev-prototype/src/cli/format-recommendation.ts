import { CARDS } from "../domain/cards.js";
import type { RecommendationResult } from "../domain/types.js";

export function formatRecommendation(result: RecommendationResult): string {
  const colors = { blue: "藍", purple: "紫", red: "紅" };
  const lines = result.ranked.map((m, i) => {
    const probability = m.thresholdProbability === 0 && m.calculationMethod !== "exact"
      ? `抽樣 ${m.simulations} 次未命中（不等於不可能）`
      : `${(m.thresholdProbability * 100).toFixed(2)}%`;
    const range = m.minScore == null ? "" : `｜${m.calculationMethod === "exact" ? "可能" : "抽樣"}範圍 ${m.minScore}～${m.maxScore} 分`;
    return `${i + 1}. ${CARDS[m.candidate.cardId].nameZh}／${colors[m.candidate.color]}：達 ${m.threshold} 分 ${probability}｜預期 ${m.meanScore.toFixed(1)} 分${range}`;
  });
  const best = result.ranked[0]!;
  const bestByExpected = [...result.ranked].sort((a, b) => b.meanScore - a.meanScore)[0]!;
  const label = result.selectionMode === "highest_expected_score_fallback" ? "建議（達標率全為零，改採預期分數）" : "建議（達標率最高）";
  lines.push(`${label}：${CARDS[best.candidate.cardId].nameZh}／${colors[best.candidate.color]}。`);
  if (bestByExpected.candidate.cardId !== best.candidate.cardId || bestByExpected.candidate.color !== best.candidate.color) {
    lines.push(`預期分數最高：${CARDS[bestByExpected.candidate.cardId].nameZh}／${colors[bestByExpected.candidate.color]}（${bestByExpected.meanScore.toFixed(1)} 分）。`);
  }
  lines.push("預期分數不是保證分數。");
  return lines.join("\n");
}
