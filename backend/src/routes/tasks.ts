import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { getSupabaseClient } from "../db/supabase";
import { generateTasks } from "../services/ai/taskGenerator";
import { parseTasks } from "../services/ai/taskParser";
import { generateAdaptedTasks } from "../services/ai/adaptTasks";
import { parseAdaptedTasks } from "../services/ai/taskAdaptParser";
import { computeMetrics } from "../services/metrics";

const router = Router();

router.post("/generate", authMiddleware, async (req: AuthRequest, res) => {
  const { goal_id } = req.body;

  console.log(`🎯 GENERATE TASKS: Starting for goal_id=${goal_id}`);

  const supabase = getSupabaseClient(req.token!);

  // get plan
  const { data: planData, error: planError } = await supabase
    .from("plans")
    .select("*")
    .eq("goal_id", goal_id)
    .maybeSingle();

  if (planError) {
    console.error(`❌ GENERATE TASKS: Failed to fetch plan for goal_id=${goal_id}`, planError);
    return res.status(500).json({ error: "Failed to fetch plan" });
  }

  if (!planData) {
    console.warn(`⚠️ GENERATE TASKS: No plan found for goal_id=${goal_id}`);
    return res.status(404).json({ error: "Plan not found. Generate a plan first." });
  }

  console.log(`📋 GENERATE TASKS: Found plan for goal_id=${goal_id}`);

  const rawTasks = await generateTasks(planData.plan_json);

  const parsed = parseTasks(rawTasks);

  console.log(`✅ GENERATE TASKS: Generated ${parsed.tasks.length} tasks for goal_id=${goal_id}`);

  // save tasks
  const today = new Date().toISOString().split("T")[0];

  const tasksToInsert = parsed.tasks.map((t: any) => ({
    ...t,
    goal_id,
    scheduled_date: today,
  }));

  await supabase.from("tasks").insert(tasksToInsert);

  console.log(`💾 GENERATE TASKS: Persisted ${tasksToInsert.length} tasks for goal_id=${goal_id}`);

  res.json(parsed);
});

router.post("/update", authMiddleware, async (req: AuthRequest, res) => {
  const { task_id, status } = req.body;

  console.log(`📝 UPDATE TASK: task_id=${task_id}, status=${status}`);

  if (!task_id || !status) {
    console.warn(`⚠️ UPDATE TASK: Missing task_id or status`);
    return res.status(400).json({ error: "task_id and status are required" });
  }

  const supabase = getSupabaseClient(req.token!);

  const { error } = await supabase
    .from("tasks")
    .update({ status })
    .eq("id", task_id);

  if (error) {
    console.error(`❌ UPDATE TASK: Failed for task_id=${task_id}:`, error);
    return res.status(500).json({ error: error.message || "Failed to update task" });
  }

  console.log(`✅ UPDATE TASK: Successfully updated task_id=${task_id} to status=${status}`);

  res.json({ success: true });
});

router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  const { goal_id, status } = req.query;

  const supabase = getSupabaseClient(req.token!);

  const today = new Date().toISOString().split("T")[0];

  let query = supabase
    .from("tasks")
    .select("*")
    .eq("goal_id", goal_id)
    .eq("scheduled_date", today);

  // Filter by status if provided
  if (status) {
    query = query.eq("status", status as string);
  }

  const { data, error } = await query;

  if (error) return res.status(500).json(error);

  console.log(
    `📋 FETCH TASKS: goal_id=${goal_id}, status=${status || "all"}, found=${data?.length || 0}`
  );

  res.json(data);
});

router.post("/adapt", authMiddleware, async (req: AuthRequest, res) => {
  const { goal_id } = req.body;

  console.log(`📝 ADAPT: Starting task adaptation for goal_id=${goal_id}`);

  const supabase = getSupabaseClient(req.token!);

  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("goal_id", goal_id);

  if (error) {
    console.error(`❌ ADAPT: Failed to fetch tasks for goal_id=${goal_id}`);
    return res.status(500).json({ error: "Failed to fetch tasks" });
  }

  if (!tasks || tasks.length === 0) {
    console.warn(`⚠️ ADAPT: No tasks found for goal_id=${goal_id}`);
    return res.status(400).json({
      error: "No tasks found. Generate tasks first.",
    });
  }

  const metrics = computeMetrics(tasks);

  console.log(
    `📊 ADAPT: Metrics - completionRate=${metrics.completionRate}, totalTasks=${tasks.length}`
  );

  const pendingTasks = tasks.filter((task) => task.status === "pending");

  if (pendingTasks.length === 0) {
    console.warn(`⚠️ ADAPT: No pending tasks for goal_id=${goal_id}`);
    return res.status(400).json({ error: "No pending tasks to adapt" });
  }

  console.log(
    `🎯 ADAPT: Processing ${pendingTasks.length} pending tasks for adaptation`
  );

  const recentHistory = tasks
    .sort((a: any, b: any) => {
      const dateA = new Date(a.scheduled_date || a.created_at || 0).getTime();
      const dateB = new Date(b.scheduled_date || b.created_at || 0).getTime();
      return dateB - dateA;
    })
    .slice(0, 10);

  try {
    const raw = await generateAdaptedTasks({
      tasks: pendingTasks,
      metrics,
      history: recentHistory,
    });

    const parsed = parseAdaptedTasks(raw, pendingTasks, metrics);

    // 🔥 Step 1: Mark existing pending tasks as archived
    const pendingTaskIds = pendingTasks.map((t) => t.id);

    const { error: archiveError } = await supabase
      .from("tasks")
      .update({ status: "archived" })
      .in("id", pendingTaskIds);

    if (archiveError) {
      console.error(
        `❌ ADAPT: Failed to archive pending tasks for goal_id=${goal_id}`,
        archiveError
      );
      return res.status(500).json({ error: "Failed to archive tasks" });
    }

    console.log(
      `📦 ADAPT: Archived ${pendingTasks.length} pending tasks for goal_id=${goal_id}`
    );

    // 🔥 Step 2: Insert new adapted tasks
    const today = new Date().toISOString().split("T")[0];
    const newTasks = parsed.updated_tasks.map((adaptedTask: any, index: number) => ({
      ...adaptedTask,
      goal_id,
      scheduled_date: today,
      status: "pending",
    }));

    const { error: insertError } = await supabase
      .from("tasks")
      .insert(newTasks);

    if (insertError) {
      console.error(
        `❌ ADAPT: Failed to insert adapted tasks for goal_id=${goal_id}`,
        insertError
      );
      return res.status(500).json({ error: "Failed to insert adapted tasks" });
    }

    console.log(
      `✅ ADAPT: Successfully created ${newTasks.length} adapted tasks for goal_id=${goal_id}`
    );

    return res.json({
      metrics,
      updated_tasks: parsed.updated_tasks,
    });
  } catch (err) {
    console.error(`❌ ADAPT: Error adapting tasks for goal_id=${goal_id}:`, err);

    return res.status(500).json({
      error: "Task adaptation failed",
    });
  }
});

export default router;