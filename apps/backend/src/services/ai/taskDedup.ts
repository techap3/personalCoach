import type { GeneratedTask } from "./taskLimits";
import { normalizeTaskTitle as normalizeTaskTitleShared } from "../utils/normalization";

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "to",
  "for",
  "of",
  "on",
  "in",
  "your",
  "you",
  "with",
  "from",
  "what",
  "that",
  "this",
  "one",
  "today",
]);

export function normalizeTaskTitle(title: string): string {
  return normalizeTaskTitleShared(title);
}

function normalizeTaskCore(title: string): string {
  return normalizeTaskTitle(title)
    .replace(/\b\d+\b/g, " ")
    .split(/\s+/)
    .filter((token) => token && !STOP_WORDS.has(token))
    .join(" ")
    .trim();
}

function isSimilarCore(core: string, candidateCore: string): boolean {
  if (!core || !candidateCore) return false;
  if (core === candidateCore) return true;
  return core.includes(candidateCore) || candidateCore.includes(core);
}

export function isDuplicateTaskTitle(title: string, otherTitle: string): boolean {
  return normalizeTaskTitle(title) === normalizeTaskTitle(otherTitle);
}

export function filterDuplicateTasks(
  tasks: GeneratedTask[],
  recentNormalizedTitles: Set<string>
): { tasks: GeneratedTask[]; removedCount: number } {
  const seenInSession = new Set<string>();
  const seenCoreInSession: string[] = [];
  const recentCoreTitles = Array.from(recentNormalizedTitles)
    .map((title) => normalizeTaskCore(title))
    .filter(Boolean);
  const unique: GeneratedTask[] = [];
  let removedCount = 0;

  for (const task of tasks) {
    const normalizedTitle = normalizeTaskTitle(task.title);

    if (!normalizedTitle) {
      removedCount += 1;
      continue;
    }

    const coreTitle = normalizeTaskCore(task.title);
    const isCoreDuplicateInRecent = recentCoreTitles.some((recentCore) =>
      isSimilarCore(coreTitle, recentCore)
    );
    const isCoreDuplicateInSession = seenCoreInSession.some((seenCore) =>
      isSimilarCore(coreTitle, seenCore)
    );

    if (
      recentNormalizedTitles.has(normalizedTitle) ||
      seenInSession.has(normalizedTitle) ||
      isCoreDuplicateInRecent ||
      isCoreDuplicateInSession
    ) {
      removedCount += 1;
      continue;
    }

    seenInSession.add(normalizedTitle);
    if (coreTitle) {
      seenCoreInSession.push(coreTitle);
    }
    unique.push(task);
  }

  return { tasks: unique, removedCount };
}