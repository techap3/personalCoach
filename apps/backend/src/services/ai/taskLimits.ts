import { normalizeTaskTitle } from "../utils/normalization";
import type { TaskType } from "../../../../../packages/types";

export const MIN_TASKS = 3;
export const MAX_TASKS = 5;

const TASK_TYPES: TaskType[] = ["action", "learn", "reflect", "review"];

const FALLBACK_BY_TYPE: Record<TaskType, { title: string; description: string; difficulty: number }> = {
  action: {
    title: "Spend 10 minutes actively working on your goal",
    description: "Take one concrete action now and capture what you finished in one sentence.",
    difficulty: 2,
  },
  learn: {
    title: "Learn one concept that unblocks your next action",
    description: "Read or watch one focused resource and write down two practical takeaways.",
    difficulty: 2,
  },
  reflect: {
    title: "Reflect: what went well and what didn’t today?",
    description: "Write one success, one friction point, and one adjustment for your next work block.",
    difficulty: 1,
  },
  review: {
    title: "Review what you learned and summarize key points",
    description: "Summarize your top three insights and how each changes your next session.",
    difficulty: 1,
  },
};

export type GeneratedTask = {
  title: string;
  description: string;
  difficulty: number;
  task_type: TaskType;
};

function normalizeTaskType(value: unknown): TaskType {
  if (typeof value !== "string") return "learn";

  const normalized = value.trim().toLowerCase();
  if (TASK_TYPES.includes(normalized as TaskType)) {
    return normalized as TaskType;
  }

  if (normalized === "reflection") return "reflect";
  return "learn";
}

function buildUniqueTitle(
  baseTitle: string,
  existingNormalizedTitles: Set<string>,
  blockedNormalizedTitles: Set<string>
): string {
  let candidate = baseTitle;
  let suffix = 2;

  while (
    existingNormalizedTitles.has(normalizeTaskTitle(candidate)) ||
    blockedNormalizedTitles.has(normalizeTaskTitle(candidate))
  ) {
    candidate = `${baseTitle} (${suffix})`;
    suffix += 1;
  }

  existingNormalizedTitles.add(normalizeTaskTitle(candidate));
  return candidate;
}

function buildFallbackTaskByType(
  taskType: TaskType,
  existingNormalizedTitles: Set<string>,
  blockedNormalizedTitles: Set<string>
): GeneratedTask {
  const fallback = FALLBACK_BY_TYPE[taskType];
  const uniqueTitle = buildUniqueTitle(
    fallback.title,
    existingNormalizedTitles,
    blockedNormalizedTitles
  );

  return {
    ...fallback,
    title: uniqueTitle,
    task_type: taskType,
  };
}

export function getTaskTypeDistribution(tasks: GeneratedTask[]) {
  return tasks.reduce(
    (acc, task) => {
      acc[task.task_type] += 1;
      return acc;
    },
    {
      action: 0,
      learn: 0,
      reflect: 0,
      review: 0,
    } as Record<TaskType, number>
  );
}

function clampDifficulty(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 2;
  if (value < 1) return 1;
  if (value > 5) return 5;
  return Math.round(value);
}

function toTask(value: unknown): GeneratedTask | null {
  if (!value || typeof value !== "object") return null;

  const maybeTask = value as Record<string, unknown>;
  const title = typeof maybeTask.title === "string" ? maybeTask.title.trim() : "";
  const description =
    typeof maybeTask.description === "string"
      ? maybeTask.description.trim()
      : "Complete a focused action that moves this step forward.";

  if (!title) return null;

  const rawTaskType = maybeTask.task_type;
  const resolvedTaskType = normalizeTaskType(rawTaskType);
  if (typeof rawTaskType !== "string" || normalizeTaskType(rawTaskType) !== rawTaskType.trim().toLowerCase()) {
    console.warn("[tasks] Applied fallback task_type=learn for invalid or missing task_type", {
      title,
      original_task_type: rawTaskType,
    });
  }

  return {
    title,
    description,
    difficulty: clampDifficulty(maybeTask.difficulty),
    task_type: resolvedTaskType,
  };
}

