import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { getSupabaseClient } from "../db/supabase";

import { generateAdaptedTasks } from "../services/ai/adaptTasks";

const router = Router();

router.post("/", authMiddleware, async (req: AuthRequest, res) => {
  const { goal_id } = req.body;

  const supabase = getSupabaseClient(req.token!);

  try {
    console.log("\n🧠 ADAPT START:", goal_id);

    // 1. Fetch tasks
    const { data: tasks, error } = await supabase
      .from("tasks")
      .select("*")
      .eq("goal_id", goal_id);

    if (error) throw error;

    const done = tasks.filter((t) => t.status === "done").length;
    const skipped = tasks.filter((t) => t.status === "skipped").length;
    const total = tasks.length;

    const completionRate = total === 0 ? 0 : done / total;

    const pendingTasks = tasks.filter((t) => t.status === "pending");

    console.log("📊 Metrics:", {
      total,
      done,
      skipped,
      completionRate,
    });

    // 2. Call AI (ALREADY PARSED)
    const aiResult = await generateAdaptedTasks({
      tasks: pendingTasks,
      metrics: {
        completionRate,
        done,
        skipped,
      },
      history: tasks.slice(-10),
    });

    console.log("🤖 AI RESULT:", aiResult);

    // ❗ IMPORTANT: NO parseAdaptedPlan HERE

    if (!aiResult?.updated_tasks?.length) {
      throw new Error("AI returned empty tasks");
    }

    // 3. Archive old pending tasks
    await supabase
      .from("tasks")
      .update({ status: "archived" })
      .eq("goal_id", goal_id)
      .eq("status", "pending");

    // 4. Insert new tasks
    const newTasks = aiResult.updated_tasks.map((t: any) => ({
      goal_id,
      title: t.title,
      description: t.description,
      difficulty: t.difficulty,
      status: "pending",
    }));

    const { data: inserted } = await supabase
      .from("tasks")
      .insert(newTasks)
      .select();

    console.log("✅ Inserted tasks:", inserted);

    return res.json({
      metrics: { total, done, skipped, completionRate },
      updated_tasks: inserted,
    });
  } catch (err) {
    console.error("❌ ADAPT ERROR:", err);
    res.status(500).json({ error: "Adaptation failed" });
  }
});

export default router;