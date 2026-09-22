export type CardCategory = "score" | "multiplier" | "special";
export type CardColor = "blue" | "purple" | "red";
export type CardId =
  | "fool" | "magician" | "high_priestess" | "empress" | "emperor" | "hierophant"
  | "lovers" | "chariot" | "hermit" | "hanged_man" | "devil"
  | "strength" | "wheel_of_fortune" | "justice" | "death" | "temperance" | "judgement"
  | "tower" | "star" | "moon" | "sun" | "world";

export type SpecialEffect =
  | { kind: "tower"; procMultiplier: number; fallbackMultiplier: number }
  | { kind: "removeOtherCard"; multiplier: number }
  | { kind: "failedCardScore"; baseScore: number; perFailedCard: number }
  | { kind: "activeCountMultiplier"; baseMultiplier: number; perActiveCard: number }
  | { kind: "highestActiveScore"; factor: number };

export interface CardDefinition {
  id: CardId;
  nameZh: string;
  category: CardCategory;
  activationProbability: number;
  scoreValue?: number;
  failedScoreBonus?: number;
  multiplierValue?: number;
  fallbackMultiplierValue?: number;
  specialEffect?: SpecialEffect;
}

export interface OfferedCard {
  cardId: CardId;
  color: CardColor;
}

export interface SelectedCard extends OfferedCard {
  activated: boolean;
  removed?: boolean;
  towerProc?: boolean;
}

export interface GameState {
  selected: SelectedCard[];
  turn: 1 | 2 | 3 | 4 | 5;
}

export type RecommendationObjective =
  | { kind: "expected_score" }
  | { kind: "threshold_probability"; threshold: number }
  | { kind: "stability" };

export interface RuleConfig {
  failureScore: number;
  sunCountsSelf: boolean;
  redRollMode: "integerPercent" | "continuous";
  blessingMode: "disabled";
  futureOfferModel: "categoryWeight_uniformWithinCategory";
  // Repeated offer colors were reported; uniform independent colors are
  // an explicit hypothesis, not a measured game distribution.
  futureColorModel: "independentUniform" | "oneEach";
  // The screenshot supports removing failed cards; uniform target weights
  // remain an assumption. Keep the previous model available for comparison.
  starRemovalPolicy: "uniformPresent" | "uniformActive";
}

export interface ScoreBreakdown {
  sum: number;
  multiplier: number;
  redBonus: number;
  finalScore: number;
  activeColorCounts: Record<CardColor, number>;
  failedCount: number;
}

export interface CandidateMetrics {
  candidate: OfferedCard;
  meanScore: number;
  p10: number;
  p50: number;
  p90: number;
  standardDeviation: number;
  threshold: number;
  thresholdProbability: number;
  simulations: number;
  calculationMethod?: "exact" | "monte_carlo";
  minScore?: number;
  maxScore?: number;
}

export type RecommendationSelectionMode = "objective" | "highest_expected_score_fallback";

export interface RecommendationResult {
  objective: RecommendationObjective;
  // If every sampled candidate misses a threshold, use expected final score
  // as the actionable fallback instead of leaving the user without a choice.
  selectionMode: RecommendationSelectionMode;
  ranked: CandidateMetrics[];
  assumptions: string[];
}