export function sanitizeGeneratedTasks(input: unknown): GeneratedTask[] {
  if (!Array.isArray(input)) return [];
  return input.map(toTask).filter((task): task is GeneratedTask => task !== null);
}

export function buildDeterministicFallbackTasks(stepTitle?: string): GeneratedTask[] {
  const context = stepTitle?.trim() || "your goal";

  return [
    {
      title: "Spend 10 minutes actively working on your goal",
      description: `Take one concrete action that directly advances ${context}.`,
      difficulty: 2,
      task_type: "action",
    },
    {
      title: "Learn one concept that unblocks your next action",
      description: `Study one focused concept related to ${context} and note two useful takeaways.`,
      difficulty: 2,
      task_type: "learn",
    },
    {
      title: "Reflect: what went well and what didn’t today?",
      description: "Write one win, one blocker, and one adjustment for your next session.",
      difficulty: 1,
      task_type: "reflect",
    },
  ];
}

export function enforceTaskTypeMix(
  input: unknown,
  options?: { blockedNormalizedTitles?: Set<string> | string[] }
): GeneratedTask[] {
  const tasks = sanitizeGeneratedTasks(input);

  const blockedTitles = new Set(
    Array.isArray(options?.blockedNormalizedTitles)
      ? options?.blockedNormalizedTitles
      : Array.from(options?.blockedNormalizedTitles ?? [])
  );

  const existingTitles = new Set(tasks.map((task) => normalizeTaskTitle(task.title)));

  const replaceTaskWithType = (index: number, taskType: TaskType) => {
    tasks[index] = buildFallbackTaskByType(taskType, existingTitles, blockedTitles);
  };

  const hasType = (type: TaskType) => tasks.some((task) => task.task_type === type);

  if (!tasks.length) {
    tasks.push(buildFallbackTaskByType("action", existingTitles, blockedTitles));
    tasks.push(buildFallbackTaskByType("reflect", existingTitles, blockedTitles));
    return tasks;
  }

  if (!hasType("action")) {
    const replaceIndex = tasks.findIndex((task) => task.task_type === "learn");
    replaceTaskWithType(replaceIndex >= 0 ? replaceIndex : 0, "action");
  }

  if (!hasType("reflect") && !hasType("review")) {
    const replaceIndex = tasks.findIndex((task) => task.task_type === "learn");
    const fallbackIndex = tasks.findIndex((task) => task.task_type !== "action");
    replaceTaskWithType(replaceIndex >= 0 ? replaceIndex : Math.max(0, fallbackIndex), "reflect");
  }

  if (!hasType("action")) {
    const replaceIndex = tasks.findIndex((task) => task.task_type !== "reflect" && task.task_type !== "review");
    replaceTaskWithType(replaceIndex >= 0 ? replaceIndex : 0, "action");
  }

  const uniqueTypes = new Set(tasks.map((task) => task.task_type));
  if (uniqueTypes.size === 1 && tasks.length > 1 && tasks[0]?.task_type !== "learn") {
    replaceTaskWithType(1, "learn");
  }

  return tasks;
}

