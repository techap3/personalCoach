import { describe, expect, it } from "vitest";
import {
  buildSessionSummaryFromTasks,
  getSummaryMessage,
} from "../services/sessionSummary";

describe("session summary message rules", () => {
  it("returns positive message for high completion", () => {
    expect(getSummaryMessage(0.8)).toBe("Great consistency today. Keep it up.");
    expect(getSummaryMessage(1)).toBe("Great consistency today. Keep it up.");
  });

  it("returns neutral message for medium completion", () => {
    expect(getSummaryMessage(0.4)).toBe(
      "Good effort. Try to complete a bit more tomorrow."
    );
    expect(getSummaryMessage(0.79)).toBe(
      "Good effort. Try to complete a bit more tomorrow."
    );
  });

  it("returns encouragement message for low completion", () => {
    expect(getSummaryMessage(0.39)).toBe(
      "Start small. Focus on completing at least one task fully."
    );
  });
});

describe("session summary metrics", () => {
  it("computes completed, skipped and completion rate", () => {
    const summary = buildSessionSummaryFromTasks([
      { status: "done" },
      { status: "done" },
      { status: "skipped" },
      { status: "pending" },
    ]);

    expect(summary.completed).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(summary.completion_rate).toBe(0.5);
  });

  it("handles zero-task sessions safely", () => {
    const summary = buildSessionSummaryFromTasks([]);

    expect(summary.completed).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.completion_rate).toBe(0);
    expect(summary.message).toBe(
      "Start small. Focus on completing at least one task fully."
    );
  });
});
