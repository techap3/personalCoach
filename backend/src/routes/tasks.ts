import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { getSupabaseClient } from "../db/supabase";
import { generateTasks } from "../services/ai/taskGenerator";
import { generateAdaptedTasks } from "../services/ai/adaptTasks";
import { computeMetrics } from "../services/metrics";
import {
  updateUserMemory,
  getUserMemory,
} from "../services/memory/userMemory";

const router = Router();

/* =========================
   GENERATE TASKS
========================= */
router.post("/generate", authMiddleware, async (req: AuthRequest, res) => {
  const { goal_id } = req.body;
  const supabase = getSupabaseClient(req.token!);

  const { data: existing } = await supabase
    .from("tasks")
    .select("*")
    .eq("goal_id", goal_id)
    .eq("status", "pending");

  if (existing?.length) {
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

  return res.json({ tasks: toInsert });
});

/* =========================
   UPDATE TASK
========================= */
router.post("/update", authMiddleware, async (req: AuthRequest, res) => {
  const { task_id, status } = req.body;

  if (!task_id || !status) {
    return res.status(400).json({ error: "task_id and status required" });
  }

  const supabase = getSupabaseClient(req.token!);

  // Prepare update data with timestamps
  let updateData: any = { status };
  const now = new Date().toISOString();

  if (status === "done") {
    updateData.completed_at = now;
    updateData.skipped_at = null;
  } else if (status === "skipped") {
    updateData.skipped_at = now;
    updateData.completed_at = null;
  } else if (status === "pending") {
    updateData.completed_at = null;
    updateData.skipped_at = null;
  }

  const { error } = await supabase
    .from("tasks")
    .update(updateData)
    .eq("id", task_id);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ success: true });
});

/* =========================
   FETCH TASKS
========================= */
router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  const { goal_id, status } = req.query;

  console.log("👉 FETCH goal_id:", goal_id);
  const supabase = getSupabaseClient(req.token!);
  const now = new Date();

    // ✅ force LOCAL date instead of UTC
    const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
    )
    .toISOString()
    .split("T")[0];

    console.log("🗓 Local today:", today);

  let query = supabase
    .from("tasks")
    .select("*")
    .eq("goal_id", goal_id)
    .or(`scheduled_date.eq.${today},scheduled_date.is.null`)
    .neq("status", "archived");

  if (status) {
    query = query.eq("status", status as string);
  }

  const { data, error } = await query;

  if (error) return res.status(500).json(error);

  console.log(
    `[GET /tasks] goal=${goal_id} today=${today} returned=${data?.length} tasks`,
    data?.map((t: any) => ({ id: t.id, scheduled_date: t.scheduled_date, status: t.status }))
  );

  res.json(data);
});

/* =========================
   ADAPT TASKS (WITH MEMORY)
========================= */
router.post("/adapt", authMiddleware, async (req: AuthRequest, res) => {
  const { goal_id } = req.body;
  const userId = req.user.id;

  const supabase = getSupabaseClient(req.token!);

  const { data: tasks } = await supabase
    .from("tasks")
    .select("*")
    .eq("goal_id", goal_id);

  if (!tasks?.length) {
    return res.status(400).json({ error: "No tasks found" });
  }

  const metrics = computeMetrics(tasks);

  // 🔥 UPDATE MEMORY FIRST
  await updateUserMemory(req.token!, userId, {
    ...metrics,
    total: tasks.length,
  });

  // 🔥 FETCH MEMORY
  const memory = await getUserMemory(req.token!, userId);

  const pendingTasks = tasks.filter((t) => t.status === "pending");

  if (!pendingTasks.length) {
    return res.status(400).json({ error: "No pending tasks" });
  }

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
      memory, // 🔥 KEY ADDITION
    });

    let adapted = aiResult.updated_tasks;

    // 🔥 HARD CONTROL
    adapted = adapted.slice(0, pendingTasks.length);

    while (adapted.length < pendingTasks.length) {
      adapted.push(pendingTasks[adapted.length]);
    }

    // 🔥 ARCHIVE OLD
    const ids = pendingTasks.map((t) => t.id);

    await supabase
      .from("tasks")
      .update({ status: "archived" })
      .in("id", ids);

    // 🔥 INSERT NEW
    const today = new Date().toISOString().split("T")[0];

    const newTasks = adapted.map((t: any) => ({
      goal_id,
      title: t.title,
      description: t.description,
      difficulty: t.difficulty,
      status: "pending",
      scheduled_date: today,
    }));

    const { data: inserted } = await supabase
      .from("tasks")
      .insert(newTasks)
      .select();

    return res.json({
      metrics,
      updated_tasks: inserted,
    });
  } catch (err) {
    return res.status(500).json({ error: "Adapt failed" });
  }
});

router.get("/summary", authMiddleware, async (req: AuthRequest, res) => {
  const { goal_id } = req.query;

  const supabase = getSupabaseClient(req.token!);

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  // 📊 Yesterday stats
  const { data: yesterdayTasks } = await supabase
    .from("tasks")
    .select("*")
    .eq("goal_id", goal_id)
    .eq("scheduled_date", yesterdayStr);

  const total = yesterdayTasks?.length || 0;
  const done = yesterdayTasks?.filter((t) => t.status === "done").length || 0;

  // 📅 Today tasks
  const { data: todayTasks } = await supabase
    .from("tasks")
    .select("*")
    .eq("goal_id", goal_id)
    .eq("scheduled_date", todayStr);

  return res.json({
    yesterday: {
      total,
      done,
      completionRate: total ? done / total : 0,
    },
    today: todayTasks || [],
  });
});

/* =========================
   FETCH ALL USER TASKS
========================= */
router.get("/all", authMiddleware, async (req: AuthRequest, res) => {
  const userId = req.user.id;

  const supabase = getSupabaseClient(req.token!);

  const { data, error } = await supabase
    .from("tasks")
    .select("id, goal_id, status, completed_at, skipped_at, created_at, scheduled_date, goals!inner(user_id)")
    .eq("goals.user_id", userId)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json(error);

  // Remove nested goals from response, return only tasks
  const tasks = data?.map(task => {
    const { goals, ...taskOnly } = task;
    return taskOnly;
  }) || [];

  console.log(`📊 FETCH ALL TASKS: count=${tasks.length}`);

  res.json(tasks);
});

export default router;