function fillToMinimumTaskCount(
  tasks: GeneratedTask[],
  options?: { stepTitle?: string; blockedNormalizedTitles?: Set<string> | string[] },
  targetCount = MIN_TASKS
) {
  const blockedTitles = new Set(
    Array.isArray(options?.blockedNormalizedTitles)
      ? options?.blockedNormalizedTitles
      : Array.from(options?.blockedNormalizedTitles ?? [])
  );

  if (tasks.length >= targetCount) {
    return;
  }

  const fallback = buildDeterministicFallbackTasks(options?.stepTitle);
  const existingTitles = new Set(tasks.map((task) => normalizeTaskTitle(task.title)));

  for (const fallbackTask of fallback) {
    if (tasks.length >= targetCount) break;
    const normalizedFallbackTitle = normalizeTaskTitle(fallbackTask.title);

    if (!existingTitles.has(normalizedFallbackTitle) && !blockedTitles.has(normalizedFallbackTitle)) {
      tasks.push(fallbackTask);
      existingTitles.add(normalizedFallbackTitle);
    }
  }

  let fallbackIndex = 0;
  while (tasks.length < targetCount) {
    const baseTask = fallback[fallbackIndex % fallback.length];
    let variantCounter = 2;
    let candidateTitle = baseTask.title;
    let normalizedCandidate = normalizeTaskTitle(candidateTitle);

    while (existingTitles.has(normalizedCandidate) || blockedTitles.has(normalizedCandidate)) {
      candidateTitle = `${baseTask.title} ${variantCounter}`;
      normalizedCandidate = normalizeTaskTitle(candidateTitle);
      variantCounter += 1;
    }

    tasks.push({
      ...baseTask,
      title: candidateTitle,
    });
    existingTitles.add(normalizedCandidate);
    fallbackIndex += 1;
  }
}

export function enforceTaskCount(
  input: unknown,
  options?: {
    stepTitle?: string;
    blockedNormalizedTitles?: Set<string> | string[];
    desiredCount?: number;
  }
): GeneratedTask[] {
  const bounded = sanitizeGeneratedTasks(input).slice(0, MAX_TASKS);

  fillToMinimumTaskCount(bounded, options);

  const withTypes = enforceTaskTypeMix(bounded, {
    blockedNormalizedTitles: options?.blockedNormalizedTitles,
  });

  fillToMinimumTaskCount(withTypes, options);

  let corrected = enforceTaskTypeMix(withTypes, {
    blockedNormalizedTitles: options?.blockedNormalizedTitles,
  });

  const requestedCount = Number(options?.desiredCount);
  if (Number.isFinite(requestedCount)) {
    const clampedDesired = Math.max(MIN_TASKS, Math.min(MAX_TASKS, Math.round(requestedCount)));

    if (corrected.length < clampedDesired) {
      fillToMinimumTaskCount(corrected, options, clampedDesired);
      corrected = enforceTaskTypeMix(corrected, {
        blockedNormalizedTitles: options?.blockedNormalizedTitles,
      });
    }

    const sized = corrected.slice(0, clampedDesired);
    const repaired = enforceTaskTypeMix(sized, {
      blockedNormalizedTitles: options?.blockedNormalizedTitles,
    });

    if (isValidFinalTasks(repaired, { expectedCount: clampedDesired })) {
      return repaired;
    }

    const fallbackSeed = corrected.slice();
    if (fallbackSeed.length < clampedDesired) {
      fillToMinimumTaskCount(fallbackSeed, options, clampedDesired);
    }

    const fallback = enforceTaskTypeMix(fallbackSeed, {
      blockedNormalizedTitles: options?.blockedNormalizedTitles,
    }).slice(0, clampedDesired);

    return fallback;
  }

  return corrected.slice(0, MAX_TASKS);
}

export function enforceTargetDifficulty(input: GeneratedTask[], targetDifficulty: number): GeneratedTask[] {
  const clampedTarget = Math.max(1, Math.min(5, Math.round(targetDifficulty)));
  return input.map((task) => ({
    ...task,
    difficulty: clampedTarget,
  }));
}

function getTopSkippedCategories(skipPattern: Record<string, number>, limit = 2) {
  return Object.entries(skipPattern)
    .filter(([category, count]) => category !== "general" && count > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([category]) => category as TaskType);
}

function pickReplacementType(excluded: Set<string>, fallback: TaskType) {
  const candidates: TaskType[] = ["action", "learn", "reflect", "review"];
  const safe = candidates.find((candidate) => !excluded.has(candidate));
  return safe ?? fallback;
}

function normalizePreferenceDifficulty(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric <= 1) return 2;
  if (numeric >= 3) return 4;
  return 3;
}

