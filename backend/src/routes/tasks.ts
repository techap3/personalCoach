import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { getSupabaseClient } from "../db/supabase";
import { generateTasksForStep } from "../services/ai/taskGenerator";
import {
  enforceTaskCount,
  enforceTargetDifficulty,
  getTaskTypeDistribution,
  MIN_TASKS,
  MAX_TASKS,
  sanitizeGeneratedTasks,
} from "../services/ai/taskLimits";
import {
  filterDuplicateTasks,
  normalizeTaskTitle,
} from "../services/ai/taskDedup";
import { generateAdaptedTasks } from "../services/ai/adaptTasks";
import { computeMetrics } from "../services/metrics";
import { runProgressionEngine } from "../services/progressionEngine";
import {
  updateUserMemory,
  getUserMemory,
} from "../services/memory/userMemory";
import { getTargetDifficulty } from "../services/difficultyService";
import { generateSessionSummary } from "../services/sessionSummary";

const router = Router();
const RECENT_SESSION_LOOKBACK = 5;
const ALLOWED_TASK_STATUSES = new Set(["pending", "done", "skipped"]);

/* =========================
   HELPERS
========================= */

async function getActiveStep(supabase: any, goal_id: string) {
  const { data } = await supabase
    .from("plan_steps")
    .select("*")
    .eq("goal_id", goal_id)
    .order("step_index", { ascending: true });

  return data?.find((s: any) => s.status !== "completed") ?? null;
}

async function getNextStepFrom(supabase: any, goal_id: string, stepIndex: number) {
  const { data } = await supabase
    .from("plan_steps")
    .select("*")
    .eq("goal_id", goal_id)
    .gt("step_index", stepIndex)
    .order("step_index", { ascending: true })
    .limit(1)
    .maybeSingle();

  return data ?? null;
}

async function getTodaySessionCount(supabase: any, goal_id: string, today: string) {
  const { data } = await supabase
    .from("task_sessions")
    .select("id")
    .eq("goal_id", goal_id)
    .eq("session_date", today);

  return data?.length ?? 0;
}

/* =========================
   DATE UTILS (SINGLE SOURCE)
========================= */

// Always LOCAL date (no timezone bugs)
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

const getYesterdayDateString = () => {
  const now = new Date();
  const yesterday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 1
  );

  return yesterday.toISOString().split("T")[0];
};

const getNowISOString = () => new Date().toISOString();

