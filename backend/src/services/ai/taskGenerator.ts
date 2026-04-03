import { getAIClient } from "./provider";
import { buildTaskPrompt } from "./prompts";
import { PlanResponse } from "./parser";

type GeneratedTask = {
  title: string;
  description: string;
  difficulty: number;
};

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

  console.log("🧠 TASK GEN RAW:", raw);

  // ✅ PARSE HERE (CRITICAL FIX)
  try {
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");

    const clean = raw.slice(jsonStart, jsonEnd + 1);

    const parsed = JSON.parse(clean);
    const parsedTasks = (parsed.tasks || []) as GeneratedTask[];

    const mappedTasks = mapTasksToPlanSteps(parsedTasks, plan);

    console.log("✅ Parsed Tasks:", parsed);

    console.log("✅ Mapped Tasks With plan_step_id:", mappedTasks);

    return mappedTasks;
  } catch (err) {
    console.error("❌ Task parse failed:", err);

    // fallback (very important for stability)
    return mapTasksToPlanSteps(
    [
        {
        title: "Start your first focused session",
        description: "Spend 20 minutes taking a concrete first step toward your goal",
        difficulty: 1,
        },
        {
        title: "Define a clear next milestone",
        description: "Write down one specific milestone you want to achieve next",
        difficulty: 2,
        },
    ],
    plan
    );
  }
}