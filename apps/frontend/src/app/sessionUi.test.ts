import { describe, expect, it } from "vitest";
import {
  getCompletionCtaVariant,
  getGenerateButtonLabel,
  isGenerateDisabled,
} from "./sessionUi";

describe("session UI behavior", () => {
  it("shows Start Today when no session", () => {
    expect(getGenerateButtonLabel("none", "primary", false)).toBe("Start Today");
  });

  it("shows Continue Today when session is active", () => {
    expect(getGenerateButtonLabel("active", "primary", false)).toBe("Continue Today");
  });

  it("shows Retry Session for failed session", () => {
    expect(getGenerateButtonLabel("failed", "primary", false)).toBe("Retry Session");
  });

  it("shows Do More Today for completed primary session", () => {
    expect(getGenerateButtonLabel("completed", "primary", false)).toBe("Do More Today");
  });

  it("disables generate for completed bonus session", () => {
    expect(isGenerateDisabled("completed", "bonus", false, true, false)).toBe(true);
    expect(getGenerateButtonLabel("completed", "bonus", false)).toBe("Daily Limit Reached");
  });

  it("returns primary and bonus completion CTA variants", () => {
    const primary = getCompletionCtaVariant("primary");
    expect(primary.heading).toBe("You completed today's tasks");
    expect(primary.actions).toEqual(["Continue Tomorrow", "Do More Today"]);

    const bonus = getCompletionCtaVariant("bonus");
    expect(bonus.heading).toBe("Great momentum!");
    expect(bonus.actions).toEqual(["Come Back Tomorrow"]);
  });
});
