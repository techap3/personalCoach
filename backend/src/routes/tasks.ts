import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { getSupabaseClient } from "../db/supabase";
import { generateTasksForStep } from "../services/ai/taskGenerator";
import { generateAdaptedTasks } from "../services/ai/adaptTasks";
import { computeMetrics } from "../services/metrics";
import {
  updateUserMemory,
  getUserMemory,
} from "../services/memory/userMemory";

const router = Router();

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
  const supabase = getSupabaseClient(req.token!);
  const today = getLocalDateString();

  // 1. Get the active plan step
  const activeStep = await getActiveStep(supabase, goal_id);
  if (!activeStep) {
    return res.status(400).json({ error: "No active step. Plan may be complete." });
  }

  // 2. Get the plan record (need plan.id for session)
  const { data: plan } = await supabase
    .from("plans")
    .select("*")
    .eq("goal_id", goal_id)
    .maybeSingle();

  if (!plan) {
    return res.status(400).json({ error: "No plan found" });
  }

  // 3. Fetch latest session today (supports multiple sessions/day)
  const { data: todaySessions } = await supabase
    .from("task_sessions")
    .select("*")
    .eq("goal_id", goal_id)
    .eq("session_date", today)
    .order("created_at", { ascending: false })
    .limit(1);

  const existingSession = todaySessions?.[0] ?? null;


  if (existingSession?.status === "active") {
    const { data: sessionTasks } = await supabase
      .from("tasks")
      .select("*")
      .eq("session_id", existingSession.id)
      .neq("status", "archived");

    const activeSessionTasks = sessionTasks || [];
    const allResolved =
      activeSessionTasks.length > 0 &&
      activeSessionTasks.every(
        (t: any) => t.status === "done" || t.status === "skipped"
      );


    if (allResolved) {
      await supabase
        .from("task_sessions")
        .update({ status: "completed" })
        .eq("id", existingSession.id);

    } else {
      return res.json({ tasks: activeSessionTasks });
    }

  }

  // 4. No active session found (or latest is completed) → create a new session.
  // If DB still has unique(goal_id, session_date), fallback to reusing today's completed session.
  let session: any = null;

  const { data: createdSession, error: sessionError } = await supabase
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

  if (!sessionError) {
    session = createdSession;
  } else {
    const isDuplicateTodaySession =
      sessionError.message?.includes("task_sessions_goal_id_session_date_key") ||
      sessionError.code === "23505";

    if (isDuplicateTodaySession && existingSession) {
      // With unique(goal_id, session_date), reuse same row but clear old tasks
      // so fetches don't keep returning previously resolved items.
      await supabase
        .from("tasks")
        .update({ status: "archived" })
        .eq("session_id", existingSession.id)
        .neq("status", "archived");

      const { data: reopenedSession, error: reopenError } = await supabase
        .from("task_sessions")
        .update({
          status: "active",
          plan_id: plan.id,
          plan_step_id: activeStep.id,
        })
        .eq("id", existingSession.id)
        .select()
        .single();

      if (reopenError) {
        return res.status(500).json({ error: reopenError.message });
      }

      session = reopenedSession;
    } else {
      return res.status(500).json({ error: sessionError.message });
    }
  }

  // 5. Generate tasks scoped to this step only
  const rawTasks = await generateTasksForStep(activeStep);

  // 6. Insert with session_id and plan_step_id
  const toInsert = rawTasks.map((t: any) => ({
    goal_id,
    plan_step_id: activeStep.id,
    session_id: session.id,
    title: t.title,
    description: t.description,
    difficulty: t.difficulty,
    status: "pending",
    scheduled_date: today,
  }));


  const { data: insertedTasks } = await supabase
    .from("tasks")
    .insert(toInsert)
    .select();

  return res.json({ tasks: insertedTasks || [] });
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

  if (task?.plan_step_id) {

    // Mark session completed once all non-archived tasks in that session are resolved.
    if (task.session_id) {
      const { data: sessionTasks } = await supabase
        .from("tasks")
        .select("id, status")
        .eq("session_id", task.session_id)
        .neq("status", "archived");

      const sessionTotal = sessionTasks?.length ?? 0;
      const sessionResolved =
        sessionTasks?.filter((t: any) => t.status === "done" || t.status === "skipped")
          .length ?? 0;


      if (sessionTotal > 0 && sessionResolved === sessionTotal) {
        await supabase
          .from("task_sessions")
          .update({ status: "completed" })
          .eq("id", task.session_id);

      }
    }

    const { data: stepTasks } = await supabase
      .from("tasks")
      .select("id, status, plan_step_id")
      .eq("plan_step_id", task.plan_step_id)
      .neq("status", "archived");


    const total = stepTasks?.length ?? 0;

    const resolved =
      stepTasks?.filter((t: any) => t.status === "done" || t.status === "skipped")
        .length ?? 0;


    if (total > 0 && resolved === total) {

      await supabase
        .from("plan_steps")
        .update({ status: "completed" })
        .eq("id", task.plan_step_id);

      const { data: updatedStep } = await supabase
        .from("plan_steps")
        .select("*")
        .eq("id", task.plan_step_id)
        .single();


      if (updatedStep) {
        const { data: nextStep } = await supabase
          .from("plan_steps")
          .select("*")
          .eq("goal_id", task.goal_id)
          .gt("step_index", updatedStep.step_index)
          .order("step_index", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (nextStep) {
          await supabase
            .from("plan_steps")
            .update({ status: "active" })
            .eq("id", nextStep.id);

        }
      }
    }
  }

  res.json({ success: true });
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

  const today = getLocalDateString();

  // Fetch latest session for today (any status)
  const { data: sessions } = await supabase
    .from("task_sessions")
    .select("*")
    .eq("goal_id", goal_id)
    .eq("session_date", today)
    .order("created_at", { ascending: false })
    .limit(1);

  const session = sessions?.[0] ?? null;


  if (!session || session.status === "completed") {
    if (session?.status === "completed") {
    }

    const activeStep = await getActiveStep(supabase, goal_id as string);
    if (!activeStep) {
      return res.json([]);
    }

    const { data: plan } = await supabase
      .from("plans")
      .select("*")
      .eq("goal_id", goal_id)
      .maybeSingle();

    if (!plan) {
      return res.status(400).json({ error: "No plan found" });
    }

    let newSession: any = null;

    const { data: createdSession, error: createSessionError } = await supabase
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

    if (!createSessionError) {
      newSession = createdSession;
    } else {
      const isDuplicateTodaySession =
        createSessionError.message?.includes("task_sessions_goal_id_session_date_key") ||
        createSessionError.code === "23505";

      if (isDuplicateTodaySession) {
        // Fallback while unique(goal_id, session_date) still exists in DB.
        // Reopen latest session and attach new tasks to keep flow actionable.
        const { data: latestSessions } = await supabase
          .from("task_sessions")
          .select("*")
          .eq("goal_id", goal_id)
          .eq("session_date", today)
          .order("created_at", { ascending: false })
          .limit(1);

        const latestSession = latestSessions?.[0] ?? session;

        if (!latestSession) {
          return res.status(500).json({ error: createSessionError.message });
        }

        const { data: reopenedSession, error: reopenError } = await supabase
          .from("task_sessions")
          .update({
            status: "active",
            plan_id: plan.id,
            plan_step_id: activeStep.id,
          })
          .eq("id", latestSession.id)
          .select()
          .single();

        if (reopenError) {
          return res.status(500).json({ error: reopenError.message });
        }

        newSession = reopenedSession;
      } else {
        return res.status(500).json({ error: createSessionError.message });
      }
    }

    const rawTasks = await generateTasksForStep(activeStep);

    const toInsert = rawTasks.map((t: any) => ({
      goal_id,
      plan_step_id: activeStep.id,
      session_id: newSession.id,
      title: t.title,
      description: t.description,
      difficulty: t.difficulty,
      status: "pending",
      scheduled_date: today,
    }));

    const { data: insertedTasks, error: insertError } = await supabase
      .from("tasks")
      .insert(toInsert)
      .select();

    if (insertError) {
      return res.status(500).json({ error: insertError.message });
    }

    if (status) {
      return res.json((insertedTasks || []).filter((task: any) => task.status === status));
    }

    return res.json(insertedTasks || []);
  }

  // session.status is active here
  let query = supabase
    .from("tasks")
    .select("*")
    .eq("session_id", session.id)
    .neq("status", "archived");

  if (status) {
    query = query.eq("status", status as string);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json(error);

  res.json(data);
});

