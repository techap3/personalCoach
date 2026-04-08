import { normalizeTaskTitle } from "../utils/normalization";
import type { TaskType } from "../../../../../packages/types";

export const MIN_VALID_TASKS = 2;
export const MIN_TASKS = 3;
export const MAX_TASKS = 5;

const TASK_TYPES: TaskType[] = ["action", "learn", "reflect", "review", "plan"];
const SKIP_THRESHOLD = 3;
const LOW_CONSISTENCY_THRESHOLD = 0.34;
const HIGH_CONSISTENCY_THRESHOLD = 0.67;
const MIXED_COMPLETION_MIN = 0.3;
const MIXED_COMPLETION_MAX = 0.7;
const CATEGORY_FALLBACK_MAP: Record<string, string> = {
  running: "walking",
  gym: "home workout",
  reading: "short article",
  coding: "small coding task",
};

const ACTION_VERBS = [
  "write",
  "list",
  "build",
  "implement",
  "review",
  "analyze",
  "fix",
  "create",
  "plan",
  "summarize",
];

const OUTCOME_WORDS = [
  "write",
  "list",
  "create",
  "build",
  "summarize",
  "bullet",
  "outcome",
  "takeaway",
  "decision",
  "note",
  "change",
  "step",
  "plan",
];

const GOAL_REFERENCE_SYNONYMS = [
  "goal",
  "objective",
  "target",
  "milestone",
  "project",
  "step",
];

const GOAL_STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "to",
  "of",
  "for",
  "in",
  "on",
  "with",
  "at",
  "from",
  "by",
  "your",
  "my",
  "our",
]);

const BANNED_PHRASES = [
  "review progress",
  "learn one concept",
  "high diff task",
  "work on",
  "explore",
  "improve",
];

const FALLBACK_BY_TYPE: Record<TaskType, { title: string; description: string; difficulty: number }> = {
  action: {
    title: "Spend 10 minutes working on the current step and write 1 outcome",
    description: "Start now and capture one visible result tied to the current step.",
    difficulty: 2,
  },
  learn: {
    title: "Read one focused section and write 2 key takeaways",
    description: "Capture two practical points you can apply in your next attempt.",
    difficulty: 2,
  },
  reflect: {
    title: "Write 3 things that worked and 1 improvement from your last attempt",
    description: "Keep each point specific and tied to observable execution.",
    difficulty: 1,
  },
  review: {
    title: "Summarize today's progress in 3 bullet points",
    description: "Make each bullet concrete and tied to completed work.",
    difficulty: 1,
  },
  plan: {
    title: "Plan the next 2 concrete steps for the current step",
    description: "Choose steps you can start immediately and define one success check for each.",
    difficulty: 2,
  },
};

const FALLBACK_VARIANTS: Record<TaskType, Array<{ title: string; description: string; difficulty: number }>> = {
  action: [
    {
      title: "Spend 10 minutes working on the current step and write 1 outcome",
      description: "Start now and capture one visible result tied to the current step.",
      difficulty: 2,
    },
    {
      title: "Complete 1 concrete step and note what changed in one sentence",
      description: "Pick a concrete micro-step and record the observable change.",
      difficulty: 2,
    },
  ],
  learn: [
    {
      title: "Read one focused section and write 2 key takeaways",
      description: "Capture two practical points you can apply in your next attempt.",
      difficulty: 2,
    },
    {
      title: "Analyze one short example and list 2 practical lessons",
      description: "Use lessons that directly guide your next action.",
      difficulty: 2,
    },
  ],
  reflect: [
    {
      title: "Write 3 things that worked and 1 improvement from your last attempt",
      description: "Keep each point specific and tied to observable execution.",
      difficulty: 1,
    },
    {
      title: "List 2 mistakes and 1 correction you will apply next",
      description: "Base this on concrete evidence from your recent attempt.",
      difficulty: 1,
    },
  ],
  review: [
    {
      title: "Summarize today's progress in 3 bullet points",
      description: "Make each bullet concrete and tied to completed work.",
      difficulty: 1,
    },
    {
      title: "Review 3 completed actions and write 1 clear next decision",
      description: "Use this decision to define tomorrow's first move.",
      difficulty: 1,
    },
  ],
  plan: [
    {
      title: "Plan 2 concrete steps for the current step and execute the first one",
      description: "Define one success check per step and complete the first step immediately.",
      difficulty: 3,
    },
    {
      title: "Plan 2 priorities for the current step and evaluate one immediate outcome",
      description: "Pick two priorities, execute one action now, and evaluate the observed outcome.",
      difficulty: 3,
    },
  ],
};

