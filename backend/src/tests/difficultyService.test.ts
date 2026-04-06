import { describe, expect, it } from "vitest";
import {
  chooseTargetDifficulty,
  clampDifficulty,
  computeDifficultyMetrics,
} from "../services/difficultyService";

describe("difficulty balancing rules", () => {
  it("decreases difficulty when skip_rate is high", () => {
    const target = chooseTargetDifficulty(3, {
      completion_rate: 0.2,
      skip_rate: 0.75,
    });

    expect(target).toBe(2);
  });

  it("increases difficulty when completion_rate is high", () => {
    const target = chooseTargetDifficulty(3, {
      completion_rate: 0.9,
      skip_rate: 0.1,
    });

    expect(target).toBe(4);
  });

  it("keeps difficulty stable for mixed behavior", () => {
    const target = chooseTargetDifficulty(3, {
      completion_rate: 0.6,
      skip_rate: 0.2,
    });

    expect(target).toBe(3);
  });

  it("uses zero metrics when no history exists", () => {
    const metrics = computeDifficultyMetrics([]);

    expect(metrics.completion_rate).toBe(0);
    expect(metrics.skip_rate).toBe(0);
    expect(metrics.total_tasks).toBe(0);
  });

  it("never jumps more than one level and clamps to range", () => {
    expect(chooseTargetDifficulty(5, { completion_rate: 0.95, skip_rate: 0 })).toBe(5);
    expect(chooseTargetDifficulty(1, { completion_rate: 0, skip_rate: 0.9 })).toBe(1);
    expect(chooseTargetDifficulty(4, { completion_rate: 0, skip_rate: 0.9 })).toBe(3);
    expect(chooseTargetDifficulty(2, { completion_rate: 0.95, skip_rate: 0 })).toBe(3);
    expect(clampDifficulty(9)).toBe(5);
    expect(clampDifficulty(-2)).toBe(1);
  });
});
