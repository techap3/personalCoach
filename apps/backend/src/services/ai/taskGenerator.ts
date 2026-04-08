import { getAIClient } from "./provider";
import { buildTaskPrompt, buildStepTaskPrompt } from "./prompts";
import { PlanResponse } from "./parser";
import {
  enforceTaskCount,
  sanitizeGeneratedTasks,
  type GeneratedTask,
} from "./taskLimits";

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
}): Promise<GeneratedTask[]> {
  const client = getAIClient();
  const model = process.env.AI_MODEL || "meta-llama/llama-3-8b-instruct";

  const response = await client.chat.completions.create({
    model,
    messages: buildStepTaskPrompt(
      {
        ...step,
        difficulty: options?.targetDifficulty ?? step.difficulty,
      },
      options?.previousTasks || [],
      options?.userMemory,
      options?.desiredCount
    ),
  });

  const raw = response.choices[0]?.message?.content || "";

  try {
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    const clean = raw.slice(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(clean);
    const aiTasks = (parsed.tasks || []) as GeneratedTask[];
    return sanitizeGeneratedTasks(aiTasks);
  } catch (err) {
    console.error("❌ Step task parse failed:", err);
    return [];
  }
}