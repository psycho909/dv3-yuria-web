import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveObjective } from "../src/ai/jev.js";

const { systemOne } = vi.hoisted(() => ({ systemOne: vi.fn() }));
vi.mock("@typesafe-ai/sdk", () => ({
  choice: (instructions: string, criteria: Record<string, string>) => ({ type: "choice", instructions, criteria }),
  TypeSafeClient: class { systemOne = systemOne; }
}));

beforeEach(() => {
  vi.stubEnv("TYPESAFE_API_KEY", "test-only-key");
  systemOne.mockReset();
  systemOne.mockResolvedValue({ answers: { objective: { choice: "threshold_probability", probabilities: { threshold_probability: 1 } } } });
});
afterEach(() => vi.unstubAllEnvs());

describe("explicit target routing", () => {
  it.each([1500, 2000, 2500, 3000])("preserves user target %s through Jev routing", async threshold => {
    const result = await resolveObjective(`我要達到 ${threshold} 分`, true, { threshold });
    expect(result.source).toBe("jev");
    expect(result.objective).toEqual({ kind: "threshold_probability", threshold });
    expect(systemOne).toHaveBeenCalledWith(expect.objectContaining({ state: { userGoal: `我要達到 ${threshold} 分`, targetScore: threshold } }));
  });

  it("preserves 1500 in the explicitly selected local path", async () => {
    expect((await resolveObjective("先嘗試1500分", false, { threshold: 1500 })).objective).toEqual({ kind: "threshold_probability", threshold: 1500 });
    expect(systemOne).not.toHaveBeenCalled();
  });

  it.each([true, false])("does not invent a missing target (Jev=%s)", async useJev => {
    await expect(resolveObjective("我要達標", useJev)).rejects.toThrow(/target score is required/);
  });

  it.each([NaN, Infinity, -1])("rejects invalid target %s before calling Jev", async threshold => {
    await expect(resolveObjective("我要達標", true, { threshold })).rejects.toThrow(/threshold/);
    expect(systemOne).not.toHaveBeenCalled();
  });

  it("reports missing credentials instead of silently falling back", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    await expect(resolveObjective("我要1500分", true, { threshold: 1500 })).rejects.toThrow(/TYPESAFE_API_KEY/);
    expect(systemOne).not.toHaveBeenCalled();
  });

  it.each(["expected_score", "stability"])("keeps Jev mode %s without substituting a target", async kind => {
    systemOne.mockResolvedValue({ answers: { objective: { choice: kind } } });
    expect((await resolveObjective("我的目標", true)).objective).toEqual({ kind });
  });

  it("rejects an unsupported model choice", async () => {
    systemOne.mockResolvedValue({ answers: { objective: { choice: "invented" } } });
    await expect(resolveObjective("我的目標", true)).rejects.toThrow(/unsupported/);
  });
});
