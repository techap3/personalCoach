import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { getSupabaseClient } from "../db/supabase";
import { generateAdaptedTasks } from "../services/ai/adaptTasks";

const router = Router();

const getLocalDateString = () => {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  )
    .toISOString()
    .split("T")[0];
};

router.post("/", authMiddleware, async (req: AuthRequest, res) => {
  const { goal_id } = req.body;

  const supabase = getSupabaseClient(req.token!);

  try {
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

    if (!pendingTasks.length) {
      return res.status(400).json({ error: "No pending tasks" });
    }

    // 2. AI
    const aiResult = await generateAdaptedTasks({
      tasks: pendingTasks,
      metrics: {
        completionRate,
        done,
        skipped,
      },
      history: tasks.slice(-10),
    });

    if (!aiResult?.updated_tasks?.length) {
      throw new Error("AI returned empty tasks");
    }

    let adapted = aiResult.updated_tasks;

    // ensure same length
    adapted = adapted.slice(0, pendingTasks.length);

    while (adapted.length < pendingTasks.length) {
      adapted.push(pendingTasks[adapted.length]);
    }

    // 3. Archive old
    const ids = pendingTasks.map((t) => t.id);

    await supabase
      .from("tasks")
      .update({ status: "archived" })
      .in("id", ids);

    const today = getLocalDateString();

    const { data: activeSessions } = await supabase
      .from("task_sessions")
      .select("*")
      .eq("goal_id", goal_id)
      .eq("session_date", today)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1);

    const activeSession = activeSessions?.[0] ?? null;

    if (!activeSession?.id) {
      return res.status(400).json({ error: "No active session for adaptation" });
    }

    // 🔥 FIX: preserve plan_step_id
    const newTasks = adapted.map((t: any, index: number) => ({
      goal_id,
      session_id: activeSession.id,
      title: t.title,
      description: t.description,
      difficulty: t.difficulty,
      status: "pending",
      scheduled_date: today,
      plan_step_id: pendingTasks[index]?.plan_step_id,
    }));

    const hasOrphanTask = newTasks.some(
      (t: any) => !t.session_id || !t.plan_step_id
    );

    if (hasOrphanTask) {
      return res.status(500).json({ error: "Task linkage error: missing session_id or plan_step_id" });
    }

    const { data: inserted } = await supabase
      .from("tasks")
      .insert(newTasks)
      .select();

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