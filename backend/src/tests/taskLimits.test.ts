import { describe, expect, it } from "vitest";
import {
  enforceTaskCount,
  MIN_TASKS,
  MAX_TASKS,
  type GeneratedTask,
} from "../services/ai/taskLimits";

const makeTask = (index: number): GeneratedTask => ({
  title: `Task ${index}`,
  description: `Description ${index}`,
  difficulty: 2,
  task_type:
    index % 4 === 1
      ? "action"
      : index % 4 === 2
        ? "learn"
        : index % 4 === 3
          ? "reflect"
          : "review",
});

describe("task limits enforcement", () => {
  it("trims over-limit input to max", () => {
    const input = Array.from({ length: 8 }, (_, i) => makeTask(i + 1));
    const output = enforceTaskCount(input);

    expect(output).toHaveLength(MAX_TASKS);
    expect(output[0].title).toBe("Task 1");
    expect(output[MAX_TASKS - 1].title).toBe(`Task ${MAX_TASKS}`);
  });

  it("fills under-limit input to minimum", () => {
    const input = [makeTask(1)];
    const output = enforceTaskCount(input, { stepTitle: "Step 1" });

    expect(output.length).toBeGreaterThanOrEqual(MIN_TASKS);
    expect(output.length).toBeLessThanOrEqual(MAX_TASKS);
    expect(output[0].title).toBe("Task 1");
  });

  it("keeps valid-range input unchanged", () => {
    const input = [makeTask(1), makeTask(2), makeTask(3), makeTask(4)];
    const output = enforceTaskCount(input);

    expect(output).toEqual(input);
  });

  it("uses deterministic fallback for empty input", () => {
    const output = enforceTaskCount([]);

    expect(output.length).toBeGreaterThanOrEqual(MIN_TASKS);
    expect(output.length).toBeLessThanOrEqual(MAX_TASKS);
    expect(output[0].title).toBe("Spend 10 minutes actively working on your goal");
  });

  it("handles null/undefined safely", () => {
    const fromNull = enforceTaskCount(null);
    const fromUndefined = enforceTaskCount(undefined);

    expect(fromNull.length).toBeGreaterThanOrEqual(MIN_TASKS);
    expect(fromUndefined.length).toBeGreaterThanOrEqual(MIN_TASKS);
  });

  it("always includes required action and reflect/review types", () => {
    const input: GeneratedTask[] = [
      { title: "Learn A", description: "A", difficulty: 2, task_type: "learn" },
      { title: "Learn B", description: "B", difficulty: 2, task_type: "learn" },
      { title: "Learn C", description: "C", difficulty: 2, task_type: "learn" },
      { title: "Learn D", description: "D", difficulty: 2, task_type: "learn" },
      { title: "Learn E", description: "E", difficulty: 2, task_type: "learn" },
      { title: "Learn F", description: "F", difficulty: 2, task_type: "learn" },
    ];

    const output = enforceTaskCount(input);
    const types = output.map((task) => task.task_type);

    expect(output.length).toBeLessThanOrEqual(MAX_TASKS);
    expect(types).toContain("action");
    expect(types.some((type) => type === "reflect" || type === "review")).toBe(true);
  });

  it("corrects same-type tasks without exceeding max", () => {
    const input: GeneratedTask[] = Array.from({ length: MAX_TASKS }, (_, i) => ({
      title: `Only Learn ${i + 1}`,
      description: "Same type",
      difficulty: 2,
      task_type: "learn",
    }));

    const output = enforceTaskCount(input);
    const types = output.map((task) => task.task_type);

    expect(output.length).toBeLessThanOrEqual(MAX_TASKS);
    expect(types).toContain("action");
    expect(types.some((type) => type === "reflect" || type === "review")).toBe(true);
  });
});