const HARD_FALLBACK_VARIANTS: Record<TaskType, Array<{ title: string; description: string; difficulty: number }>> = {
  action: [
    {
      title: "Implement one concrete output for the current step and test 1 acceptance check",
      description: "Ship a specific output and record one pass/fail check tied to the current step.",
      difficulty: 3,
    },
    {
      title: "Build one focused deliverable for the current step and document 2 results",
      description: "Create a concrete deliverable and record two measurable outcomes.",
      difficulty: 3,
    },
  ],
  learn: [
    {
      title: "Analyze one implementation example and extract 3 execution rules",
      description: "Use the rules immediately on your next concrete step.",
      difficulty: 3,
    },
  ],
  reflect: [
    {
      title: "Analyze 2 execution failures and design 1 prevention rule",
      description: "Ground the prevention rule in concrete evidence from your last attempt.",
      difficulty: 3,
    },
  ],
  review: [
    {
      title: "Review 3 completed actions and write 1 ranked decision",
      description: "Write one ranked decision that clearly changes your next move.",
      difficulty: 3,
    },
    {
      title: "Review tradeoffs in the current step and produce 1 decision note",
      description: "Compare options and produce one decision note with clear rationale.",
      difficulty: 3,
    },
  ],
  plan: [
    {
      title: "Plan 3 execution steps, execute step 1, and record 1 success check",
      description: "Sequence three specific steps and define one validation for each.",
      difficulty: 3,
    },
    {
      title: "Design a 3-step execution plan and evaluate the first outcome",
      description: "Include two concrete risk controls to keep execution on track.",
      difficulty: 3,
    },
  ],
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
  const variations = [
    baseTitle,
    `${baseTitle} with one clear constraint`,
    `${baseTitle} and compare 2 options`,
    `${baseTitle} and capture 1 measurable outcome`,
    `${baseTitle} with a different execution path`,
  ];

  for (const candidate of variations) {
    const normalized = normalizeTaskTitle(candidate);
    if (!existingNormalizedTitles.has(normalized) && !blockedNormalizedTitles.has(normalized)) {
      existingNormalizedTitles.add(normalized);
      return candidate;
    }
  }

  const fallback = `${baseTitle} and produce 1 decision note`;
  existingNormalizedTitles.add(normalizeTaskTitle(fallback));
  return fallback;
}

function isFillerStepTitle(stepTitle?: string) {
  const text = String(stepTitle || "").trim().toLowerCase();
  return /^(small|next|current)\s+step$/.test(text);
}

function buildContextLabel(goalContext?: string, stepTitle?: string) {
  const goal = String(goalContext || "").trim();
  const step = String(stepTitle || "").trim();

  const goalNorm = normalizeTextForMatching(goal);
  const stepNorm = normalizeTextForMatching(step);
  const isDuplicate = goalNorm.length > 0 && goalNorm === stepNorm;
  const stepAllowed = step.length > 0 && !isFillerStepTitle(step) && !isDuplicate;

  if (goal && stepAllowed) return `${goal}: ${step}`;
  if (goal) return goal;
  if (stepAllowed) return step;
  return "current step";
}

function containsContext(text: string, context: string) {
  const normalizedText = normalizeTextForMatching(text);
  const normalizedContext = normalizeTextForMatching(context);
  if (!normalizedContext) return false;
  return normalizedText.includes(normalizedContext);
}

function buildFallbackTaskByType(
  taskType: TaskType,
  existingNormalizedTitles: Set<string>,
  blockedNormalizedTitles: Set<string>,
  goalContext?: string,
  stepTitle?: string,
  targetDifficulty?: number
): GeneratedTask {
  const variants = targetDifficulty === 3
    ? HARD_FALLBACK_VARIANTS[taskType]
    : FALLBACK_VARIANTS[taskType];
  const randomIndex =
    (existingNormalizedTitles.size + taskType.length) % variants.length;
  const fallback = variants[randomIndex] ?? FALLBACK_BY_TYPE[taskType];
  const context = buildContextLabel(goalContext, stepTitle);
  let candidateTitle = fallback.title;

  if (context && !containsContext(candidateTitle, context)) {
    candidateTitle = `${candidateTitle} for ${context}`;
  }

  const uniqueTitle = buildUniqueTitle(
    candidateTitle,
    existingNormalizedTitles,
    blockedNormalizedTitles
  );

  return {
    ...fallback,
    title: uniqueTitle,
    description: context && !containsContext(fallback.description, context)
      ? `${fallback.description} Context: ${context}.`
      : fallback.description,
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
      plan: 0,
    } as Record<TaskType, number>
  );
}

