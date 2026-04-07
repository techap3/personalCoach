import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { getSupabaseClient } from "../db/supabase";
import { generatePlan } from "../services/ai";
import logger from "../logger";

const router = Router();

function isValidPlan(plan: any) {
  if (!plan || !Array.isArray(plan.plan) || plan.plan.length === 0) {
    return false;
  }

  return plan.plan.every((step: any) => {
    return (
      typeof step?.title === "string" &&
      step.title.trim().length > 0 &&
      typeof step?.description === "string" &&
      step.description.trim().length > 0 &&
      typeof step?.difficulty === "number" &&
      step.difficulty >= 1 &&
      step.difficulty <= 5
    );
  });
}

async function rollbackGoalCreation(supabase: any, goalId: string) {
  await supabase.from("plan_steps").delete().eq("goal_id", goalId);
  await supabase.from("plans").delete().eq("goal_id", goalId);
  await supabase.from("goals").delete().eq("id", goalId);
}


router.post("/", authMiddleware, async (req: AuthRequest, res) => {
  const { title, description } = req.body;

  const supabase = getSupabaseClient(req.token!);
  const reqLog = req.log ?? logger;

  // get user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // generate + validate plan first so we never persist orphan goals
  let plan;
  try {
    plan = await generatePlan(title);
  } catch (err) {
    reqLog.error({ event: "plan.generation.failed", error: err }, "Plan generation failed");
    return res.status(500).json({ error: "Plan generation failed" });
  }

  if (!isValidPlan(plan)) {
    return res.status(500).json({ error: "Plan validation failed" });
  }

  // persist goal + plan + plan_steps with rollback on any failure
  const { data: goal, error: goalError } = await supabase
    .from("goals")
    .insert([
      {
        title,
        description,
        user_id: user?.id,
      },
    ])
    .select()
    .single();

  if (goalError || !goal) return res.status(500).json(goalError || { error: "Goal creation failed" });

  // store plan
  const { data: planRecord, error: planError } = await supabase
    .from("plans")
    .insert([{ goal_id: goal.id, plan_json: plan }])
    .select()
    .single();

  if (planError || !planRecord) {
    await rollbackGoalCreation(supabase, goal.id);
    return res.status(500).json(planError || { error: "Plan persistence failed" });
  }

  // insert plan_steps so the progression engine can track them
  const planSteps = plan.plan.map((step: any, index: number) => ({
    plan_id: planRecord.id,
    goal_id: goal.id,
    step_index: index,
    title: step.title,
    description: step.description,
    difficulty: step.difficulty,
    status: index === 0 ? "active" : "pending",
  }));

  const { error: stepsError } = await supabase
    .from("plan_steps")
    .insert(planSteps);

  if (stepsError) {
    reqLog.error(
      { event: "plan.steps.insert_failed", error: stepsError.message, goal_id: goal.id },
      "Plan step insert failed"
    );
    await rollbackGoalCreation(supabase, goal.id);
    return res.status(500).json({ error: "Failed to create plan steps" });
  }

  res.json({ goal, plan });
});

router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  const supabase = getSupabaseClient(req.token!);

  const { data, error } = await supabase
    .from("goals")
    .select("*");

  if (error) return res.status(500).json(error);

  res.json(data);
});

router.post("/improve", authMiddleware, async (req: AuthRequest, res) => {
  return res.status(503).json({
    success: false,
    message: "Feature temporarily disabled",
  });
});

export default router;