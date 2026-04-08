import { getAIClient } from "./provider";
import { buildTaskPrompt, buildStepTaskPrompt } from "./prompts";
import { PlanResponse } from "./parser";
import {
  enforceTaskCount,
  filterTaskQuality,
  sanitizeGeneratedTasks,
  type GeneratedTask,
} from "./taskLimits";
import { normalizeTaskTitle } from "./taskDedup";

function getTargetDifficulty(value?: number) {
  return Math.max(1, Math.min(3, Math.round(Number(value) || 2)));
}

function buildDifficultyFallbackTask(
  difficulty: number,
  goalContext: string,
  index: number
): GeneratedTask {
  const context = goalContext.trim() || "your goal";

  if (difficulty === 1) {
    const easyFallbacks: GeneratedTask[] = [
      {
        title: `Spend 10 minutes working on ${context}`,
        description: `Take one immediate action on ${context} and write 1 outcome.`,
        difficulty: 1,
        task_type: "action",
      },
      {
        title: `Write 1 blocker you faced while working on ${context}`,
        description: `Record one blocker and one concrete next action for ${context}.`,
        difficulty: 1,
        task_type: "reflect",
      },
    ];
    return easyFallbacks[index % easyFallbacks.length];
  }

  if (difficulty === 2) {
    const mediumFallbacks: GeneratedTask[] = [
      {
        title: `Write 3 blockers for ${context} and pick 1 to solve now`,
        description: `Choose one blocker and capture your first concrete move.`,
        difficulty: 2,
        task_type: "action",
      },
      {
        title: `Review ${context} progress in 3 clear bullets`,
        description: `Summarize what moved, what stalled, and what to do next.`,
        difficulty: 2,
        task_type: "review",
      },
      {
        title: `Reflect on 2 lessons from your recent ${context} work`,
        description: `Write two lessons and one adjustment for your next session.`,
        difficulty: 2,
        task_type: "reflect",
      },
    ];
    return mediumFallbacks[index % mediumFallbacks.length];
  }

  const hardFallbacks: GeneratedTask[] = [
    {
      title: `Plan the next 3 steps to move ${context} forward`,
      description: `Plan the sequence and define one success check for each step.`,
      difficulty: 3,
      task_type: "plan",
    },
    {
      title: `Implement one small feature for ${context} and test it`,
      description: `Build a focused change and verify expected behavior with one test.`,
      difficulty: 3,
      task_type: "action",
    },
    {
      title: `Analyze 3 issues slowing ${context} and decide the best fix`,
      description: `Compare three issues and pick one fix with clear reasoning.`,
      difficulty: 3,
      task_type: "review",
    },
  ];
  return hardFallbacks[index % hardFallbacks.length];
}

function passesDifficultyStructure(task: GeneratedTask, difficulty: number) {
  const text = `${task.title || ""} ${task.description || ""}`.toLowerCase();

  if (difficulty === 1) {
    if (task.task_type !== "action" && task.task_type !== "reflect") {
      return false;
    }
    if (/\b(plan|analyze|decide)\b/i.test(text)) {
      return false;
    }
    return true;
  }

  if (difficulty === 2) {
    if (task.task_type !== "action" && task.task_type !== "reflect" && task.task_type !== "review") {
      return false;
    }
    return true;
  }

  if (!/\b(plan|build|implement|analyze)\b/i.test(text)) {
    return false;
  }

  return true;
}

function enforceDifficultyStructure(
  input: GeneratedTask[],
  difficulty: number,
  goalContext: string
) {
  const normalizedDifficulty = getTargetDifficulty(difficulty);
  const base = Array.isArray(input) ? input : [];
  const replaced = base.map((task, index) => {
    const normalizedTask: GeneratedTask = {
      ...task,
      difficulty: normalizedDifficulty,
    };

    if (passesDifficultyStructure(normalizedTask, normalizedDifficulty)) {
      return normalizedTask;
    }

    return buildDifficultyFallbackTask(normalizedDifficulty, goalContext, index);
  });

  if (
    normalizedDifficulty === 3 &&
    !replaced.some((task) => /\b(plan|build|implement|analyze)\b/i.test(`${task.title} ${task.description}`))
  ) {
    replaced[0] = buildDifficultyFallbackTask(3, goalContext, 0);
  }

  return replaced;
}

type GeneratedTaskWithPlanStep = GeneratedTask & {
  plan_step_id: number;
};

function mapTasksToPlanSteps(
  tasks: GeneratedTask[],
  plan: PlanResponse
): GeneratedTaskWithPlanStep[] {
  const steps = Array.isArray(plan?.plan) ? plan.plan : [];

  return tasks.map((task, index) => {
    const stepIndex = steps.length > 0 ? index % steps.length : index;
    const step = steps[stepIndex] as any;
    const planStepId = Number(step?.id ?? stepIndex);

    return {
      ...task,
      plan_step_id: Number.isFinite(planStepId) ? planStepId : stepIndex,
    };
  });
}

