export const MIN_TASKS = 3;
export const MAX_TASKS = 5;

export type GeneratedTask = {
  title: string;
  description: string;
  difficulty: number;
};

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

  return {
    title,
    description,
    difficulty: clampDifficulty(maybeTask.difficulty),
  };
}

export function sanitizeGeneratedTasks(input: unknown): GeneratedTask[] {
  if (!Array.isArray(input)) return [];
  return input.map(toTask).filter((task): task is GeneratedTask => task !== null);
}

export function buildDeterministicFallbackTasks(stepTitle?: string): GeneratedTask[] {
  const context = stepTitle?.trim() || "your current step";

  return [
    {
      title: "Review the objective",
      description: `Spend 10 minutes clarifying what success looks like for ${context}.`,
      difficulty: 1,
    },
    {
      title: "Complete one concrete action",
      description: `Take one specific action that creates measurable progress on ${context}.`,
      difficulty: 2,
    },
    {
      title: "Reflect and queue the next move",
      description: "Write what you completed and define the next concrete action for your next session.",
      difficulty: 1,
    },
  ];
}

export function enforceTaskCount(
  input: unknown,
  options?: { stepTitle?: string; blockedNormalizedTitles?: Set<string> | string[] }
): GeneratedTask[] {
  const tasks = sanitizeGeneratedTasks(input);
  const bounded = tasks.slice(0, MAX_TASKS);
  const blockedTitles = new Set(
    Array.isArray(options?.blockedNormalizedTitles)
      ? options?.blockedNormalizedTitles
      : Array.from(options?.blockedNormalizedTitles ?? [])
  );

  const normalizeTitle = (title: string) =>
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

  if (bounded.length >= MIN_TASKS) {
    return bounded;
  }

  const fallback = buildDeterministicFallbackTasks(options?.stepTitle);
  const existingTitles = new Set(bounded.map((task) => normalizeTitle(task.title)));

  for (const fallbackTask of fallback) {
    if (bounded.length >= MIN_TASKS) break;
    const normalizedFallbackTitle = normalizeTitle(fallbackTask.title);

    if (!existingTitles.has(normalizedFallbackTitle) && !blockedTitles.has(normalizedFallbackTitle)) {
      bounded.push(fallbackTask);
      existingTitles.add(normalizedFallbackTitle);
    }
  }

  // Deterministic final guard in case titles already existed.
  let fallbackIndex = 0;
  while (bounded.length < MIN_TASKS) {
    const baseTask = fallback[fallbackIndex % fallback.length];
    let variantCounter = 2;
    let candidateTitle = baseTask.title;
    let normalizedCandidate = normalizeTitle(candidateTitle);

    while (existingTitles.has(normalizedCandidate) || blockedTitles.has(normalizedCandidate)) {
      candidateTitle = `${baseTask.title} ${variantCounter}`;
      normalizedCandidate = normalizeTitle(candidateTitle);
      variantCounter += 1;
    }

    bounded.push({
      ...baseTask,
      title: candidateTitle,
    });
    existingTitles.add(normalizedCandidate);
    fallbackIndex += 1;
  }

  return bounded.slice(0, MAX_TASKS);
}