function hasValidCount(tasks: GeneratedTask[], expectedCount?: number) {
  const clampedExpected =
    typeof expectedCount === "number" && Number.isFinite(expectedCount)
      ? Math.max(MIN_TASKS, Math.min(MAX_TASKS, Math.round(expectedCount)))
      : null;

  if (clampedExpected !== null) {
    return tasks.length === clampedExpected;
  }

  return tasks.length >= MIN_TASKS && tasks.length <= MAX_TASKS;
}

function hasRequiredTypes(tasks: GeneratedTask[]) {
  const hasAction = tasks.some((task) => task.task_type === "action");
  const hasReflective = tasks.some(
    (task) => task.task_type === "reflect" || task.task_type === "review"
  );
  return hasAction && hasReflective;
}

function hasDiversity(tasks: GeneratedTask[]) {
  if (!tasks.length) return false;
  const distribution = getTaskTypeDistribution(tasks);
  const maxAllowedPerType = Math.ceil(tasks.length * 0.8);
  return Object.values(distribution).every((count) => count <= maxAllowedPerType);
}

function respectsDifficulty(
  tasks: GeneratedTask[],
  options?: { preferredDifficulty?: unknown; targetDifficulty?: number }
) {
  const targetDifficulty = options?.targetDifficulty;
  if (typeof targetDifficulty === "number" && Number.isFinite(targetDifficulty)) {
    const clamped = Math.max(1, Math.min(5, Math.round(targetDifficulty)));
    return tasks.every((task) => task.difficulty === clamped);
  }

  const preferenceTarget = normalizePreferenceDifficulty(options?.preferredDifficulty);
  if (preferenceTarget === null) {
    return true;
  }

  return tasks.every((task) => Math.abs(task.difficulty - preferenceTarget) <= 2);
}

export function isValidFinalTasks(
  tasks: GeneratedTask[],
  options?: {
    expectedCount?: number;
    preferredDifficulty?: unknown;
    targetDifficulty?: number;
  }
) {
  return (
    hasValidCount(tasks, options?.expectedCount) &&
    hasRequiredTypes(tasks) &&
    hasDiversity(tasks) &&
    respectsDifficulty(tasks, {
      preferredDifficulty: options?.preferredDifficulty,
      targetDifficulty: options?.targetDifficulty,
    })
  );
}

export function enforceBehavioralPreferences(
  input: GeneratedTask[],
  options?: {
    preferredDifficulty?: unknown;
    skipPattern?: Record<string, number> | null;
    originalTasks?: GeneratedTask[];
  }
) {
  if (!input.length) return [];
  const skipPattern = options?.skipPattern || {};
  const highSkippedCategories = new Set(getTopSkippedCategories(skipPattern, 2));

  return input.map((task, index) => {
    const fallbackType = options?.originalTasks?.[index]?.task_type || task.task_type;
    const nextType = highSkippedCategories.has(task.task_type)
      ? pickReplacementType(highSkippedCategories, fallbackType)
      : task.task_type;

    return {
      ...task,
      task_type: nextType,
      // Keep route-calibrated difficulty (bonus/high-performance logic) intact.
      difficulty: task.difficulty,
    };
  });
}

export function validateBehavioralPreferences(
  originalTasks: GeneratedTask[],
  candidateTasks: GeneratedTask[],
  options?: {
    expectedCount?: number;
    targetDifficulty?: number;
    preferredDifficulty?: unknown;
    skipPattern?: Record<string, number> | null;
  }
) {
  const expectedCount = options?.expectedCount ?? originalTasks.length;

  if (!isValidFinalTasks(candidateTasks, {
    expectedCount,
    preferredDifficulty: options?.preferredDifficulty,
    targetDifficulty: options?.targetDifficulty,
  })) {
    return false;
  }

  const skipPattern = options?.skipPattern || {};
  const highSkippedCategories = getTopSkippedCategories(skipPattern, 2);
  if (!highSkippedCategories.length) {
    return true;
  }

  return highSkippedCategories.every((category) => {
    const originalCount = originalTasks.filter((task) => task.task_type === category).length;
    const candidateCount = candidateTasks.filter((task) => task.task_type === category).length;
    return candidateCount <= originalCount;
  });
}