/* =========================
   GENERATE TASKS (SESSION-BASED)
========================= */
router.post("/generate", authMiddleware, async (req: AuthRequest, res) => {
  const { goal_id } = req.body;
  const goalId = goal_id as string;
  const supabase = getSupabaseClient(req.token!);
  const today = new Date().toISOString().split("T")[0];

  if (!goalId) {
    return res.status(400).json({ error: "goal_id required" });
  }

  // 1. Get the active plan step
  let activeStep = await getActiveStep(supabase, goalId);

  // Strict lock: never generate tasks for a completed step.
  if (activeStep?.status === "completed") {
    activeStep = await getNextStepFrom(supabase, goalId, activeStep.step_index);
  }

  if (!activeStep) {
    return res.status(400).json({ error: "No active step. Plan may be complete." });
  }

  console.log("ACTIVE STEP:", activeStep.id);
  console.log("STEP STATUS:", activeStep.status);

  const { data: existingSessions } = await supabase
    .from("task_sessions")
    .select("id")
    .eq("goal_id", goalId)
    .eq("plan_step_id", activeStep.id)
    .eq("session_date", today);

  if ((existingSessions?.length ?? 0) > 1) {
    console.warn("Multiple sessions detected - fix data", { goalId, stepId: activeStep.id, today });
  }

  const { data: session } = await supabase
    .from("task_sessions")
    .select("*")
    .eq("goal_id", goalId)
    .eq("plan_step_id", activeStep.id)
    .eq("session_date", today)
    .maybeSingle();

  console.log("SESSION CHECK:", {
    hasSession: !!session,
    sessionStatus: session?.status,
    stepId: activeStep.id,
  });

  let workingSession = session;

  if (workingSession && workingSession.status === "active") {
    const { data: tasks } = await supabase
      .from("tasks")
      .select("*")
      .eq("session_id", workingSession.id)
      .order("created_at", { ascending: true });

    if ((tasks || []).length === 0) {
      console.warn("[tasks] Found active session without tasks, marking failed for recovery", {
        goal_id: goalId,
        step_id: activeStep.id,
        session_id: workingSession.id,
      });

      await supabase
        .from("task_sessions")
        .update({ status: "failed" })
        .eq("id", workingSession.id);

      workingSession = {
        ...workingSession,
        status: "failed",
      };
    } else {
      return res.json({
        type: "ACTIVE_SESSION",
        session: workingSession,
        tasks: tasks || [],
      });
    }
  }

  if (!workingSession || workingSession.status === "completed" || workingSession.status === "failed") {
    console.log("CREATING OR REUSING SESSION FOR STEP");
  }

  // 2. Get the plan record (need plan.id for session)
  const { data: plan } = await supabase
    .from("plans")
    .select("*")
    .eq("goal_id", goalId)
    .maybeSingle();

  if (!plan) {
    return res.status(400).json({ error: "No plan found" });
  }

  // Upsert-style recovery path: attempt insert, recover by selecting existing on conflict.
  if (!workingSession || workingSession.status !== "active") {
    const { data: insertedSession, error: sessionError } = await supabase
      .from("task_sessions")
      .insert({
        goal_id: goalId,
        plan_id: plan.id,
        plan_step_id: activeStep.id,
        session_date: today,
        status: "active",
      })
      .select()
      .single();

    if (sessionError?.code === "23505") {
      const { data: existingSession } = await supabase
        .from("task_sessions")
        .select("*")
        .eq("goal_id", goalId)
        .eq("plan_step_id", activeStep.id)
        .eq("session_date", today)
        .maybeSingle();

      if (!existingSession) {
        return res.status(500).json({ error: "Session conflict detected but no session found" });
      }

      workingSession = existingSession;
    } else if (sessionError || !insertedSession) {
      return res.status(500).json({ error: sessionError?.message || "Failed to create session" });
    } else {
      workingSession = insertedSession;
    }
  }

  if (!workingSession) {
    return res.status(500).json({ error: "Failed to resolve active session" });
  }

  // If conflict reused an active session that already has tasks, reuse it.
  if (workingSession.status === "active") {
    const { data: existingSessionTasks } = await supabase
      .from("tasks")
      .select("*")
      .eq("session_id", workingSession.id)
      .order("created_at", { ascending: true });

    if ((existingSessionTasks || []).length > 0) {
      return res.json({
        type: "ACTIVE_SESSION",
        sessionStatus: "active",
        session: workingSession,
        tasks: existingSessionTasks,
      });
    }

    // Session exists but empty, recover by generating into the same session.
    await supabase
      .from("task_sessions")
      .update({ status: "active" })
      .eq("id", workingSession.id);
  }

  // Generate tasks only after session creation
  const { data: recentSessions } = await supabase
    .from("task_sessions")
    .select("id")
    .eq("goal_id", goalId)
    .neq("id", workingSession.id)
    .order("created_at", { ascending: false })
    .limit(RECENT_SESSION_LOOKBACK);

  const recentSessionIds = (recentSessions || []).map((session: any) => session.id);

  let recentTaskTitles: string[] = [];
  if (recentSessionIds.length > 0) {
    const { data: recentTasks } = await supabase
      .from("tasks")
      .select("title")
      .in("session_id", recentSessionIds);

    recentTaskTitles = (recentTasks || [])
      .map((task: any) => task.title)
      .filter((title: any) => typeof title === "string");
  }

  const recentNormalizedTitles = new Set(
    recentTaskTitles.map((title) => normalizeTaskTitle(title)).filter(Boolean)
  );

  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const difficultyResult = await getTargetDifficulty(supabase, userId, goalId, {
    lookbackSessions: RECENT_SESSION_LOOKBACK,
    defaultDifficulty: 2,
    currentDifficulty: activeStep.difficulty,
  });

  console.log("[tasks] Difficulty selection", {
    goal_id: goalId,
    completion_rate: difficultyResult.metrics.completion_rate,
    skip_rate: difficultyResult.metrics.skip_rate,
    chosen_difficulty: difficultyResult.targetDifficulty,
    used_default: difficultyResult.usedDefault,
  });

  let rawTaskCount = 0;
  let duplicatesRemoved = 0;
  let difficultyBalancedTasks: any[] = [];
  let typeDistribution = {
    action: 0,
    learn: 0,
    reflect: 0,
    review: 0,
  };

  try {
    const aiTasks = await generateTasksForStep(activeStep, {
      previousTasks: recentTaskTitles,
      targetDifficulty: difficultyResult.targetDifficulty,
    });

    rawTaskCount = Array.isArray(aiTasks) ? aiTasks.length : 0;
    const sanitizedTasks = sanitizeGeneratedTasks(aiTasks);
    const dedupResult = filterDuplicateTasks(
      sanitizedTasks,
      recentNormalizedTitles
    );
    duplicatesRemoved = dedupResult.removedCount;

    const generatedTasks = enforceTaskCount(dedupResult.tasks, {
      stepTitle: activeStep.title,
      blockedNormalizedTitles: recentNormalizedTitles,
    });
    difficultyBalancedTasks = enforceTargetDifficulty(
      generatedTasks,
      difficultyResult.targetDifficulty
    );

    typeDistribution = getTaskTypeDistribution(difficultyBalancedTasks);
  } catch (generationError: any) {
    await supabase
      .from("task_sessions")
      .update({ status: "failed" })
      .eq("id", workingSession.id);

    return res.status(500).json({
      error: generationError?.message || "Task generation failed",
    });
  }

  if (difficultyBalancedTasks.length < MIN_TASKS || difficultyBalancedTasks.length > MAX_TASKS) {
    console.error("Task cap enforcement violation", {
      rawTaskCount,
      finalTaskCount: difficultyBalancedTasks.length,
      goalId,
      stepId: activeStep.id,
    });
  }

  const tasksToInsert = difficultyBalancedTasks.map((t: any) => ({
    goal_id: goalId,
    plan_step_id: activeStep.id,
    session_id: workingSession.id,
    title: t.title,
    description: t.description,
    difficulty: t.difficulty,
    task_type: t.task_type,
    status: "pending",
    scheduled_date: today,
  }));

  const hasOrphanTask = tasksToInsert.some(
    (t: any) => !t.session_id || !t.plan_step_id
  );

  if (hasOrphanTask) {
    return res.status(500).json({ error: "Task linkage error: missing session_id or plan_step_id" });
  }


  const { data: insertedTasks, error: insertTasksError } = await supabase
    .from("tasks")
    .insert(tasksToInsert)
    .select();

  if (insertTasksError || (insertedTasks || []).length === 0) {
    await supabase
      .from("task_sessions")
      .update({ status: "failed" })
      .eq("id", workingSession.id);

    return res.status(500).json({
      error: insertTasksError?.message || "Task generation failed: no tasks inserted",
    });
  }

  const finalStoredTaskCount = insertedTasks?.length ?? tasksToInsert.length;
  console.log("TASK GENERATION COUNTS", {
    session_id: workingSession.id,
    rawTaskCount,
    duplicatesRemoved,
    finalStoredTaskCount,
    type_distribution: typeDistribution,
  });

  return res.json({
    type: "NEW_SESSION",
    session: workingSession,
    tasks: insertedTasks || tasksToInsert,
  });
});

