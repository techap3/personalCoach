import { describe, expect, it } from "vitest";
import {
  buildStepTaskPrompt,
  buildTaskAdaptationPrompt,
  buildTendencySummary,
} from "../services/ai/prompts";

describe("prompt integrity", () => {
  it("returns empty tendency summary when memory is null", () => {
    expect(buildTendencySummary(null)).toBe("");
    expect(buildTendencySummary(undefined)).toBe("");
  });

  it("omits user tendencies block in step prompt when memory is missing", () => {
    const prompt = buildStepTaskPrompt(
      {
        title: "Step 1",
        description: "Do work",
        difficulty: 2,
      },
      ["Old task"],
      null
    );

    const userMessage = String(prompt[1]?.content || "");
    expect(userMessage.includes("User tendencies:")).toBe(false);
  });

  it("omits user tendencies block in adaptation prompt when memory is missing", () => {
    const prompt = buildTaskAdaptationPrompt({
      tasks: [{ title: "Task", description: "Desc", difficulty: 2 }],
      metrics: { completionRate: 0.5, done: 1, skipped: 1 },
      history: [],
      memory: null,
    });

    const userMessage = String(prompt[1]?.content || "");
    expect(userMessage.includes("User tendencies:")).toBe(false);
  });
});
