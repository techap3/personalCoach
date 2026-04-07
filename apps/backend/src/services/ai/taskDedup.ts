import type { GeneratedTask } from "./taskLimits";
import { normalizeTaskTitle as normalizeTaskTitleShared } from "../utils/normalization";

export function normalizeTaskTitle(title: string): string {
  return normalizeTaskTitleShared(title);
}

export function isDuplicateTaskTitle(title: string, otherTitle: string): boolean {
  return normalizeTaskTitle(title) === normalizeTaskTitle(otherTitle);
}

export function filterDuplicateTasks(
  tasks: GeneratedTask[],
  recentNormalizedTitles: Set<string>
): { tasks: GeneratedTask[]; removedCount: number } {
  const seenInSession = new Set<string>();
  const unique: GeneratedTask[] = [];
  let removedCount = 0;

  for (const task of tasks) {
    const normalizedTitle = normalizeTaskTitle(task.title);

    if (!normalizedTitle) {
      removedCount += 1;
      continue;
    }

    if (recentNormalizedTitles.has(normalizedTitle) || seenInSession.has(normalizedTitle)) {
      removedCount += 1;
      continue;
    }

    seenInSession.add(normalizedTitle);
    unique.push(task);
  }

  return { tasks: unique, removedCount };
}