function normalizeTextForMatching(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractGoalKeywords(goalContext?: string) {
  if (!goalContext) return [];
  return normalizeTextForMatching(goalContext)
    .split(" ")
    .filter((token) => token.length >= 4 && !GOAL_STOP_WORDS.has(token));
}

function hasGoalReference(task: GeneratedTask, goalContext?: string) {
  const text = normalizeTextForMatching(`${task.title} ${task.description || ""}`);
  const hasSynonym = GOAL_REFERENCE_SYNONYMS.some((synonym) =>
    new RegExp(`\\b${synonym}\\b`, "i").test(text)
  );

  const keywords = extractGoalKeywords(goalContext);
  const hasGoalKeyword = keywords.some((keyword) =>
    new RegExp(`\\b${keyword}\\b`, "i").test(text)
  );

  return hasSynonym || hasGoalKeyword;
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

export function isValidTaskQuality(task: GeneratedTask, options?: { goalContext?: string }): boolean {
  const title = String(task.title || "").trim();
  const titleLower = title.toLowerCase();
  const text = `${title} ${task.description || ""}`.toLowerCase();

  if (title.length < 25) return false;

  const wordCount = title.split(/\s+/).filter(Boolean).length;
  if (wordCount < 6) return false;

  if (/\btask\s+[a-z]\b/i.test(title)) return false;

  const hasVerbAndObject = ACTION_VERBS.some((verb) =>
    new RegExp(`\\b${verb}\\b\\s+[a-z0-9]`, "i").test(text)
  );
  if (!hasVerbAndObject) return false;

  if (
    BANNED_PHRASES.some((phrase) =>
      new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i").test(titleLower)
    )
  ) {
    return false;
  }

  if (!hasGoalReference(task, options?.goalContext)) return false;

  const hasNumber = /\b\d+\b/.test(text);
  const hasOutcomeWord = OUTCOME_WORDS.some((word) => new RegExp(`\\b${word}\\b`, "i").test(text));

  return hasNumber || hasOutcomeWord;
}

export function filterTaskQuality(
  tasks: GeneratedTask[],
  options?: { goalContext?: string }
): { tasks: GeneratedTask[]; rejectedCount: number } {
  const accepted: GeneratedTask[] = [];
  let rejectedCount = 0;

  for (const task of tasks) {
    if (isValidTaskQuality(task, options)) {
      accepted.push(task);
    } else {
      rejectedCount += 1;
    }
  }

  return { tasks: accepted, rejectedCount };
}

function hasMultiStepSignal(text: string) {
  return /\b(then|after that|next,|next step|followed by|and then)\b/i.test(text);
}

function isDifficultyRealisticTask(task: GeneratedTask) {
  const title = String(task.title || "").trim();
  const description = String(task.description || "").trim();
  const text = `${title} ${description}`.toLowerCase();
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  if (task.difficulty === 1) {
    if (/\b(implement|build)\b/i.test(text)) return false;
    if (hasMultiStepSignal(text)) return false;
  }

  if (task.difficulty >= 3) {
    const trivial = /\b(open|read|look|check|review)\b/i.test(text) && !/\b(decide|create|implement|build|design|fix)\b/i.test(text);
    if (title.length < 30 || wordCount < 8) return false;
    if (trivial) return false;
  }

  return true;
}

export function filterTaskDifficultyRealism(tasks: GeneratedTask[]) {
  const accepted: GeneratedTask[] = [];
  let rejectedCount = 0;

  for (const task of tasks) {
    if (isDifficultyRealisticTask(task)) {
      accepted.push(task);
    } else {
      rejectedCount += 1;
    }
  }

  return { tasks: accepted, rejectedCount };
}

export function buildDeterministicFallbackTasks(stepTitle?: string, goalContext?: string): GeneratedTask[] {
  const context = buildContextLabel(goalContext, stepTitle);

  return [
    {
      title: `Implement one focused action for ${context} and verify one result`,
      description: `Complete one concrete action and capture one verifiable outcome for ${context}.`,
      difficulty: 2,
      task_type: "action",
    },
    {
      title: `Plan 2 execution steps for ${context} and execute step 1`,
      description: `Decide two concrete next steps for ${context}, execute the first one, and evaluate one outcome.`,
      difficulty: 2,
      task_type: "plan",
    },
    {
      title: `Learn one concept that unblocks your next action on ${context}`,
      description: `Study one focused concept related to ${context} and note two useful takeaways.`,
      difficulty: 2,
      task_type: "learn",
    },
    {
      title: `Review 3 completed actions for ${context} and write 1 next decision`,
      description: `Write a short output summary and one decision to guide your next session on ${context}.`,
      difficulty: 2,
      task_type: "review",
    },
  ];
}

export function enforceTaskTypeMix(
  input: unknown,
  options?: {
    blockedNormalizedTitles?: Set<string> | string[];
    desiredCount?: number;
    goalContext?: string;
    stepTitle?: string;
    targetDifficulty?: number;
  }
): GeneratedTask[] {
  const tasks = sanitizeGeneratedTasks(input);
  const requestedCount = Number(options?.desiredCount);
  const expectedCount = Number.isFinite(requestedCount)
    ? Math.max(MIN_VALID_TASKS, Math.min(MAX_TASKS, Math.round(requestedCount)))
    : null;

  const blockedTitles = new Set(
    Array.isArray(options?.blockedNormalizedTitles)
      ? options?.blockedNormalizedTitles
      : Array.from(options?.blockedNormalizedTitles ?? [])
  );

  const existingTitles = new Set(tasks.map((task) => normalizeTaskTitle(task.title)));

  const replaceTaskWithType = (index: number, taskType: TaskType) => {
    tasks[index] = buildFallbackTaskByType(
      taskType,
      existingTitles,
      blockedTitles,
      options?.goalContext,
      options?.stepTitle,
      options?.targetDifficulty
    );
  };

  const getSafeReplaceIndex = (
    requiredType: TaskType,
    preserveReflective = false
  ) => {
    const actionCount = tasks.filter((task) => task.task_type === "action").length;
    const reflectiveCount = tasks.filter(
      (task) => task.task_type === "reflect" || task.task_type === "review"
    ).length;

    const index = tasks.findIndex((task) => {
      if (task.task_type === requiredType) return false;
      if (task.task_type === "action" && actionCount === 1) return false;
      if (
        preserveReflective &&
        (task.task_type === "reflect" || task.task_type === "review") &&
        reflectiveCount === 1
      ) {
        return false;
      }
      return true;
    });

    return index >= 0 ? index : 0;
  };

  const hasType = (type: TaskType) => tasks.some((task) => task.task_type === type);
  const hasReflective = () => hasType("reflect") || hasType("review");
  const hasPlan = () => hasType("plan");
  const requirePlan =
    (expectedCount !== null && expectedCount >= 4) ||
    (expectedCount === null && tasks.length >= 4);
  const targetDifficulty =
    typeof options?.targetDifficulty === "number" && Number.isFinite(options.targetDifficulty)
      ? Math.max(1, Math.min(3, Math.round(options.targetDifficulty)))
      : null;

  if (targetDifficulty === 1) {
    for (let i = 0; i < tasks.length; i += 1) {
      if (tasks[i].task_type !== "action" && tasks[i].task_type !== "reflect") {
        replaceTaskWithType(i, i % 2 === 0 ? "action" : "reflect");
      }
    }

    if (!hasType("action")) {
      replaceTaskWithType(0, "action");
    }

    if (!hasType("reflect")) {
      replaceTaskWithType(tasks.length > 1 ? 1 : 0, "reflect");
    }

    return tasks;
  }

  if (targetDifficulty === 2) {
    for (let i = 0; i < tasks.length; i += 1) {
      const type = tasks[i].task_type;
      if (type !== "action" && type !== "reflect" && type !== "review") {
        replaceTaskWithType(i, i % 2 === 0 ? "action" : "review");
      }
    }

    if (!hasType("action")) {
      replaceTaskWithType(0, "action");
    }

    if (!hasReflective()) {
      replaceTaskWithType(tasks.length > 1 ? 1 : 0, "review");
    }

    return tasks;
  }

  if (!tasks.length) {
    tasks.push(buildFallbackTaskByType("action", existingTitles, blockedTitles, options?.goalContext, options?.stepTitle, options?.targetDifficulty));
    tasks.push(buildFallbackTaskByType("plan", existingTitles, blockedTitles, options?.goalContext, options?.stepTitle, options?.targetDifficulty));
    tasks.push(buildFallbackTaskByType("review", existingTitles, blockedTitles, options?.goalContext, options?.stepTitle, options?.targetDifficulty));
    return tasks;
  }

  if (!hasType("action")) {
    replaceTaskWithType(getSafeReplaceIndex("action", true), "action");
  }

  if (!hasReflective()) {
    replaceTaskWithType(getSafeReplaceIndex("reflect"), "reflect");
  }

  if (requirePlan && !hasPlan()) {
    replaceTaskWithType(getSafeReplaceIndex("plan", true), "plan");
  }

  if (!hasType("action")) {
    replaceTaskWithType(getSafeReplaceIndex("action", true), "action");
  }

  if (expectedCount !== null && expectedCount >= 3) {
    if (!hasType("reflect")) {
      replaceTaskWithType(getSafeReplaceIndex("reflect"), "reflect");
    }

    if (!hasType("review")) {
      replaceTaskWithType(getSafeReplaceIndex("review"), "review");
    }

    if (expectedCount >= 4 && !hasType("plan")) {
      replaceTaskWithType(getSafeReplaceIndex("plan", true), "plan");
    }
  }

  return tasks;
}

function fillToMinimumTaskCount(
  tasks: GeneratedTask[],
  options?: {
    stepTitle?: string;
    goalContext?: string;
    targetDifficulty?: number;
    blockedNormalizedTitles?: Set<string> | string[];
  },
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

  const fallback = buildDeterministicFallbackTasks(options?.stepTitle, options?.goalContext);
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
    const candidateTitle = buildUniqueTitle(baseTask.title, existingTitles, blockedTitles);
    const normalizedCandidate = normalizeTaskTitle(candidateTitle);

    tasks.push({
      ...baseTask,
      title: candidateTitle,
    });
    existingTitles.add(normalizedCandidate);
    fallbackIndex += 1;
  }
}

function hasOutputOrMultiStep(task: GeneratedTask) {
  const text = `${task.title} ${task.description || ""}`.toLowerCase();
  const hasOutput = /\b(write|create|design|plan|implement|build|test|summarize|list)\b/i.test(text);
  const hasMultiStep = /\b(and|then|followed by)\b/i.test(text);
  return hasOutput || hasMultiStep;
}

function hasExecutionDecisionOrMultiStep(task: GeneratedTask) {
  const text = `${task.title} ${task.description || ""}`.toLowerCase();
  const hasExecution = /\b(execute|implement|build|test|ship|deliver|apply)\b/i.test(text);
  const hasDecision = /\b(decide|decision|evaluate|compare|rank|prioritize|choose)\b/i.test(text);
  const hasMultiStep = /\b(and|then|followed by)\b/i.test(text);
  return hasExecution || hasDecision || hasMultiStep;
}

function isHardDifficultyValid(task: GeneratedTask) {
  const text = `${task.title} ${task.description || ""}`.toLowerCase();
  const title = String(task.title || "").trim().toLowerCase();
  if (/\bspend\b/i.test(text)) return false;
  if (/\breflect\b/i.test(text)) return false;
  if (title.startsWith("list 2 mistakes and 1 correction")) return false;
  if (title.startsWith("implement one focused action")) return false;
  if (/\breview\b/i.test(text) && !/\b(write|create|design|plan|implement|build|test|summarize|list)\b/i.test(text)) {
    return false;
  }
  return hasOutputOrMultiStep(task) && hasExecutionDecisionOrMultiStep(task);
}

function enforceHardDifficultyQuality(
  tasks: GeneratedTask[],
  options?: {
    stepTitle?: string;
    goalContext?: string;
    blockedNormalizedTitles?: Set<string> | string[];
  }
) {
  const blockedTitles = new Set(
    Array.isArray(options?.blockedNormalizedTitles)
      ? options?.blockedNormalizedTitles
      : Array.from(options?.blockedNormalizedTitles ?? [])
  );
  const existingTitles = new Set(tasks.map((task) => normalizeTaskTitle(task.title)));
  const replacementTypes: TaskType[] = ["action", "plan", "review", "action", "plan"];

  for (let i = 0; i < tasks.length; i += 1) {
    if (tasks[i].task_type === "reflect" || !isHardDifficultyValid(tasks[i])) {
      const replacement = buildFallbackTaskByType(
        replacementTypes[i % replacementTypes.length],
        existingTitles,
        blockedTitles,
        options?.goalContext,
        options?.stepTitle,
        3
      );
      tasks[i] = { ...replacement, difficulty: 3 };
    } else {
      tasks[i] = { ...tasks[i], difficulty: Math.max(3, tasks[i].difficulty) };
    }
  }

  let signalCount = tasks.filter((task) => hasOutputOrMultiStep(task)).length;
  for (let i = 0; i < tasks.length && signalCount < 2; i += 1) {
    if (hasOutputOrMultiStep(tasks[i])) continue;
    const replacement = buildFallbackTaskByType(
      replacementTypes[(i + 1) % replacementTypes.length],
      existingTitles,
      blockedTitles,
      options?.goalContext,
      options?.stepTitle,
      3
    );
    tasks[i] = { ...replacement, difficulty: 3 };
    signalCount = tasks.filter((task) => hasOutputOrMultiStep(task)).length;
  }

  for (let i = 0; i < tasks.length; i += 1) {
    if (hasExecutionDecisionOrMultiStep(tasks[i])) continue;
    const replacement = buildFallbackTaskByType(
      replacementTypes[(i + 2) % replacementTypes.length],
      existingTitles,
      blockedTitles,
      options?.goalContext,
      options?.stepTitle,
      3
    );
    tasks[i] = { ...replacement, difficulty: 3 };
  }

  return tasks;
}

export function enforceTaskCount(
  input: unknown,
  options?: {
    stepTitle?: string;
    goalContext?: string;
    blockedNormalizedTitles?: Set<string> | string[];
    desiredCount?: number;
    targetDifficulty?: number;
  }
): GeneratedTask[] {
    const hasTargetDifficulty =
      typeof options?.targetDifficulty === "number" &&
      Number.isFinite(options.targetDifficulty);

  const requestedCount = Number(options?.desiredCount);
  const effectiveCount = Number.isFinite(requestedCount)
    ? Math.max(MIN_VALID_TASKS, Math.min(MAX_TASKS, Math.round(requestedCount)))
    : null;

  let working = sanitizeGeneratedTasks(input);
  if (effectiveCount === null && working.length > MAX_TASKS) {
    working = working.slice(0, MAX_TASKS);
  }
  if (effectiveCount !== null && working.length > effectiveCount) {
    working = working.slice(0, effectiveCount);
  }

  working = enforceTaskTypeMix(working, {
    goalContext: options?.goalContext,
    stepTitle: options?.stepTitle,
    blockedNormalizedTitles: options?.blockedNormalizedTitles,
    desiredCount: effectiveCount ?? undefined,
    targetDifficulty: options?.targetDifficulty,
  });

  if (hasTargetDifficulty) {
    working = enforceTargetDifficulty(working, options.targetDifficulty);
  }

  if (hasTargetDifficulty) {
    const difficultyFiltered = filterTaskDifficultyRealism(working);
    working = difficultyFiltered.tasks;
  }

  if (options?.targetDifficulty === 3) {
    working = enforceHardDifficultyQuality(working, options);
  }

  fillToMinimumTaskCount(
    working,
    options,
    effectiveCount ?? MIN_TASKS
  );

  working = enforceTaskTypeMix(working, {
    goalContext: options?.goalContext,
    stepTitle: options?.stepTitle,
    blockedNormalizedTitles: options?.blockedNormalizedTitles,
    desiredCount: effectiveCount ?? undefined,
    targetDifficulty: options?.targetDifficulty,
  });

  if (hasTargetDifficulty) {
    working = enforceTargetDifficulty(working, options.targetDifficulty);
  }

  fillToMinimumTaskCount(
    working,
    options,
    effectiveCount ?? MIN_TASKS
  );

  working = enforceTaskTypeMix(working, {
    goalContext: options?.goalContext,
    stepTitle: options?.stepTitle,
    blockedNormalizedTitles: options?.blockedNormalizedTitles,
    desiredCount: effectiveCount ?? undefined,
    targetDifficulty: options?.targetDifficulty,
  });

  if (
    isValidFinalTasks(working, {
      expectedCount: effectiveCount ?? undefined,
      targetDifficulty: options?.targetDifficulty,
    }) && (!hasTargetDifficulty || filterTaskDifficultyRealism(working).rejectedCount === 0)
  ) {
    return working;
  }

  const fallbackAttempts = 3;
  for (let attempt = 0; attempt < fallbackAttempts; attempt += 1) {
    let fallbackTasks = buildDeterministicFallbackTasks(options?.stepTitle, options?.goalContext);
    if (effectiveCount !== null && fallbackTasks.length > effectiveCount) {
      fallbackTasks = fallbackTasks.slice(0, effectiveCount);
    }

    fillToMinimumTaskCount(
      fallbackTasks,
      options,
      effectiveCount ?? MIN_TASKS
    );

    fallbackTasks = enforceTaskTypeMix(fallbackTasks, {
      goalContext: options?.goalContext,
      stepTitle: options?.stepTitle,
      blockedNormalizedTitles: options?.blockedNormalizedTitles,
      desiredCount: effectiveCount ?? undefined,
      targetDifficulty: options?.targetDifficulty,
    });

    if (hasTargetDifficulty) {
      fallbackTasks = enforceTargetDifficulty(fallbackTasks, options.targetDifficulty);
    }

    if (hasTargetDifficulty) {
      const fallbackDifficultyFiltered = filterTaskDifficultyRealism(fallbackTasks);
      fallbackTasks = fallbackDifficultyFiltered.tasks;
    }

    if (options?.targetDifficulty === 3) {
      fallbackTasks = enforceHardDifficultyQuality(fallbackTasks, options);
    }

    fillToMinimumTaskCount(
      fallbackTasks,
      options,
      effectiveCount ?? MIN_TASKS
    );

    fallbackTasks = enforceTaskTypeMix(fallbackTasks, {
      goalContext: options?.goalContext,
      stepTitle: options?.stepTitle,
      blockedNormalizedTitles: options?.blockedNormalizedTitles,
      desiredCount: effectiveCount ?? undefined,
      targetDifficulty: options?.targetDifficulty,
    });

    if (hasTargetDifficulty) {
      fallbackTasks = enforceTargetDifficulty(fallbackTasks, options.targetDifficulty);
    }

    if (
      isValidFinalTasks(fallbackTasks, {
        expectedCount: effectiveCount ?? undefined,
        targetDifficulty: options?.targetDifficulty,
      }) && (!hasTargetDifficulty || filterTaskDifficultyRealism(fallbackTasks).rejectedCount === 0)
    ) {
      return fallbackTasks;
    }
  }

  let guaranteed = buildDeterministicFallbackTasks(options?.stepTitle, options?.goalContext);
  if (effectiveCount !== null && guaranteed.length > effectiveCount) {
    guaranteed = guaranteed.slice(0, effectiveCount);
  }

  fillToMinimumTaskCount(
    guaranteed,
    options,
    effectiveCount ?? MIN_TASKS
  );

  guaranteed = enforceTaskTypeMix(guaranteed, {
    goalContext: options?.goalContext,
    stepTitle: options?.stepTitle,
    blockedNormalizedTitles: options?.blockedNormalizedTitles,
    desiredCount: effectiveCount ?? undefined,
    targetDifficulty: options?.targetDifficulty,
  });

  if (hasTargetDifficulty) {
    guaranteed = enforceTargetDifficulty(guaranteed, options.targetDifficulty);
  }

  if (options?.targetDifficulty === 3) {
    guaranteed = enforceHardDifficultyQuality(guaranteed, options);
  }

  const finalTasks = guaranteed;
  if (
    !isValidFinalTasks(finalTasks, {
      expectedCount: effectiveCount ?? undefined,
      targetDifficulty: options?.targetDifficulty,
    })
  ) {
    throw new Error("CRITICAL: invalid task set after enforcement");
  }

  return finalTasks;
}

export function enforceTargetDifficulty(input: GeneratedTask[], targetDifficulty: number): GeneratedTask[] {
  const clampedTarget = Math.max(1, Math.min(5, Math.round(targetDifficulty)));
  const minAllowed = Math.max(1, clampedTarget - 1);
  const maxAllowed = Math.min(5, clampedTarget + 1);
  return input.map((task) => ({
    ...task,
    difficulty: Math.max(minAllowed, Math.min(maxAllowed, Math.round(task.difficulty))),
  }));
}

function getTopSkippedCategories(skipPattern: Record<string, number>, limit = 2) {
  return Object.entries(skipPattern)
    .filter(([category, count]) => category !== "general" && count > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([category]) => category);
}

function isKnownTaskType(value: string): value is TaskType {
  return TASK_TYPES.includes(value as TaskType);
}

function pickReplacementType(excluded: Set<string>, fallback: TaskType) {
  const candidates: TaskType[] = ["action", "learn", "reflect", "review", "plan"];
  const safe = candidates.find((candidate) => !excluded.has(candidate));
  return safe ?? fallback;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceCategoryWithFallback(text: string, category: string, fallback: string) {
  const escaped = escapeRegExp(category);
  const matcher = new RegExp(`\\b${escaped}\\b`, "gi");
  return text.replace(matcher, fallback);
}

function safeTextMatch(task: GeneratedTask, category: string) {
  const escaped = escapeRegExp(category.toLowerCase());
  const matcher = new RegExp(`\\b${escaped}\\b`, "i");
  return matcher.test(`${task.title} ${task.description}`.toLowerCase());
}

function applySkipFallbackText(task: GeneratedTask, skipPattern: Record<string, number>) {
  let title = task.title;
  let description = task.description;
  let replaced = false;

  for (const [category, count] of Object.entries(skipPattern)) {
    const fallback = CATEGORY_FALLBACK_MAP[category];
    if (!fallback || count < SKIP_THRESHOLD) continue;

    const nextTitle = replaceCategoryWithFallback(title, category, fallback);
    const nextDescription = replaceCategoryWithFallback(description, category, fallback);

    if (nextTitle !== title || nextDescription !== description) {
      title = nextTitle;
      description = nextDescription;
      replaced = true;
    }
  }

  if (replaced && !description.includes("Low-friction alternative:")) {
    description = `${description} Low-friction alternative: keep it manageable and complete the smallest useful version.`;
  }

  return {
    title,
    description,
  };
}

function applyEffortScaling(
  task: GeneratedTask,
  options?: { consistencyScore?: unknown; completionRate?: unknown }
) {
  const consistency = Number(options?.consistencyScore);
  const completionRate = Number(options?.completionRate);

  if (Number.isFinite(consistency) && consistency < LOW_CONSISTENCY_THRESHOLD) {
    if (!task.description.includes("Keep effort small:")) {
      return {
        ...task,
        description: `${task.description} Keep effort small: aim for 10-15 focused minutes.`,
      };
    }
    return task;
  }

  if (Number.isFinite(consistency) && consistency > HIGH_CONSISTENCY_THRESHOLD) {
    if (!task.description.includes("Stretch: add")) {
      return {
        ...task,
        description: `${task.description} Stretch: add one extra focused pass if energy is high.`,
      };
    }
    return task;
  }

  if (
    Number.isFinite(completionRate) &&
    completionRate >= MIXED_COMPLETION_MIN &&
    completionRate <= MIXED_COMPLETION_MAX
  ) {
    if (!task.description.includes("Keep scope tight:")) {
      return {
        ...task,
        description: `${task.description} Keep scope tight: one concrete deliverable only.`,
      };
    }
  }

  return task;
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
      ? Math.max(MIN_VALID_TASKS, Math.min(MAX_TASKS, Math.round(expectedCount)))
      : null;

  if (clampedExpected !== null) {
    return tasks.length === clampedExpected;
  }

  return tasks.length >= MIN_TASKS && tasks.length <= MAX_TASKS;
}

function hasRequiredTypes(tasks: GeneratedTask[], expectedCount?: number) {
  const clampedExpected =
    typeof expectedCount === "number" && Number.isFinite(expectedCount)
      ? Math.max(MIN_VALID_TASKS, Math.min(MAX_TASKS, Math.round(expectedCount)))
      : null;

  const hasAction = tasks.some((task) => task.task_type === "action");
  const hasReflect = tasks.some((task) => task.task_type === "reflect");
  const hasReview = tasks.some((task) => task.task_type === "review");
  const hasPlan = tasks.some((task) => task.task_type === "plan");

  if (clampedExpected === 2) {
    return hasAction && (hasReflect || hasReview);
  }

  if (clampedExpected === 3) {
    return hasAction && (hasReflect || hasReview);
  }

  if (clampedExpected !== null && clampedExpected >= 3) {
    return hasAction && hasReflect && hasReview && hasPlan;
  }

  return hasAction && (hasReflect || hasReview);
}

function hasRequiredTypesForDifficulty(tasks: GeneratedTask[], targetDifficulty?: number) {
  if (typeof targetDifficulty !== "number" || !Number.isFinite(targetDifficulty)) {
    return true;
  }

  const normalizedDifficulty = Math.max(1, Math.min(3, Math.round(targetDifficulty)));

  if (normalizedDifficulty === 1) {
    const onlyAllowed = tasks.every((task) => task.task_type === "action" || task.task_type === "reflect");
    const hasAction = tasks.some((task) => task.task_type === "action");
    const hasReflect = tasks.some((task) => task.task_type === "reflect");
    return onlyAllowed && hasAction && hasReflect;
  }

  if (normalizedDifficulty === 2) {
    const onlyAllowed = tasks.every(
      (task) => task.task_type === "action" || task.task_type === "reflect" || task.task_type === "review"
    );
    const hasAction = tasks.some((task) => task.task_type === "action");
    const hasReflective = tasks.some((task) => task.task_type === "reflect" || task.task_type === "review");
    return onlyAllowed && hasAction && hasReflective;
  }

  return tasks.some((task) => /\b(plan|build|implement|analyze)\b/i.test(`${task.title} ${task.description || ""}`));
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
    const minAllowed = Math.max(1, clamped - 1);
    const maxAllowed = Math.min(5, clamped + 1);
    return tasks.every((task) => task.difficulty >= minAllowed && task.difficulty <= maxAllowed);
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
  const hasTargetDifficulty =
    typeof options?.targetDifficulty === "number" && Number.isFinite(options.targetDifficulty);

  return (
    hasValidCount(tasks, options?.expectedCount) &&
    (!hasTargetDifficulty || hasRequiredTypesForDifficulty(tasks, options?.targetDifficulty)) &&
    (hasTargetDifficulty || hasRequiredTypes(tasks, options?.expectedCount)) &&
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
    consistencyScore?: unknown;
    completionRate?: unknown;
    originalTasks?: GeneratedTask[];
  }
) {
  if (!input.length) return [];
  const skipPattern = options?.skipPattern || {};

  return input.map((task) => {

    const withSkipFallback = applySkipFallbackText(task, skipPattern);
    const effortScaled = applyEffortScaling(
      {
        ...task,
        title: withSkipFallback.title,
        description: withSkipFallback.description,
      },
      {
        consistencyScore: options?.consistencyScore,
        completionRate: options?.completionRate,
      }
    );

    return {
      ...effortScaled,
      // Preserve semantic task type; only adapt wording/effort.
      task_type: task.task_type,
      // Keep route-calibrated difficulty (bonus/high-performance logic) intact.
      difficulty: effortScaled.difficulty,
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
  const expectedCount = options?.expectedCount;

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
    const hasCategory = (task: GeneratedTask) => {
      if (isKnownTaskType(category)) {
        return task.task_type === category;
      }

      return safeTextMatch(task, category);
    };

    const originalCount = originalTasks.filter(hasCategory).length;
    const candidateCount = candidateTasks.filter(hasCategory).length;
    return candidateCount <= originalCount;
  });
}