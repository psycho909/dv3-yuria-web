import { recommend, type GameState, type Objective, type OfferedCard, type Rules } from "./domain";

type RecommendRequest = {
  type: "RECOMMEND";
  requestId: number;
  state: GameState;
  candidates: OfferedCard[];
  objective: Objective;
  simulations: number;
  seed: number;
  rules: Rules;
  targetThreshold: number;
};

self.addEventListener("message", (event: MessageEvent<RecommendRequest>) => {
  if (event.data.type !== "RECOMMEND") return;
  try {
    const result = recommend(event.data.state, event.data.candidates, event.data.objective, event.data.simulations, event.data.seed, event.data.rules, event.data.targetThreshold);
    self.postMessage({ type: "RESULT", requestId: event.data.requestId, result });
  } catch (error) {
    self.postMessage({ type: "ERROR", requestId: event.data.requestId, message: error instanceof Error ? error.message : "無法完成推薦計算" });
  }
});
