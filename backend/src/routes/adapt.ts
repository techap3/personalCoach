import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { getSupabaseClient } from "../db/supabase";
import { computeMetrics } from "../services/metrics";
import { generateAdaptedPlan } from "../services/ai/adaptPlan";
import { parseAdaptedPlan } from "../services/ai/adaptParser";

const router = Router();

router.post("/", authMiddleware, async (req: AuthRequest, res) => {
  const { goal_id } = req.body;

  const supabase = getSupabaseClient(req.token!);

  // get plan
  const { data: planData, error: planError } = await supabase
    .from("plans")
    .select("*")
    .eq("goal_id", goal_id)
    .maybeSingle();

  if (planError) {
    console.error("Error fetching plan:", planError);
    return res.status(500).json({ error: "Failed to fetch plan" });
  }

  if (!planData) {
    console.log(`No plan found for goal_id: ${goal_id}`);
    return res.status(404).json({ error: "Plan not found for this goal" });
  }

  console.log(`Fetched plan for goal_id: ${goal_id}`);

  // get tasks
  const { data: tasks, error: tasksError } = await supabase
    .from("tasks")
    .select("*")
    .eq("goal_id", goal_id);

  if (tasksError) {
    console.error("Error fetching tasks:", tasksError);
    return res.status(500).json({ error: "Failed to fetch tasks" });
  }

  console.log(`Fetched ${tasks?.length || 0} tasks for goal_id: ${goal_id}`);

  const metrics = computeMetrics(tasks || []);

  try {
    const raw = await generateAdaptedPlan({
      plan: planData.plan_json,
      tasks: tasks || [],
      metrics,
    });

    const parsed = parseAdaptedPlan(raw, metrics);

    res.json({
      metrics,
      updated_plan: parsed.updated_plan,
    });
  } catch (err) {
    console.error("ADAPT ERROR:", err);

    res.status(500).json({
      error: "Adaptation failed",
    });
  }
});

export default router;