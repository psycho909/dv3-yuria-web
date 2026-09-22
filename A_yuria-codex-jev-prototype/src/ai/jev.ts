import { choice, TypeSafeClient } from "@typesafe-ai/sdk";
import type { RecommendationObjective } from "../domain/types.js";

export interface ObjectiveResolution {
  objective: RecommendationObjective;
  source: "jev" | "local-fallback";
  probabilities?: Record<string, number>;
}

export interface ObjectiveOptions {
  // Explicit user-selected score; Jev selects the mode, never the number.
  threshold?: number;
}

function toObjective(kind: string, threshold?: number): RecommendationObjective {
  if (kind === "threshold_probability") {
    if (threshold == null) throw new Error("A target score is required for threshold_probability; no default target is assumed.");
    return { kind, threshold };
  }
  if (kind === "expected_score" || kind === "stability") return { kind };
  throw new Error("Jev returned an unsupported objective");
}

function fallback(text: string, threshold?: number): ObjectiveResolution {
  if (/穩|安全|低風險|stable|risk/i.test(text)) {
    return { objective: { kind: "stability" }, source: "local-fallback" };
  }
  if (/平均|期望|average|expected/i.test(text)) {
    return { objective: { kind: "expected_score" }, source: "local-fallback" };
  }
  if (threshold != null || /Lv\.?\s*\d+|達標|threshold|\d[\d,]*\s*分/i.test(text)) {
    return { objective: toObjective("threshold_probability", threshold), source: "local-fallback" };
  }
  return { objective: { kind: "expected_score" }, source: "local-fallback" };
}

export async function resolveObjective(text: string, useJev: boolean, options: ObjectiveOptions = {}): Promise<ObjectiveResolution> {
  const { threshold } = options;
  if (threshold != null && (!Number.isFinite(threshold) || threshold < 0)) {
    throw new RangeError("threshold must be finite and non-negative");
  }
  if (!useJev) return fallback(text, threshold);
  if (!process.env.TYPESAFE_API_KEY?.trim()) throw new Error("Jev was requested but TYPESAFE_API_KEY is missing");

  const client = new TypeSafeClient();
  const response = await client.systemOne({
    state: { userGoal: text, targetScore: threshold ?? null },
    questions: {
      objective: choice(
        "Choose the single optimization objective that best matches `userGoal`. This only selects a mode; it must not calculate game probabilities.",
        {
          expected_score: "Maximize average final lucky score.",
          threshold_probability: "Maximize probability of reaching the user's explicitly requested target score. Select this mode only; do not choose, invent or change a numeric target.",
          stability: "Prefer a safer distribution with a stronger lower tail and lower downside risk."
        }
      )
    }
  });

  const answer = response.answers.objective;
  const selected = answer.choice;
  const objective = toObjective(selected, threshold);

  return {
    objective,
    source: "jev",
    probabilities: answer.probabilities as Record<string, number> | undefined
  };
}