/* =========================
   ADAPT TASKS (SESSION-SCOPED)
========================= */
router.post("/adapt", authMiddleware, async (req: AuthRequest, res) => {
  const { goal_id } = req.body;
  const userId = req.user.id;
  const today = getLocalDateString();

  const supabase = getSupabaseClient(req.token!);

  // 1. Get latest active session for today
  const { data: sessions } = await supabase
    .from("task_sessions")
    .select("*")
    .eq("goal_id", goal_id)
    .eq("session_date", today)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1);

  const session = sessions?.[0] ?? null;

  if (!session) {
    return res.status(400).json({ error: "No active session for today" });
  }

  // 2. Get pending tasks from this session only
  const { data: sessionTasks } = await supabase
    .from("tasks")
    .select("*")
    .eq("session_id", session.id);

  const pendingTasks = sessionTasks?.filter((t) => t.status === "pending") || [];

  if (!pendingTasks.length) {
    return res.status(400).json({ error: "No pending tasks in current session" });
  }

  // Memory/metrics use all goal tasks for context
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
    .slice(0, 10);

  try {
    const aiResult = await generateAdaptedTasks({
      tasks: pendingTasks,
      metrics,
      history,
      memory,
    });

    let adapted = aiResult.updated_tasks;
    adapted = adapted.slice(0, pendingTasks.length);
    while (adapted.length < pendingTasks.length) {
      adapted.push(pendingTasks[adapted.length]);
    }

    // 3. Archive pending tasks from current session
    const pendingIds = pendingTasks.map((t) => t.id);
    await supabase
      .from("tasks")
      .update({ status: "archived" })
      .in("id", pendingIds);

    // 4. Create a new session for the same step + same day
    const { data: newSession, error: sessionError } = await supabase
      .from("task_sessions")
      .insert({
        goal_id,
        plan_id: session.plan_id,
        plan_step_id: session.plan_step_id,
        session_date: today,
        status: "active",
      })
      .select()
      .single();

    if (sessionError) {
      return res.status(500).json({ error: sessionError.message });
    }

    // 5. Insert adapted tasks under the new session
    const newTasks = adapted.map((t: any) => ({
      goal_id,
      session_id: newSession.id,
      plan_step_id: session.plan_step_id,
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