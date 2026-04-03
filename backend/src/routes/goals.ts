import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { getSupabaseClient } from "../db/supabase";
import { generatePlan } from "../services/ai";

const router = Router();


router.post("/", authMiddleware, async (req: AuthRequest, res) => {
  const { title, description } = req.body;

  const supabase = getSupabaseClient(req.token!);

  // get user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // insert goal
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

  if (goalError) return res.status(500).json(goalError);

  // generate plan
  let plan;
  try {
    plan = await generatePlan(title);
  } catch (err) {
    console.error("PLAN ERROR:", err); // 👈 ADD THIS
    return res.status(500).json({ error: "Plan generation failed" });
  }

  // store plan
  const { data: planRecord, error: planError } = await supabase
    .from("plans")
    .insert([{ goal_id: goal.id, plan_json: plan }])
    .select()
    .single();

  if (planError) return res.status(500).json(planError);

  // insert plan_steps so the progression engine can track them
  if (Array.isArray(plan?.plan)) {
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
      console.error("⚠️  plan_steps insert failed:", stepsError.message);
      // non-fatal – plan is still usable
    }
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

export default router;