/* =========================
   UPDATE TASK
========================= */
router.post("/update", authMiddleware, async (req: AuthRequest, res) => {
  const { task_id, status } = req.body;

  if (!task_id || !status) {
    return res.status(400).json({ error: "task_id and status required" });
  }

  if (!ALLOWED_TASK_STATUSES.has(status)) {
    return res.status(400).json({ error: "Invalid status. Allowed: pending, done, skipped" });
  }

  const supabase = getSupabaseClient(req.token!);

  let updateData: any = { status };
  const now = getNowISOString();

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

  // === STEP COMPLETION CHECK (ALL STEP TASKS) ===
  const { data: task } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", task_id)
    .single();

  if (task?.plan_step_id && task?.session_id) {
    const { data: sessionTasks } = await supabase
      .from("tasks")
      .select("*")
      .eq("session_id", task.session_id);

    const nonArchivedSessionTasks = (sessionTasks || []).filter(
      (t: any) => t.status !== "archived"
    );

    const sessionComplete =
      nonArchivedSessionTasks.length > 0 &&
      nonArchivedSessionTasks.every(
        (t: any) => t.status === "done" || t.status === "skipped"
      );

    if (!sessionComplete) {
      return res.json({
        success: true,
        sessionCompleted: false,
        stepCompleted: false,
      });
    }

    const sessionSummary = await generateSessionSummary(task.session_id, supabase);

    await supabase
      .from("task_sessions")
      .update({ status: "completed", summary_json: sessionSummary })
      .eq("id", task.session_id);

    console.log("SESSION COMPLETED:", task.session_id);
    console.log("🔥 CALLING PROGRESSION ENGINE", {
      goal_id: task.goal_id,
      task_id: task.id,
      status: task.status,
    });
    const stepCompleted = await runProgressionEngine(supabase, task.goal_id);

    return res.json({
      success: true,
      sessionCompleted: true,
      stepCompleted,
      session_summary: sessionSummary,
      message: sessionSummary.message,
    });
  }

  res.json({
    success: true,
    sessionCompleted: false,
    stepCompleted: false,
  });
});

