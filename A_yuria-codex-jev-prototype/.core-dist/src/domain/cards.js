export const CARDS = {
    fool: { id: "fool", nameZh: "愚者", category: "score", activationProbability: 1.00, scoreValue: 75 },
    magician: { id: "magician", nameZh: "魔術師", category: "score", activationProbability: 0.95, scoreValue: 80 },
    high_priestess: { id: "high_priestess", nameZh: "女祭司", category: "score", activationProbability: 0.90, scoreValue: 85 },
    empress: { id: "empress", nameZh: "女皇", category: "score", activationProbability: 0.85, scoreValue: 90 },
    emperor: { id: "emperor", nameZh: "皇帝", category: "score", activationProbability: 0.80, scoreValue: 95 },
    hierophant: { id: "hierophant", nameZh: "教皇", category: "score", activationProbability: 0.75, scoreValue: 100 },
    lovers: { id: "lovers", nameZh: "戀人", category: "score", activationProbability: 0.70, scoreValue: 110 },
    chariot: { id: "chariot", nameZh: "戰車", category: "score", activationProbability: 0.65, scoreValue: 120 },
    hermit: { id: "hermit", nameZh: "隱者", category: "score", activationProbability: 0.60, scoreValue: 130 },
    hanged_man: { id: "hanged_man", nameZh: "吊人", category: "score", activationProbability: 0.55, scoreValue: 140 },
    devil: { id: "devil", nameZh: "惡魔", category: "score", activationProbability: 0.50, scoreValue: 150 },
    strength: { id: "strength", nameZh: "力量", category: "multiplier", activationProbability: 1.00, multiplierValue: 0.7 },
    wheel_of_fortune: { id: "wheel_of_fortune", nameZh: "命運之輪", category: "multiplier", activationProbability: 0.90, multiplierValue: 0.8 },
    justice: { id: "justice", nameZh: "正義", category: "multiplier", activationProbability: 0.80, multiplierValue: 0.9 },
    death: { id: "death", nameZh: "死神", category: "multiplier", activationProbability: 0.70, multiplierValue: 1.0 },
    temperance: { id: "temperance", nameZh: "節制", category: "multiplier", activationProbability: 0.60, multiplierValue: 1.2 },
    judgement: { id: "judgement", nameZh: "審判", category: "multiplier", activationProbability: 0.50, multiplierValue: 1.5 },
    tower: { id: "tower", nameZh: "高塔", category: "special", activationProbability: 1.00 },
    star: { id: "star", nameZh: "星星", category: "special", activationProbability: 1.00 },
    moon: { id: "moon", nameZh: "月亮", category: "special", activationProbability: 0.80 },
    sun: { id: "sun", nameZh: "太陽", category: "special", activationProbability: 0.50 },
    world: { id: "world", nameZh: "世界", category: "special", activationProbability: 0.50 }
};
export const CARD_LIST = Object.values(CARDS);
export const REWARD_THRESHOLDS = [0, 200, 500, 900, 1400, 2000, 2700];
export const CATEGORY_WEIGHTS = {
    early: { score: 10, multiplier: 10, special: 5 },
    final: { score: 5, multiplier: 10, special: 20 }
};