export async function generateTasks(plan: PlanResponse) {
  const client = getAIClient();

  const model =
    process.env.AI_MODEL || "meta-llama/llama-3-8b-instruct";

  const response = await client.chat.completions.create({
    model,
    messages: buildTaskPrompt(plan),
  });

  const raw = response.choices[0]?.message?.content || "";

  // ✅ PARSE HERE (CRITICAL FIX)
  try {
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");

    const clean = raw.slice(jsonStart, jsonEnd + 1);

    const parsed = JSON.parse(clean);
    const parsedTasks = (parsed.tasks || []) as GeneratedTask[];
    const enforcedTasks = enforceTaskCount(parsedTasks);

    const mappedTasks = mapTasksToPlanSteps(enforcedTasks, plan);

    return mappedTasks;
  } catch (err) {
    console.error("❌ Task parse failed:", err);

    return mapTasksToPlanSteps(enforceTaskCount([]), plan);
  }
}

/* =========================
   GENERATE TASKS FOR A SINGLE PLAN STEP
   Used by the session-based progression engine.
========================= */
export async function generateTasksForStep(step: {
  title: string;
  description: string;
  difficulty: number;
}, options?: {
  previousTasks?: string[];
  targetDifficulty?: number;
  userMemory?: any;
  desiredCount?: number;
  goalContext?: string;
}): Promise<GeneratedTask[]> {
  const client = getAIClient();
  const model = process.env.AI_MODEL || "meta-llama/llama-3-8b-instruct";
  const effectiveDifficulty = options?.targetDifficulty ?? step.difficulty;
  const targetDifficulty = getTargetDifficulty(effectiveDifficulty);

  const parseRawTasks = (raw: string): GeneratedTask[] => {
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    const clean = raw.slice(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(clean);
    return (parsed.tasks || []) as GeneratedTask[];
  };

  const generateEasyTasks = async (): Promise<GeneratedTask[]> => {
    const response = await client.chat.completions.create({
      model,
      messages: buildStepTaskPrompt(
        {
          ...step,
          difficulty: targetDifficulty,
        },
        options?.previousTasks || [],
        options?.userMemory,
        options?.desiredCount,
        options?.goalContext,
        "easy"
      ),
    });

    return parseRawTasks(response.choices[0]?.message?.content || "");
  };

  const generateMediumTasks = async (): Promise<GeneratedTask[]> => {
    const response = await client.chat.completions.create({
      model,
      messages: buildStepTaskPrompt(
        {
          ...step,
          difficulty: targetDifficulty,
        },
        options?.previousTasks || [],
        options?.userMemory,
        options?.desiredCount,
        options?.goalContext,
        "medium"
      ),
    });

    return parseRawTasks(response.choices[0]?.message?.content || "");
  };

  const generateHardTasks = async (): Promise<GeneratedTask[]> => {
    const response = await client.chat.completions.create({
      model,
      messages: buildStepTaskPrompt(
        {
          ...step,
          difficulty: targetDifficulty,
        },
        options?.previousTasks || [],
        options?.userMemory,
        options?.desiredCount,
        options?.goalContext,
        "hard"
      ),
    });

    return parseRawTasks(response.choices[0]?.message?.content || "");
  };

  const processAiTasks = (aiTasks: GeneratedTask[]) => {
    const sanitized = sanitizeGeneratedTasks(aiTasks);
    const qualityFiltered = filterTaskQuality(sanitized, {
      goalContext: options?.goalContext || step.title,
    });

    const recentNormalizedTitles = new Set(
      (options?.previousTasks || []).map((title) => normalizeTaskTitle(title)).filter(Boolean)
    );

    const seen = new Set<string>();
    const deduped = qualityFiltered.tasks.filter((task) => {
      const normalized = normalizeTaskTitle(task.title);
      if (!normalized) return false;
      if (seen.has(normalized)) return false;
      if (recentNormalizedTitles.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });

    return {
      deduped,
      recentNormalizedTitles,
    };
  };

  try {
    const target = targetDifficulty;
    const aiTasks =
      target === 1
        ? await generateEasyTasks()
        : target === 3
        ? await generateHardTasks()
        : await generateMediumTasks();

    const { deduped, recentNormalizedTitles } = processAiTasks(aiTasks);

    const enforced = enforceTaskCount(deduped, {
      stepTitle: step.title,
      goalContext: options?.goalContext || step.title,
      blockedNormalizedTitles: recentNormalizedTitles,
      desiredCount: options?.desiredCount,
      targetDifficulty: options?.targetDifficulty,
    });

    return enforceDifficultyStructure(
      enforced,
      target,
      options?.goalContext || step.title
    );
  } catch (err) {
    console.error("❌ Step task parse failed:", err);
    return [];
  }
}