/* =========================
   FETCH TASKS (SESSION-BASED)
========================= */
router.get("/", authMiddleware, async (req: AuthRequest, res) => {
  const { goal_id, status, all } = req.query;


  const supabase = getSupabaseClient(req.token!);

  // If ?all=true, return ALL tasks for goal regardless of session/date
  if (all === "true") {
    let query = supabase
      .from("tasks")
      .select("*")
      .eq("goal_id", goal_id as string)
      .neq("status", "archived");

    if (status) {
      query = query.eq("status", status as string);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json(error);

    return res.json(data);
  }

  const goalId = goal_id as string;

  if (!goalId) {
    return res.status(400).json({ error: "goal_id required" });
  }

  let activeStep = await getActiveStep(supabase, goalId);

  if (activeStep?.status === "completed") {
    activeStep = await getNextStepFrom(supabase, goalId, activeStep.step_index);
  }

  if (!activeStep) {
    return res.json({
      success: true,
      planCompleted: true,
      tasks: [],
    });
  }

  const { data: sessions } = await supabase
    .from("task_sessions")
    .select("*")
    .eq("goal_id", goalId)
    .eq("plan_step_id", activeStep.id)
    .order("created_at", { ascending: false })
    .limit(1);

  const session = sessions?.[0] ?? null;

  console.log("SESSION CHECK:", {
    hasSession: !!session,
    sessionStatus: session?.status,
    stepId: activeStep.id,
  });

  if (session) {
    let query = supabase
      .from("tasks")
      .select("*")
      .eq("session_id", session.id)
      .order("created_at", { ascending: true });

    if (status) {
      query = query.eq("status", status as string);
    }

    const { data: tasks, error } = await query;
    if (error) return res.status(500).json(error);

    const taskCount = tasks?.length ?? 0;
    if (taskCount === 0 && session.status === "active") {
      await supabase
        .from("task_sessions")
        .update({ status: "failed" })
        .eq("id", session.id);

      return res.json({
        type: "NO_SESSION",
        tasks: [],
      });
    }

    if (taskCount === 0 && session.status === "completed") {
      console.warn("[tasks] Found completed session with zero tasks", {
        goal_id: goalId,
        session_id: session.id,
      });

      return res.json({
        type: "NO_SESSION",
        tasks: [],
      });
    }

    return res.json({
      type: session.status === "active" ? "ACTIVE_SESSION" : "LATEST_SESSION",
      sessionStatus: session.status,
      session,
      tasks: tasks || [],
    });
  }

  return res.json({
    type: "NO_SESSION",
    sessionStatus: "none",
    tasks: [],
  });
});

/* =========================
   ADAPT TASKS (GOAL/HISTORY-SCOPED)
========================= */
router.post("/adapt", authMiddleware, async (req: AuthRequest, res) => {
  const { goal_id } = req.body;
  const userId = req.user.id;
  const today = getLocalDateString();

  const supabase = getSupabaseClient(req.token!);

  if (!goal_id) {
    return res.status(400).json({ error: "goal_id required" });
  }

  const { data: goal } = await supabase
    .from("goals")
    .select("id, user_id")
    .eq("id", goal_id)
    .maybeSingle();

  if (!goal || goal.user_id !== userId) {
    return res.status(404).json({ error: "Goal not found" });
  }

  let activeStep = await getActiveStep(supabase, goal_id);
  if (activeStep?.status === "completed") {
    activeStep = await getNextStepFrom(supabase, goal_id, activeStep.step_index);
  }

  if (!activeStep) {
    return res.json({
      updated_tasks: [],
      planCompleted: true,
      message: "Plan is already completed.",
    });
  }

  const { data: plan } = await supabase
    .from("plans")
    .select("id")
    .eq("goal_id", goal_id)
    .maybeSingle();

  if (!plan) {
    return res.status(400).json({ error: "No plan found" });
  }

  const { data: sessions } = await supabase
    .from("task_sessions")
    .select("*")
    .eq("goal_id", goal_id)
    .order("created_at", { ascending: false })
    .limit(RECENT_SESSION_LOOKBACK);

  const recentSessions = sessions || [];
  if (!recentSessions.length) {
    return res.json({
      updated_tasks: [],
      message: "Complete at least one session to improve your plan",
    });
  }

  const recentSessionIds = recentSessions.map((session: any) => session.id);
  let recentTasks: any[] = [];
  if (recentSessionIds.length) {
    const { data } = await supabase
      .from("tasks")
      .select("*")
      .in("session_id", recentSessionIds)
      .neq("status", "archived");
    recentTasks = data || [];
  }

  const latestSession = recentSessions[0];
  const latestSessionTasks = recentTasks
    .filter((task: any) => task.session_id === latestSession.id)
    .sort(
      (a: any, b: any) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

  let sourceTasks = latestSessionTasks.filter((task: any) => task.status === "pending");
  if (!sourceTasks.length) {
    sourceTasks = latestSessionTasks.slice(0, MAX_TASKS);
  }
  if (!sourceTasks.length) {
    sourceTasks = recentTasks
      .sort(
        (a: any, b: any) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
      .slice(0, MAX_TASKS);
  }

  if (!sourceTasks.length) {
    return res.json({
      updated_tasks: [],
      message: "No recent tasks available to improve yet.",
    });
  }

  const { data: allGoalTasks } = await supabase
    .from("tasks")
    .select("*")
    .eq("goal_id", goal_id);

  const metrics = computeMetrics(allGoalTasks || []);

  await updateUserMemory(req.token!, userId, {
    ...metrics,
    total: (allGoalTasks || []).length,
  });

  const memory = await getUserMemory(req.token!, userId);

  const history = (allGoalTasks || [])
    .sort(
      (a: any, b: any) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    .slice(0, RECENT_SESSION_LOOKBACK * MAX_TASKS);

  try {
    const aiResult = await generateAdaptedTasks({
      tasks: sourceTasks,
      metrics,
      history,
      memory,
    });

    const adapted = enforceTaskCount(aiResult.updated_tasks || sourceTasks, {
      stepTitle: activeStep.title,
    });

    const adaptedTypeDistribution = getTaskTypeDistribution(adapted);

    const { data: existingTargetSessions } = await supabase
      .from("task_sessions")
      .select("*")
      .eq("goal_id", goal_id)
      .eq("plan_step_id", activeStep.id)
      .eq("session_date", today)
      .order("created_at", { ascending: false })
      .limit(1);

    let targetSession = existingTargetSessions?.[0] ?? null;

    if (!targetSession) {
      const { data: newSession, error: sessionError } = await supabase
        .from("task_sessions")
        .insert({
          goal_id,
          plan_id: plan.id,
          plan_step_id: activeStep.id,
          session_date: today,
          status: "active",
        })
        .select()
        .single();

      if (sessionError || !newSession) {
        return res.status(500).json({ error: sessionError?.message || "Failed to create session" });
      }

      targetSession = newSession;
    } else if (targetSession.status !== "active") {
      const { data: reopenedSession, error: reopenError } = await supabase
        .from("task_sessions")
        .update({ status: "active" })
        .eq("id", targetSession.id)
        .select()
        .single();

      if (reopenError || !reopenedSession) {
        return res.status(500).json({ error: reopenError?.message || "Failed to activate session" });
      }

      targetSession = reopenedSession;
    }

    await supabase
      .from("tasks")
      .update({ status: "archived" })
      .eq("session_id", targetSession.id)
      .eq("status", "pending");

    const newTasks = adapted.map((task: any) => ({
      goal_id,
      session_id: targetSession.id,
      plan_step_id: activeStep.id,
      title: task.title,
      description: task.description,
      difficulty: task.difficulty,
      task_type: task.task_type,
      status: "pending",
      scheduled_date: today,
    }));

    const { data: inserted } = await supabase
      .from("tasks")
      .insert(newTasks)
      .select();

    console.log("TASK ADAPTATION COUNTS", {
      session_id: targetSession.id,
      finalStoredTaskCount: inserted?.length ?? newTasks.length,
      type_distribution: adaptedTypeDistribution,
    });

    return res.json({
      metrics,
      updated_tasks: inserted || newTasks,
    });
  } catch (err) {
    return res.status(500).json({ error: "Adapt failed" });
  }
});

/* =========================
   SUMMARY
========================= */
router.get("/summary", authMiddleware, async (req: AuthRequest, res) => {
  const { goal_id } = req.query;

  const supabase = getSupabaseClient(req.token!);

  const todayStr = getLocalDateString();
  const yesterdayStr = getYesterdayDateString();

  const { data: yesterdayTasks } = await supabase
    .from("tasks")
    .select("*")
    .eq("goal_id", goal_id)
    .eq("scheduled_date", yesterdayStr);

  const total = yesterdayTasks?.length || 0;
  const done = yesterdayTasks?.filter((t) => t.status === "done").length || 0;

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
    .select(
      "id, goal_id, status, completed_at, skipped_at, created_at, scheduled_date, goals!inner(user_id)"
    )
    .eq("goals.user_id", userId)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json(error);

  const tasks =
    data?.map((task) => {
      const { goals, ...taskOnly } = task;
      return taskOnly;
    }) || [];

  res.json(tasks);
});

export default router;