import { describe, expect, it } from "vitest";
import {
  enforceBehavioralPreferences,
  enforceTaskCount,
  enforceTargetDifficulty,
  isValidFinalTasks,
  validateBehavioralPreferences,
  type GeneratedTask,
} from "../services/ai/taskLimits";

function hasRequiredTypes(tasks: GeneratedTask[]) {
  const hasAction = tasks.some((task) => task.task_type === "action");
  const hasReflective = tasks.some(
    (task) => task.task_type === "reflect" || task.task_type === "review"
  );
  return hasAction && hasReflective;
}

describe("task invariant pipeline", () => {
  it("keeps core invariants after count + behavioral + validation pipeline", () => {
    const generated: GeneratedTask[] = [
      { title: "Run intervals", description: "Sprint set", difficulty: 3, task_type: "action" },
      { title: "Learn pacing", description: "Technique", difficulty: 3, task_type: "learn" },
      { title: "Reflect recovery", description: "Journal", difficulty: 3, task_type: "reflect" },
      { title: "Review form", description: "Video check", difficulty: 3, task_type: "review" },
    ];

    const counted = enforceTaskCount(generated, { desiredCount: 4 });
    const behaviorAdjusted = enforceBehavioralPreferences(counted, {
      skipPattern: { learn: 4 },
      originalTasks: counted,
    });
    const finalTasks = enforceTargetDifficulty(
      enforceTaskCount(behaviorAdjusted, { desiredCount: 4 }),
      3
    );

    expect(finalTasks).toHaveLength(4);
    expect(hasRequiredTypes(finalTasks)).toBe(true);

    const distribution = finalTasks.reduce<Record<string, number>>((acc, task) => {
      acc[task.task_type] = (acc[task.task_type] || 0) + 1;
      return acc;
    }, {});
    expect(Math.max(...Object.values(distribution))).toBeLessThanOrEqual(3);
    expect(finalTasks.every((task) => task.difficulty >= 1 && task.difficulty <= 5)).toBe(true);

    expect(
      isValidFinalTasks(finalTasks, {
        expectedCount: 4,
        targetDifficulty: 3,
      })
    ).toBe(true);
  });

  it("reduces skipped running category and keeps required types", () => {
    const input = [
      { title: "Morning run", description: "20 min run", difficulty: 2, task_type: "running" as any },
      { title: "Core drills", description: "Stability", difficulty: 2, task_type: "action" },
      { title: "Reflect fatigue", description: "Write notes", difficulty: 2, task_type: "reflect" },
    ] as GeneratedTask[];

    const adjusted = enforceBehavioralPreferences(input, {
      skipPattern: { running: 3 },
      originalTasks: input,
    });

    const runningCountBefore = input.filter((task) => (task as any).task_type === "running").length;
    const runningCountAfter = adjusted.filter((task) => (task as any).task_type === "running").length;

    expect(runningCountAfter).toBeLessThanOrEqual(runningCountBefore);

    const repaired = enforceTaskCount(adjusted, { desiredCount: 3 });
    expect(hasRequiredTypes(repaired)).toBe(true);
  });

  it("repairs low desiredCount edge cases to invariant-safe minimum", () => {
    const input: GeneratedTask[] = [
      { title: "Learn A", description: "A", difficulty: 2, task_type: "learn" },
      { title: "Learn B", description: "B", difficulty: 2, task_type: "learn" },
      { title: "Learn C", description: "C", difficulty: 2, task_type: "learn" },
      { title: "Learn D", description: "D", difficulty: 2, task_type: "learn" },
    ];

    const outputForOne = enforceTaskCount(input, { desiredCount: 1 });
    const outputForTwo = enforceTaskCount(input, { desiredCount: 2 });

    expect(outputForOne.length).toBeGreaterThanOrEqual(2);
    expect(outputForTwo.length).toBeGreaterThanOrEqual(2);
    expect(hasRequiredTypes(outputForOne)).toBe(true);
    expect(hasRequiredTypes(outputForTwo)).toBe(true);
  });

  it("validates final tasks across required pass/fail cases", () => {
    const valid: GeneratedTask[] = [
      { title: "Act", description: "Do", difficulty: 2, task_type: "action" },
      { title: "Reflect", description: "Think", difficulty: 2, task_type: "reflect" },
      { title: "Review", description: "Reinforce", difficulty: 2, task_type: "review" },
    ];

    expect(isValidFinalTasks(valid, { expectedCount: 3, targetDifficulty: 2 })).toBe(true);

    const missingAction = valid.filter((task) => task.task_type !== "action");
    expect(isValidFinalTasks(missingAction, { expectedCount: 3, targetDifficulty: 2 })).toBe(false);

    const missingReflection = [
      { title: "Act", description: "Do", difficulty: 2, task_type: "action" as const },
      { title: "Learn", description: "Know", difficulty: 2, task_type: "learn" as const },
      { title: "Learn2", description: "Know", difficulty: 2, task_type: "learn" as const },
    ];
    expect(isValidFinalTasks(missingReflection, { expectedCount: 3, targetDifficulty: 2 })).toBe(false);

    expect(isValidFinalTasks(valid, { expectedCount: 4, targetDifficulty: 2 })).toBe(false);
  });

  it("fails behavioral validation when post-processing breaks count", () => {
    const original: GeneratedTask[] = [
      { title: "Act", description: "Do", difficulty: 2, task_type: "action" },
      { title: "Learn", description: "Know", difficulty: 2, task_type: "learn" },
      { title: "Reflect", description: "Think", difficulty: 2, task_type: "reflect" },
    ];
    const candidate = original.slice(0, 2);

    expect(
      validateBehavioralPreferences(original, candidate, {
        expectedCount: 3,
        targetDifficulty: 2,
      })
    ).toBe(false);
  });
});
