import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { getSupabaseClient } from "../db/supabase";
import { generateTasks } from "../services/ai/taskGenerator";
import { generateAdaptedTasks } from "../services/ai/adaptTasks";
import { computeMetrics } from "../services/metrics";

const router = Router();

/* =========================
   GENERATE TASKS
========================= */
router.post("/generate", authMiddleware, async (req: AuthRequest, res) => {
  const { goal_id } = req.body;
  const supabase = getSupabaseClient(req.token!);

  console.log(`🎯 GENERATE TASKS: goal_id=${goal_id}`);

  // Prevent duplicate generation
  const { data: existing } = await supabase
    .from("tasks")
    .select("*")
    .eq("goal_id", goal_id)
    .eq("status", "pending");

  if (existing && existing.length > 0) {
    console.log("⚠️ Tasks already exist → skipping");
    return res.json({ tasks: existing });
  }

  const { data: plan } = await supabase
    .from("plans")
    .select("*")
    .eq("goal_id", goal_id)
    .maybeSingle();

  if (!plan) {
    return res.status(400).json({ error: "No plan found" });
  }

  const tasks = await generateTasks(plan.plan_json);

  const today = new Date().toISOString().split("T")[0];

  const toInsert = tasks.map((t: any) => ({
    ...t,
    goal_id,
    status: "pending",
    scheduled_date: today,
  }));

  await supabase.from("tasks").insert(toInsert);

  console.log(`✅ Inserted ${toInsert.length} tasks`);

  return res.json({ tasks: toInsert });
});

/* =========================
   UPDATE TASK STATUS
========================= */
router.post("/update", authMiddleware, async (req: AuthRequest, res) => {
  const { task_id, status } = req.body;

  console.log(`📝 UPDATE TASK: ${task_id} → ${status}`);

  if (!task_id || !status) {
    return res.status(400).json({ error: "task_id and status required" });
  }

  const supabase = getSupabaseClient(req.token!);

  const { error } = await supabase
    .from("tasks")
    .update({ status })
    .eq("id", task_id);

  if (error) {
    console.error("❌ Update failed", error);
    return res.status(500).json({ error: error.message });
  }

  return res.json({ success: true });
});

/* =========================
   FETCH TASKS
========================= */
router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  const { goal_id, status } = req.query;

  const supabase = getSupabaseClient(req.token!);
  const today = new Date().toISOString().split("T")[0];

  let query = supabase
    .from("tasks")
    .select("*")
    .eq("goal_id", goal_id)
    .eq("scheduled_date", today);

  if (status) {
    query = query.eq("status", status as string);
  }

  const { data, error } = await query;

  if (error) return res.status(500).json(error);

  console.log(
    `📋 FETCH TASKS: goal_id=${goal_id}, status=${status || "all"}, count=${data?.length || 0}`
  );

  res.json(data);
});

/* =========================
   ADAPT TASKS (FIXED CORE)
========================= */
router.post("/adapt", authMiddleware, async (req: AuthRequest, res) => {
  const { goal_id } = req.body;

  console.log(`🧠 ADAPT START: goal_id=${goal_id}`);

  const supabase = getSupabaseClient(req.token!);

  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("goal_id", goal_id);

  if (error) return res.status(500).json({ error: "Fetch failed" });

  if (!tasks?.length) {
    return res.status(400).json({ error: "No tasks found" });
  }

  const metrics = computeMetrics(tasks);

  const pendingTasks = tasks.filter((t) => t.status === "pending");

  if (!pendingTasks.length) {
    return res.status(400).json({ error: "No pending tasks" });
  }

  console.log(
    `📊 completionRate=${metrics.completionRate}, pending=${pendingTasks.length}`
  );

  const history = tasks
    .sort(
      (a: any, b: any) =>
        new Date(b.created_at).getTime() -
        new Date(a.created_at).getTime()
    )
    .slice(0, 10);

  try {
    const aiResult = await generateAdaptedTasks({
      tasks: pendingTasks,
      metrics,
      history,
    });

    if (!aiResult?.updated_tasks?.length) {
      throw new Error("Empty AI response");
    }

    /* =========================
       🔥 HARD CONTROL (IMPORTANT)
    ========================= */

    let adapted = aiResult.updated_tasks;

    // ✅ enforce SAME LENGTH
    adapted = adapted.slice(0, pendingTasks.length);

    while (adapted.length < pendingTasks.length) {
      adapted.push(pendingTasks[adapted.length]);
    }

    console.log(
      `🛠 Enforced task count: ${adapted.length} (was ${aiResult.updated_tasks.length})`
    );

    /* =========================
       ARCHIVE OLD TASKS
    ========================= */

    const ids = pendingTasks.map((t) => t.id);

    await supabase
      .from("tasks")
      .update({ status: "archived" })
      .in("id", ids);

    console.log(`📦 Archived ${ids.length} tasks`);

    /* =========================
       INSERT NEW TASKS
    ========================= */

    const today = new Date().toISOString().split("T")[0];

    const newTasks = adapted.map((t: any) => ({
      goal_id,
      title: t.title,
      description: t.description,
      difficulty: t.difficulty,
      status: "pending",
      scheduled_date: today,
    }));

    const { data: inserted, error: insertError } = await supabase
      .from("tasks")
      .insert(newTasks)
      .select();

    if (insertError) {
      console.error("❌ Insert failed", insertError);
      return res.status(500).json({ error: "Insert failed" });
    }

    console.log(`✅ Inserted ${inserted.length} tasks`);

    return res.json({
      metrics,
      updated_tasks: inserted,
    });
  } catch (err) {
    console.error("❌ ADAPT ERROR:", err);
    return res.status(500).json({ error: "Adapt failed" });
  }
});

export default router;