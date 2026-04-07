import { describe, expect, it } from "vitest";
import {
  filterDuplicateTasks,
  isDuplicateTaskTitle,
  normalizeTaskTitle,
} from "../services/ai/taskDedup";
import type { GeneratedTask } from "../services/ai/taskLimits";

describe("task duplicate detection", () => {
  it("detects exact match duplicates", () => {
    expect(isDuplicateTaskTitle("Go for a run", "Go for a run")).toBe(true);
  });

  it("detects normalized duplicates", () => {
    expect(isDuplicateTaskTitle(" Go for a run! ", "go for a run")).toBe(true);
  });

  it("does not flag different tasks as duplicates", () => {
    expect(isDuplicateTaskTitle("Run 5km", "Walk 10 mins")).toBe(false);
  });

  it("removes intra-session duplicates", () => {
    const tasks: GeneratedTask[] = [
      { title: "Go for a run", description: "Task 1", difficulty: 2, task_type: "action" },
      { title: "go for a run!", description: "Task 2", difficulty: 2, task_type: "action" },
      { title: "Walk 10 mins", description: "Task 3", difficulty: 1, task_type: "learn" },
    ];

    const result = filterDuplicateTasks(tasks, new Set());

    expect(result.tasks).toHaveLength(2);
    expect(result.removedCount).toBe(1);
    expect(result.tasks.map((task) => normalizeTaskTitle(task.title))).toEqual([
      "go for a run",
      "walk 10 mins",
    ]);
  });
});
