import { describe, expect, it } from "vitest";
import { parseAdaptedPlan } from "../services/ai/adaptParser";

describe("adapted plan parser", () => {
  const metrics = {
    completionRate: 0.7,
  };

  it("extracts valid JSON wrapped in markdown and text", () => {
    const raw = [
      "Here is your improved plan:",
      "```json",
      JSON.stringify({
        updated_plan: [
          {
            title: "Step A",
            description: "Updated step A",
            difficulty: 3,
          },
          {
            title: "Step B",
            description: "Updated step B",
            difficulty: 2,
          },
        ],
      }),
      "```",
      "Use it wisely.",
    ].join("\n");

    const parsed = parseAdaptedPlan(raw, metrics);

    expect(parsed.updated_plan).toHaveLength(2);
    expect(parsed.updated_plan[0].title).toBe("Step A");
  });

  it("throws on invalid adaptation output", () => {
    const raw = "This is not JSON and contains no valid object";

    expect(() => parseAdaptedPlan(raw, metrics)).toThrow(
      /Invalid adaptation response/i
    );
  });

  it("parses strict valid JSON payload", () => {
    const raw = JSON.stringify({
      updated_plan: [
        {
          title: "Improved Step 1",
          description: "More focused",
          difficulty: 3,
        },
      ],
    });

    const parsed = parseAdaptedPlan(raw, metrics);

    expect(parsed.updated_plan).toHaveLength(1);
    expect(parsed.updated_plan[0].description).toBe("More focused");
  });

  it("defaults missing difficulty instead of failing", () => {
    const raw = JSON.stringify({
      updated_plan: [
        {
          title: "Dance with a partner or group",
          description: "Join a small dance group and practice together",
        },
      ],
    });

    const parsed = parseAdaptedPlan(raw, metrics);

    expect(parsed.updated_plan).toHaveLength(1);
    expect(parsed.updated_plan[0].difficulty).toBe(2);
  });

  it("rejects plan steps that miss required description", () => {
    const raw = JSON.stringify({
      updated_plan: [
        {
          title: "Step without description",
          difficulty: 2,
        },
      ],
    });

    expect(() => parseAdaptedPlan(raw, metrics)).toThrow(
      /Invalid adaptation response/i
    );
  });

  it("parses real-world payload where one step is missing difficulty", () => {
    const raw = JSON.stringify({
      updated_plan: [
        {
          title: "Refine on a style of dance",
          description:
            "Choose a style of dance that you'd like to focus on, such as hip-hop, contemporary, or ballroom",
          difficulty: 1,
        },
        {
          title: "Find online resources",
          description:
            "Look for online tutorials, dance classes, or YouTube channels that offer instruction on your chosen style of dance",
          difficulty: 2,
        },
        {
          title: "Practice regularly",
          description:
            "Set aside time each day (even 10-15 minutes) to practice your new dance style",
          difficulty: 3,
        },
        {
          title: "Invest in essential equipment",
          description:
            "Get the necessary gear, such as dance shoes, a stretch mat, or a dance barre",
          difficulty: 2,
        },
        {
          title: "Take a class or workshop",
          description:
            "Find a local dance studio or join an online community to learn from experienced instructors",
          difficulty: 4,
        },
        {
          title: "Record yourself dancing",
          description:
            "Use a smartphone app or camera to record yourself dancing, and analyze your movements",
          difficulty: 3,
        },
        {
          title: "Set achievable milestones",
          description:
            "Break down larger goals, like mastering a particular routine, into smaller, manageable tasks",
          difficulty: 3,
        },
        {
          title: "Dance with a partner or group",
          description:
            "Find a friend or family member to dance with, or join a dance community to practice with others",
        },
      ],
    });

    const parsed = parseAdaptedPlan(raw, metrics);

    expect(parsed.updated_plan).toHaveLength(8);
    expect(parsed.updated_plan[7].title).toBe("Dance with a partner or group");
    expect(parsed.updated_plan[7].difficulty).toBe(2);
  });
});
