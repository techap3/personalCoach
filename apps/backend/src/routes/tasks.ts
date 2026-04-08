import { Router } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth";
import { getSupabaseClient } from "../db/supabase";
import { generateTasksForStep } from "../services/ai/taskGenerator";
import {
  buildDeterministicFallbackTasks,
  enforceTaskCount,
  enforceTaskTypeMix,
  enforceBehavioralPreferences,
  enforceTargetDifficulty,
  getTaskTypeDistribution,
  isValidFinalTasks,
  MIN_VALID_TASKS,
  MIN_TASKS,
  MAX_TASKS,
  sanitizeGeneratedTasks,
  validateBehavioralPreferences,
} from "../services/ai/taskLimits";
import {
  filterDuplicateTasks,
  normalizeTaskTitle,
} from "../services/ai/taskDedup";
import { generateAdaptedTasks } from "../services/ai/adaptTasks";
import { computeMetrics } from "../services/metrics";
import { runProgressionEngine } from "../services/progressionEngine";
import {
  updateUserPreferences,
  getUserMemory,
} from "../services/memory/userMemory";
import { getTargetDifficulty } from "../services/difficultyService";
import { generateSessionSummary } from "../services/sessionSummary";
import type { SessionType } from "../../../../packages/types";
import logger from "../logger";

const router = Router();
const RECENT_SESSION_LOOKBACK = 5;
const ALLOWED_TASK_STATUSES = new Set(["pending", "done", "skipped"]);
const DAILY_SESSION_LIMIT = 2;
const STALE_ACTIVE_SESSION_MS = 30_000;
const SESSION_TYPES = ["primary", "bonus"] as const;

function isSessionType(value: unknown): value is SessionType {
  return value === "primary" || value === "bonus";
}

function resolveSessionType(value: unknown): SessionType {
  return isSessionType(value) ? value : "primary";
}

function buildSessionResponseMeta(session: any) {
  const sessionStatus =
    session?.status === "completed"
      ? "completed"
      : session?.status === "failed"
        ? "failed"
        : "active";
  const sessionType = resolveSessionType(session?.session_type);
  const sessionCompleted = sessionStatus === "completed";
  const summary = sessionCompleted ? session?.summary_json ?? null : null;

  return {
    sessionStatus,
    sessionType,
    sessionCompleted,
    summary,
  };
}

function isSessionStale(createdAt: string | null | undefined) {
  if (!createdAt) return true;

  const createdTime = new Date(createdAt).getTime();
  if (!Number.isFinite(createdTime)) return true;

  return Date.now() - createdTime > STALE_ACTIVE_SESSION_MS;
}

async function tryAcquireGenerationLock(supabase: any, sessionId: string) {
  const { data, error } = await supabase
    .from("task_sessions")
    .update({ generation_locked: true })
    .eq("id", sessionId)
    .eq("generation_locked", false)
    .select();

  if (error) {
    return {
      acquired: false,
      error,
    };
  }

  return {
    acquired: (data?.length ?? 0) > 0,
    error: null,
  };
}

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
function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLocalYesterdayString() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return getLocalDateString(d);
}

const getNowISOString = () => new Date().toISOString();

type DailyTimeAvailable = "low" | "medium" | "high";

function normalizeDesiredCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded < 1) return 1;
  if (rounded > MAX_TASKS) return MAX_TASKS;
  return rounded;
}

function fillToCount(
  input: unknown,
  desiredCount: number,
  options?: { stepTitle?: string; blockedNormalizedTitles?: Set<string> }
) {
  const target = Math.max(1, Math.min(MAX_TASKS, Math.round(desiredCount)));
  const tasks = sanitizeGeneratedTasks(input);
  const blocked = options?.blockedNormalizedTitles ?? new Set<string>();
  const existing = new Set(tasks.map((task) => normalizeTaskTitle(task.title)));

  if (tasks.length > target) {
    return tasks.slice(0, target);
  }

  const fallback = buildDeterministicFallbackTasks(options?.stepTitle);
  let fallbackIndex = 0;

  while (tasks.length < target) {
    const baseTask = fallback[fallbackIndex % fallback.length];
    let candidateTitle = baseTask.title;
    let counter = 2;

    while (
      existing.has(normalizeTaskTitle(candidateTitle)) ||
      blocked.has(normalizeTaskTitle(candidateTitle))
    ) {
      candidateTitle = `${baseTask.title} ${counter}`;
      counter += 1;
    }

    tasks.push({
      ...baseTask,
      title: candidateTitle,
    });
    existing.add(normalizeTaskTitle(candidateTitle));
    fallbackIndex += 1;
  }

  return tasks;
}

function getFeedbackMessage(
  streak: number,
  completedToday: number,
  totalToday: number
) {
  const completionRate =
    totalToday > 0 ? completedToday / totalToday : 0;

  if (completedToday === 0) {
    return streak > 0
      ? "Let's get back on track"
      : "Let's get started";
  }

  if (streak === 1) {
    return "Nice start";
  }

  if (streak === 2 || streak === 3) {
    return "Good consistency";
  }

  if (streak >= 4 && streak < 7) {
    return "You're building momentum 🔥";
  }

  if (streak >= 7) {
    return "You're on fire 🔥";
  }

  if (completionRate > 0) {
    return "Nice progress";
  }

  return "Nice progress";
}

/* =========================
   GENERATE TASKS (SESSION-BASED)
========================= */
async function generateTasksHandler(
  req: AuthRequest,
  res: any,
  options?: { desiredCount?: number }
) {
  const { goal_id } = req.body;
  const goalId = goal_id as string;
  const supabase = getSupabaseClient(req.token!);
  const reqLog = req.log ?? logger;
  const today = getLocalDateString();
  const requestedDesiredCount = normalizeDesiredCount(
    options?.desiredCount ?? req.body?.desiredCount
  );
  const effectiveCount =
    typeof requestedDesiredCount === "number" && Number.isFinite(requestedDesiredCount)
      ? Math.max(MIN_VALID_TASKS, Math.min(MAX_TASKS, Math.round(requestedDesiredCount)))
      : undefined;

  if (!goalId) {
    return res.status(400).json({ error: "goal_id required" });
  }

  const { data: existingSessions } = await supabase
    .from("task_sessions")
    .select("*")
    .eq("goal_id", goalId)
    .eq("session_date", today)
    .order("created_at", { ascending: true });

  const todaySessions = existingSessions || [];
  const hasPrimary = todaySessions.some(
    (session: any) => resolveSessionType(session.session_type) === "primary"
  );
  const hasBonus = todaySessions.some(
    (session: any) => resolveSessionType(session.session_type) === "bonus"
  );
  const activeTodaySession = todaySessions.find((session: any) => session.status === "active") ?? null;
  const failedPrimarySession = todaySessions.find(
    (session: any) =>
      resolveSessionType(session.session_type) === "primary" && session.status === "failed"
  ) ?? null;
  const latestTodaySession = todaySessions[todaySessions.length - 1] ?? null;

  if (todaySessions.length > DAILY_SESSION_LIMIT) {
    reqLog.warn(
      {
        event: "session.anomaly.daily_count_exceeded",
        goal_id: goalId,
        session_date: today,
        count: todaySessions.length,
      },
      "More sessions than expected for goal/day"
    );
  }

  let workingSession = activeTodaySession ?? failedPrimarySession;

  if (workingSession) {
    const { data: todaySessionTasks } = await supabase
      .from("tasks")
      .select("*")
      .eq("session_id", workingSession.id)
      .order("created_at", { ascending: true });

    if (workingSession.status === "active" && (todaySessionTasks || []).length > 0) {
      const meta = buildSessionResponseMeta(workingSession);
      return res.json({
        type: "ACTIVE_SESSION",
        ...meta,
        session: workingSession,
        tasks: todaySessionTasks || [],
      });
    }

    if (workingSession.status === "active" && (todaySessionTasks || []).length === 0) {
      if (workingSession.generation_locked === true) {
        return res.json({
          type: "ACTIVE_SESSION",
          status: "generation_in_progress",
          ...buildSessionResponseMeta(workingSession),
          session: workingSession,
          tasks: [],
        });
      }

      if (!isSessionStale(workingSession.created_at)) {
        return res.json({
          type: "ACTIVE_SESSION",
          status: "generation_in_progress",
          ...buildSessionResponseMeta(workingSession),
          session: workingSession,
          tasks: [],
        });
      }

      await supabase
        .from("task_sessions")
        .update({ status: "failed", generation_locked: false })
        .eq("id", workingSession.id);

      reqLog.warn(
        {
          event: "session.failed",
          session_id: workingSession.id,
          goal_id: goalId,
          reason: "active_empty_stale",
        },
        "Marked stale active session as failed"
      );

      workingSession = {
        ...workingSession,
        status: "failed",
      };
    }
  }

  if (!workingSession && latestTodaySession?.status === "completed" && todaySessions.length >= DAILY_SESSION_LIMIT) {
    const { data: latestTasks } = await supabase
      .from("tasks")
      .select("*")
      .eq("session_id", latestTodaySession.id)
      .order("created_at", { ascending: true });

    const meta = buildSessionResponseMeta(latestTodaySession);
    return res.status(409).json({
      error: "daily_limit_reached",
      type: "LATEST_SESSION",
      ...meta,
      session: latestTodaySession,
      tasks: latestTasks || [],
    });
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

  reqLog.info(
    {
      event: "session.check",
      goal_id: goalId,
      has_session: !!workingSession,
      session_status: workingSession?.status,
      step_id: activeStep.id,
      step_status: activeStep.status,
    },
    "Session check before generation"
  );

  if (workingSession && workingSession.status === "active") {
    const { data: tasks } = await supabase
      .from("tasks")
      .select("*")
      .eq("session_id", workingSession.id)
      .order("created_at", { ascending: true });

    if ((tasks || []).length === 0) {
      if (workingSession.generation_locked === true) {
        return res.json({
          type: "ACTIVE_SESSION",
          status: "generation_in_progress",
          ...buildSessionResponseMeta(workingSession),
          session: workingSession,
          tasks: [],
        });
      }

      if (!isSessionStale(workingSession.created_at)) {
        return res.json({
          type: "ACTIVE_SESSION",
          status: "generation_in_progress",
          ...buildSessionResponseMeta(workingSession),
          session: workingSession,
          tasks: [],
        });
      }

      reqLog.warn(
        {
          event: "session.active_empty_stale",
          goal_id: goalId,
          step_id: activeStep.id,
          session_id: workingSession.id,
        },
        "Found stale active session without tasks"
      );

      await supabase
        .from("task_sessions")
        .update({ status: "failed", generation_locked: false })
        .eq("id", workingSession.id);

      reqLog.warn(
        {
          event: "session.failed",
          session_id: workingSession.id,
          goal_id: goalId,
          reason: "active_empty_stale",
        },
        "Marked stale active session as failed"
      );

      workingSession = {
        ...workingSession,
        status: "failed",
      };
    } else {
      const meta = buildSessionResponseMeta(workingSession);
      return res.json({
        type: "ACTIVE_SESSION",
        ...meta,
        session: workingSession,
        tasks: tasks || [],
      });
    }
  }

  if (!workingSession || workingSession.status === "completed" || workingSession.status === "failed") {
    reqLog.info({ event: "session.resolve_or_create", goal_id: goalId }, "Resolving or creating session");
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

  let sessionTypeForNewSession: SessionType | null = null;
  if (!hasPrimary) {
    sessionTypeForNewSession = "primary";
  } else if (!hasBonus) {
    sessionTypeForNewSession = "bonus";
  }

  if (!workingSession && sessionTypeForNewSession === null) {
    const fallbackSession = latestTodaySession;
    const fallbackMeta = fallbackSession ? buildSessionResponseMeta(fallbackSession) : {
      sessionStatus: "completed",
      sessionType: "bonus" as SessionType,
      sessionCompleted: true,
      summary: null,
    };

    return res.status(409).json({
      error: "daily_limit_reached",
      type: "LATEST_SESSION",
      ...fallbackMeta,
      session: fallbackSession,
      tasks: [],
    });
  }

  if (workingSession?.status === "failed" && resolveSessionType(workingSession.session_type) === "primary") {
    await supabase
      .from("task_sessions")
      .update({ status: "active", generation_locked: false })
      .eq("id", workingSession.id);

    workingSession = {
      ...workingSession,
      status: "active",
      generation_locked: false,
    };

    reqLog.info(
      {
        event: "session.reused_failed_primary",
        session_id: workingSession.id,
        goal_id: goalId,
        session_type: "primary",
      },
      "Reused failed primary session for retry"
    );
  }

  // Upsert-style recovery path: attempt insert, recover by selecting existing on conflict.
  if (!workingSession || workingSession.status !== "active") {
    if (!sessionTypeForNewSession) {
      return res.status(409).json({
        error: "daily_limit_reached",
        type: "LATEST_SESSION",
        ...(latestTodaySession ? buildSessionResponseMeta(latestTodaySession) : {
          sessionStatus: "completed",
          sessionType: "bonus",
          sessionCompleted: true,
          summary: null,
        }),
        session: latestTodaySession,
        tasks: [],
      });
    }

    const { data: insertedSession, error: sessionError } = await supabase
      .from("task_sessions")
      .insert({
        goal_id: goalId,
        plan_id: plan.id,
        plan_step_id: activeStep.id,
        session_date: today,
        session_type: sessionTypeForNewSession,
        generation_locked: false,
        status: "active",
      })
      .select()
      .single();

    if (sessionError?.code === "23505") {
      const { data: latestSessionsAfterConflict } = await supabase
        .from("task_sessions")
        .select("*")
        .eq("goal_id", goalId)
        .eq("session_date", today)
        .order("created_at", { ascending: false });

      const conflictSessions = latestSessionsAfterConflict || [];
      const existingSession = conflictSessions.find((session: any) => session.status === "active") || conflictSessions[0];

      if (!existingSession) {
        return res.status(500).json({ error: "Session conflict detected but no session found" });
      }

      if (existingSession.status !== "active") {
        const { data: existingSessionTasks } = await supabase
          .from("tasks")
          .select("*")
          .eq("session_id", existingSession.id)
          .order("created_at", { ascending: true });

        const meta = buildSessionResponseMeta(existingSession);

        if (conflictSessions.length >= DAILY_SESSION_LIMIT && existingSession.status === "completed") {
          return res.status(409).json({
            error: "daily_limit_reached",
            type: "LATEST_SESSION",
            ...meta,
            session: existingSession,
            tasks: existingSessionTasks || [],
          });
        }

        return res.json({
          type: "LATEST_SESSION",
          ...meta,
          session: existingSession,
          tasks: existingSessionTasks || [],
        });
      }

      workingSession = existingSession;
    } else if (sessionError || !insertedSession) {
      return res.status(500).json({ error: sessionError?.message || "Failed to create session" });
    } else {
      workingSession = insertedSession;
      reqLog.info(
        {
          event: "session.created",
          session_id: workingSession.id,
          goal_id: goalId,
          session_type: resolveSessionType(workingSession.session_type),
        },
        "Created task session"
      );
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
      const meta = buildSessionResponseMeta(workingSession);
      return res.json({
        type: "ACTIVE_SESSION",
        ...meta,
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

  const lockResult = await tryAcquireGenerationLock(supabase, workingSession.id);
  if (lockResult.error) {
    return res.status(500).json({ error: lockResult.error.message || "Failed to acquire generation lock" });
  }

  if (lockResult.acquired) {
    reqLog.info(
      {
        event: "generation.lock.acquired",
        session_id: workingSession.id,
        goal_id: goalId,
      },
      "Generation lock acquired"
    );
  }

  if (!lockResult.acquired) {
    const { data: concurrentTasks } = await supabase
      .from("tasks")
      .select("*")
      .eq("session_id", workingSession.id)
      .order("created_at", { ascending: true });

    const resolvedTasks = concurrentTasks || [];

    reqLog.info(
      {
        event: "generation.lock.skipped",
        session_id: workingSession.id,
        goal_id: goalId,
        concurrent_task_count: resolvedTasks.length,
      },
      "Generation lock already held by another request"
    );

    return res.json({
      type: "ACTIVE_SESSION",
      status: resolvedTasks.length === 0 ? "generation_in_progress" : undefined,
      ...buildSessionResponseMeta(workingSession),
      session: workingSession,
      tasks: resolvedTasks,
    });
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

  const userMemory = await getUserMemory(req.token!, userId);

  const difficultyResult = await getTargetDifficulty(supabase, userId, goalId, {
    lookbackSessions: RECENT_SESSION_LOOKBACK,
    defaultDifficulty: 2,
    currentDifficulty: activeStep.difficulty,
    preferredDifficulty:
      typeof userMemory?.preferred_difficulty === "number" &&
      Number.isFinite(userMemory.preferred_difficulty)
        ? userMemory.preferred_difficulty
        : undefined,
  });

  const effectiveTargetDifficulty =
    resolveSessionType(workingSession.session_type) === "bonus"
      ? Math.max(1, difficultyResult.targetDifficulty - 1)
      : difficultyResult.targetDifficulty;

  reqLog.info(
    {
      event: "tasks.generation.started",
      goal_id: goalId,
      session_id: workingSession.id,
      session_type: resolveSessionType(workingSession.session_type),
      completion_rate: difficultyResult.metrics.completion_rate,
      skip_rate: difficultyResult.metrics.skip_rate,
      chosen_difficulty: effectiveTargetDifficulty,
      used_default: difficultyResult.usedDefault,
    },
    "Task generation started"
  );

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
      targetDifficulty: effectiveTargetDifficulty,
      userMemory,
      desiredCount: effectiveCount,
    });

    rawTaskCount = Array.isArray(aiTasks) ? aiTasks.length : 0;
    const sanitizedTasks = sanitizeGeneratedTasks(aiTasks);
    const dedupResult = filterDuplicateTasks(
      sanitizedTasks,
      recentNormalizedTitles
    );
    duplicatesRemoved = dedupResult.removedCount;

    const mixedTasks = enforceTaskTypeMix(dedupResult.tasks, {
      blockedNormalizedTitles: recentNormalizedTitles,
      desiredCount: effectiveCount,
    });

    const behaviorAdjustedTasks = enforceBehavioralPreferences(mixedTasks, {
      preferredDifficulty: userMemory?.preferred_difficulty,
      skipPattern: userMemory?.skip_pattern,
      consistencyScore: userMemory?.consistency_score,
      completionRate: userMemory?.avg_completion_rate,
      originalTasks: mixedTasks,
    });

    const countedTasks = enforceTaskCount(behaviorAdjustedTasks, {
      stepTitle: activeStep.title,
      blockedNormalizedTitles: recentNormalizedTitles,
      desiredCount: effectiveCount,
    });

    difficultyBalancedTasks =
      typeof effectiveCount === "number"
        ? fillToCount(countedTasks, effectiveCount, {
            stepTitle: activeStep.title,
            blockedNormalizedTitles: recentNormalizedTitles,
          })
        : countedTasks;

    difficultyBalancedTasks = enforceTargetDifficulty(
      difficultyBalancedTasks,
      effectiveTargetDifficulty
    );

    const isFinalValid = isValidFinalTasks(difficultyBalancedTasks, {
      expectedCount: effectiveCount,
      preferredDifficulty: userMemory?.preferred_difficulty,
      targetDifficulty: effectiveTargetDifficulty,
    });

    const isBehaviorallyValid = validateBehavioralPreferences(
      mixedTasks,
      difficultyBalancedTasks,
      {
        expectedCount: effectiveCount,
        targetDifficulty: effectiveTargetDifficulty,
        preferredDifficulty: userMemory?.preferred_difficulty,
        skipPattern: userMemory?.skip_pattern,
      }
    );

    if (!(isBehaviorallyValid && isFinalValid)) {
      let fallbackTasks = buildDeterministicFallbackTasks(activeStep.title);
      if (typeof effectiveCount === "number") {
        fallbackTasks = fillToCount(fallbackTasks, effectiveCount, {
          stepTitle: activeStep.title,
          blockedNormalizedTitles: recentNormalizedTitles,
        });
      }

      fallbackTasks = enforceTaskTypeMix(fallbackTasks, {
        blockedNormalizedTitles: recentNormalizedTitles,
        desiredCount: effectiveCount,
      });
      fallbackTasks = enforceTargetDifficulty(fallbackTasks, effectiveTargetDifficulty);

      if (
        !isValidFinalTasks(fallbackTasks, {
          expectedCount: effectiveCount,
          preferredDifficulty: userMemory?.preferred_difficulty,
          targetDifficulty: effectiveTargetDifficulty,
        })
      ) {
        throw new Error("CRITICAL: Unable to generate valid task set");
      }

      difficultyBalancedTasks = fallbackTasks;
    }

    typeDistribution = getTaskTypeDistribution(difficultyBalancedTasks);
  } catch (generationError: any) {
    await supabase
      .from("task_sessions")
      .update({ status: "failed", generation_locked: false })
      .eq("id", workingSession.id);

    reqLog.error(
      {
        event: "session.failed",
        session_id: workingSession.id,
        goal_id: goalId,
        reason: "task_generation_exception",
        error: generationError?.message,
      },
      "Session failed due to generation exception"
    );

    return res.status(500).json({
      error: generationError?.message || "Task generation failed",
    });
  }

  const expectedMinCount = effectiveCount;

  if (difficultyBalancedTasks.length < expectedMinCount || difficultyBalancedTasks.length > MAX_TASKS) {
    reqLog.error(
      {
        event: "tasks.generation.cap_violation",
        raw_task_count: rawTaskCount,
        final_task_count: difficultyBalancedTasks.length,
        goal_id: goalId,
        step_id: activeStep.id,
      },
      "Task cap enforcement violation"
    );
  }

  if (workingSession.status !== "active") {
    return res.status(500).json({
      error: `Cannot insert tasks into non-active session: ${workingSession.status}`,
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
    await supabase
      .from("task_sessions")
      .update({ generation_locked: false })
      .eq("id", workingSession.id);

    return res.status(500).json({ error: "Task linkage error: missing session_id or plan_step_id" });
  }


  const { data: insertedTasks, error: insertTasksError } = await supabase
    .from("tasks")
    .insert(tasksToInsert)
    .select();

  if (insertTasksError || (insertedTasks || []).length === 0) {
    await supabase
      .from("task_sessions")
      .update({ status: "failed", generation_locked: false })
      .eq("id", workingSession.id);

    reqLog.error(
      {
        event: "session.failed",
        session_id: workingSession.id,
        goal_id: goalId,
        reason: "task_insert_failed",
      },
      "Session failed due to task insert failure"
    );

    return res.status(500).json({
      error: insertTasksError?.message || "Task generation failed: no tasks inserted",
    });
  }

  const finalStoredTaskCount = insertedTasks?.length ?? tasksToInsert.length;
  reqLog.info(
    {
      event: "tasks.generation.completed",
      session_id: workingSession.id,
      goal_id: goalId,
      task_count: finalStoredTaskCount,
      raw_task_count: rawTaskCount,
      duplicates_removed: duplicatesRemoved,
      type_distribution: typeDistribution,
    },
    "Task generation completed"
  );

  await supabase
    .from("task_sessions")
    .update({ generation_locked: false })
    .eq("id", workingSession.id);

  return res.json({
    type: "NEW_SESSION",
    ...buildSessionResponseMeta(workingSession),
    session: workingSession,
    tasks: insertedTasks || tasksToInsert,
  });
}

router.post("/generate", authMiddleware, async (req: AuthRequest, res) => {
  return generateTasksHandler(req, res);
});

/* =========================
   DAILY SUMMARY (RETENTION)
========================= */
router.get("/daily-summary", authMiddleware, async (req: AuthRequest, res) => {
  const supabase = getSupabaseClient(req.token!);
  const userId = req.user?.id;
  const today = getLocalDateString();
  const yesterday = getLocalYesterdayString();
  const desiredCountMap: Record<DailyTimeAvailable, number> = {
    low: 2,
    medium: 3,
    high: 5,
  };
  const rawTimeAvailable = req.query.time_available;
  const timeAvailable =
    rawTimeAvailable === "low" || rawTimeAvailable === "medium" || rawTimeAvailable === "high"
      ? rawTimeAvailable
      : undefined;
  const desiredCount = timeAvailable ? desiredCountMap[timeAvailable] : 3;

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { data: goals, error: goalsError } = await supabase
    .from("goals")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (goalsError) {
    return res.status(500).json({ error: goalsError.message || "Failed to fetch goals" });
  }

  const goalRows = Array.isArray(goals) ? goals : [];
  const goalIds = goalRows.map((goal: any) => goal.id);

  const { data: preference, error: preferenceError } = await supabase
    .from("user_preferences")
    .select("current_streak")
    .eq("user_id", userId)
    .maybeSingle();

  if (preferenceError) {
    console.error("[db] read failed", { error: preferenceError.message });
    return res.status(500).json({ error: "Database read failed" });
  }

  const streak =
    typeof preference?.current_streak === "number" && Number.isFinite(preference.current_streak)
      ? preference.current_streak
      : 0;

  let yesterdayCompleted: number | null = 0;
  let yesterdayTotal: number | null = 0;

  if (goalIds.length > 0) {
    const { data: yesterdayTasks, error: yesterdayError } = await supabase
      .from("tasks")
      .select("status")
      .in("goal_id", goalIds)
      .eq("scheduled_date", yesterday)
      .neq("status", "archived");

    if (yesterdayError) {
      yesterdayCompleted = null;
      yesterdayTotal = null;
    } else {
      const rows = Array.isArray(yesterdayTasks) ? yesterdayTasks : [];
      yesterdayTotal = rows.length;
      yesterdayCompleted = rows.filter((task: any) => task.status === "done").length;
    }
  }

  let todayTasks: any[] = [];

  if (goalIds.length > 0) {
    const { data: fetchedTodayTasks, error: todayError } = await supabase
      .from("tasks")
      .select("*")
      .in("goal_id", goalIds)
      .eq("scheduled_date", today)
      .neq("status", "archived")
      .order("created_at", { ascending: true });

    if (todayError) {
      return res.status(500).json({ error: todayError.message || "Failed to fetch today's tasks" });
    }

    todayTasks = Array.isArray(fetchedTodayTasks) ? fetchedTodayTasks : [];
  }

  if (todayTasks.length === 0 && goalIds.length > 0) {
    const targetGoalId = goalIds[0];
    const internalReq = {
      ...req,
      body: {
        goal_id: targetGoalId,
        desiredCount,
      },
    } as AuthRequest;

    let generationStatusCode = 200;
    let generationPayload: any = null;
    const internalRes = {
      status(code: number) {
        generationStatusCode = code;
        return this;
      },
      json(payload: any) {
        generationPayload = payload;
        return this;
      },
    };

    await generateTasksHandler(internalReq, internalRes as any, { desiredCount });

    if (generationStatusCode >= 400) {
      return res.status(generationStatusCode).json(generationPayload ?? { error: "Failed to generate tasks" });
    }

    if (Array.isArray(generationPayload?.tasks)) {
      todayTasks = generationPayload.tasks;
    }
  }

  let greeting = "Welcome back";
  if (streak >= 5) greeting = "You're on fire 🔥";
  else if (streak >= 2) greeting = "Good to see you again";
  else if (streak === 1) greeting = "Nice start";

  return res.json({
    greeting,
    yesterday: {
      completed: yesterdayCompleted,
      total: yesterdayTotal,
      streak,
    },
    today: {
      tasks: todayTasks,
    },
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
  const reqLog = req.log ?? logger;

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

  const { data: atomicUpdateRows, error: atomicUpdateError } = await supabase.rpc(
    "update_task_if_session_not_completed",
    {
      p_task_id: String(task_id),
      p_status: status,
      p_completed_at: updateData.completed_at ?? null,
      p_skipped_at: updateData.skipped_at ?? null,
    }
  );

  if (atomicUpdateError) {
    return res.status(500).json({ error: atomicUpdateError.message });
  }

  const task = Array.isArray(atomicUpdateRows)
    ? atomicUpdateRows[0]
    : atomicUpdateRows;

  const userId = req.user?.id;

  if (!task) {
    const { data: existingTask, error: existingTaskError } = await supabase
      .from("tasks")
      .select("id")
      .eq("id", task_id)
      .maybeSingle();

    if (existingTaskError) {
      console.error("[db] read failed", { error: existingTaskError.message });
      return res.status(500).json({ error: "Database read failed" });
    }

    if (!existingTask) {
      return res.status(404).json({ error: "Task not found" });
    }

    return res.status(409).json({ error: "Cannot update tasks in a completed session" });
  }

  let totalToday: number | null = null;
  let completedToday: number | null = null;
  let streak: number | null = 0;
  let degraded = false;
  let feedbackMetricsAvailable = true;
  let duplicateDoneRequest = false;

  try {
    const today = getLocalDateString();

    let existingPreferences: any = null;
    if (userId) {
      const { data: preferencesRow, error: preferenceReadError } = await supabase
        .from("user_preferences")
        .select("current_streak, last_completed_date")
        .eq("user_id", userId)
        .maybeSingle();

      if (preferenceReadError) {
        console.error("[feedback] failed to fetch user_preferences", preferenceReadError);
        feedbackMetricsAvailable = false;
        degraded = true;
        streak = null;
      } else {
        existingPreferences = preferencesRow;
        streak = Number(existingPreferences?.current_streak ?? 0) || 0;

        if (
          status === "done" &&
          typeof existingPreferences?.last_completed_date === "string" &&
          existingPreferences.last_completed_date === today
        ) {
          duplicateDoneRequest = true;
          feedbackMetricsAvailable = false;
        }
      }
    }

    if (!duplicateDoneRequest) {
      const { data: todaysTasks, error: todaysTasksError } = await supabase
        .from("tasks")
        .select("status")
        .eq("goal_id", task.goal_id)
        .eq("scheduled_date", today)
        .neq("status", "archived");

      if (todaysTasksError) {
        feedbackMetricsAvailable = false;
        degraded = true;
        streak = null;
        console.error("[feedback] failed to fetch todaysTasks", {
          error: todaysTasksError?.message,
        });
      }

      if (feedbackMetricsAvailable) {
        const rows = Array.isArray(todaysTasks) ? todaysTasks : [];
        totalToday = rows.length;
        completedToday = rows.filter(
          (item: any) => item.status === "done"
        ).length;
      }
    }

    if (
      feedbackMetricsAvailable &&
      userId &&
      existingPreferences &&
      streak !== null &&
      status === "done" &&
      completedToday === 1
    ) {
      const yesterday = getLocalYesterdayString();
      const lastCompletedDate =
        typeof existingPreferences?.last_completed_date === "string"
          ? existingPreferences.last_completed_date
          : null;

      if (lastCompletedDate === today) {
        // Already processed streak update for this day.
        streak = Number(existingPreferences?.current_streak ?? 0) || 0;
      } else {
        const newStreak = lastCompletedDate === yesterday ? streak + 1 : 1;

        const { error: preferenceWriteError } = await supabase
          .from("user_preferences")
          .upsert(
            {
              user_id: userId,
              current_streak: newStreak,
              last_completed_date: today,
              updated_at: getNowISOString(),
            },
            { onConflict: "user_id" }
          );

        if (preferenceWriteError) {
          console.error("[streak] write failed", preferenceWriteError);
          streak = null;
          degraded = true;
          feedbackMetricsAvailable = false;
        } else {
          streak = newStreak;
        }
      }
    }

    if (!feedbackMetricsAvailable) {
      completedToday = null;
      totalToday = null;
    }
  } catch (feedbackError: any) {
    reqLog.warn(
      {
        event: "feedback.refresh.failed",
        user_id: userId,
        task_id,
        error: feedbackError?.message,
      },
      "Failed to compute feedback loop summary"
    );
    completedToday = null;
    totalToday = null;
    streak = null;
    degraded = true;
  }

  const feedbackMessage =
    completedToday === null || totalToday === null || streak === null
      ? "Nice. Keep going"
      : getFeedbackMessage(streak, completedToday, totalToday);

  // === STEP COMPLETION CHECK (ALL STEP TASKS) ===
  if (task?.plan_step_id && task?.session_id) {
    const { data: sessionTasks, error: sessionTasksError } = await supabase
      .from("tasks")
      .select("*")
      .eq("session_id", task.session_id);

    if (sessionTasksError) {
      console.error("[db] read failed", { error: sessionTasksError.message });
      return res.json({
        status: "ok",
        message: null,
        feedback_message: "Nice. Keep going",
        completed_today: null,
        total_today: null,
        streak: null,
        degraded: true,
        success: true,
        sessionCompleted: false,
        stepCompleted: false,
      });
    }

    const safeSessionTasks = Array.isArray(sessionTasks) ? sessionTasks : [];
    const nonArchivedSessionTasks = safeSessionTasks.filter(
      (t: any) => t.status !== "archived"
    );

    const sessionComplete =
      nonArchivedSessionTasks.length > 0 &&
      nonArchivedSessionTasks.every(
        (t: any) => t.status === "done" || t.status === "skipped"
      );

    if (!sessionComplete) {
      return res.json({
        status: "ok",
        message: null,
        feedback_message: feedbackMessage,
        completed_today: completedToday,
        total_today: totalToday,
        streak,
        degraded,
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

    reqLog.info(
      {
        event: "session.completed",
        session_id: task.session_id,
        goal_id: task.goal_id,
      },
      "Session completed"
    );

    reqLog.info(
      {
        event: "progression.triggered",
        goal_id: task.goal_id,
        task_id: task.id,
        task_status: task.status,
      },
      "Calling progression engine"
    );
    const stepCompleted = await runProgressionEngine(supabase, task.goal_id);

    return res.json({
      status: "ok",
      message: sessionSummary.message,
      feedback_message: feedbackMessage,
      completed_today: completedToday,
      total_today: totalToday,
      streak,
      degraded,
      success: true,
      sessionCompleted: true,
      stepCompleted,
      session_summary: sessionSummary,
    });
  }

  res.json({
    status: "ok",
    message: null,
    feedback_message: feedbackMessage,
    completed_today: completedToday,
    total_today: totalToday,
    streak,
    degraded,
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
  const reqLog = req.log ?? logger;

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
  const today = getLocalDateString();

  if (!goalId) {
    return res.status(400).json({ error: "goal_id required" });
  }

  const { data: sessions } = await supabase
    .from("task_sessions")
    .select("*")
    .eq("goal_id", goalId)
    .eq("session_date", today)
    .order("created_at", { ascending: false });

  const allTodaySessions = sessions || [];
  const session = allTodaySessions.find((item: any) => item.status === "active") || allTodaySessions[0] || null;

  reqLog.info(
    {
      event: "session.fetch",
      goal_id: goalId,
      has_session: !!session,
      session_status: session?.status,
    },
    "Fetched latest session"
  );

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
        if (session.generation_locked === true || !isSessionStale(session.created_at)) {
          return res.json({
            type: "ACTIVE_SESSION",
            status: "generation_in_progress",
            ...buildSessionResponseMeta(session),
            session,
            tasks: [],
          });
        }

      await supabase
        .from("task_sessions")
        .update({ status: "failed", generation_locked: false })
        .eq("id", session.id);

      reqLog.warn(
        {
          event: "session.failed",
          session_id: session.id,
          goal_id: goalId,
          reason: "active_empty_stale",
        },
        "Marked stale active session as failed during fetch"
      );

      return res.json({
          type: "LATEST_SESSION",
          sessionStatus: "failed",
          sessionType: resolveSessionType(session.session_type),
          sessionCompleted: false,
          summary: null,
          session: {
            ...session,
            status: "failed",
            generation_locked: false,
          },
        tasks: [],
      });
    }

    if (taskCount === 0 && session.status === "completed") {
      reqLog.warn(
        {
          event: "session.completed_empty",
          goal_id: goalId,
          session_id: session.id,
        },
        "Found completed session with zero tasks"
      );

      return res.json({
        type: "NO_SESSION",
        tasks: [],
      });
    }

    return res.json({
      type: session.status === "active" ? "ACTIVE_SESSION" : "LATEST_SESSION",
      ...buildSessionResponseMeta(session),
      session,
      tasks: tasks || [],
    });
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
      sessionStatus: "none",
      type: "NO_SESSION",
    });
  }

  return res.json({
    type: "NO_SESSION",
    sessionStatus: "none",
    sessionType: "primary",
    sessionCompleted: false,
    summary: null,
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
  const reqLog = req.log ?? logger;

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

  await updateUserPreferences(req.token!, userId, { force: true });

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

    const sourceBaseline = sanitizeGeneratedTasks(sourceTasks);
    const desiredCount = Math.max(
      MIN_TASKS,
      Math.min(MAX_TASKS, sourceBaseline.length || MIN_TASKS)
    );
    const sourceDifficulty = Math.max(
      1,
      Math.min(5, Math.round(Number(sourceBaseline[0]?.difficulty ?? 2)))
    );

    const aiCandidate = sanitizeGeneratedTasks(aiResult.updated_tasks || sourceTasks);
    let candidate = enforceTaskCount(aiCandidate, {
      stepTitle: activeStep.title,
      desiredCount,
    });
    candidate = enforceTaskTypeMix(candidate);
    candidate = enforceTargetDifficulty(candidate, sourceDifficulty);

    const behaviorAdjusted = enforceBehavioralPreferences(candidate, {
      preferredDifficulty: memory?.preferred_difficulty,
      skipPattern: memory?.skip_pattern,
      consistencyScore: memory?.consistency_score,
      completionRate: memory?.avg_completion_rate,
      originalTasks: sourceBaseline,
    });

    const postBehaviorCount = enforceTaskCount(behaviorAdjusted, {
      stepTitle: activeStep.title,
      desiredCount,
    });
    const postBehaviorTypeMix = enforceTaskTypeMix(postBehaviorCount);
    const postBehaviorFinal = enforceTargetDifficulty(
      postBehaviorTypeMix,
      sourceDifficulty
    );

    candidate = enforceTaskCount(postBehaviorFinal, {
      stepTitle: activeStep.title,
      desiredCount,
    });

    const isCandidateValid = validateBehavioralPreferences(
      sourceBaseline,
      candidate,
      {
        expectedCount: desiredCount,
        targetDifficulty: sourceDifficulty,
        preferredDifficulty: memory?.preferred_difficulty,
        skipPattern: memory?.skip_pattern,
      }
    );

    const isFinalValid = isValidFinalTasks(candidate, {
      expectedCount: desiredCount,
      preferredDifficulty: memory?.preferred_difficulty,
      targetDifficulty: sourceDifficulty,
    });

    if (!isCandidateValid || !isFinalValid) {
      candidate = enforceTaskCount(sourceBaseline, {
        stepTitle: activeStep.title,
        desiredCount,
      });
      candidate = enforceTaskTypeMix(candidate);
      candidate = enforceTargetDifficulty(candidate, sourceDifficulty);
    }

    const adapted = enforceTaskCount(candidate, {
      stepTitle: activeStep.title,
      desiredCount,
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
    const previousTargetSession = targetSession;
    const shouldCreateNewSession =
      !targetSession ||
      targetSession.status === "completed" ||
      targetSession.status === "failed";

    if (shouldCreateNewSession) {
      const { data: todaySessions } = await supabase
        .from("task_sessions")
        .select("session_type")
        .eq("goal_id", goal_id)
        .eq("session_date", today);

      const normalizedTodayTypes = new Set(
        (todaySessions || []).map((session: any) => resolveSessionType(session.session_type))
      );

      const sessionTypeForNewSession = !normalizedTodayTypes.has("primary")
        ? "primary"
        : !normalizedTodayTypes.has("bonus")
          ? "bonus"
          : null;

      if (!sessionTypeForNewSession) {
        return res.status(409).json({
          error: "daily_limit_reached",
          message: "Cannot create adaptation session: daily session limit reached.",
        });
      }

      const { data: newSession, error: sessionError } = await supabase
        .from("task_sessions")
        .insert({
          goal_id,
          plan_id: plan.id,
          plan_step_id: activeStep.id,
          session_date: today,
          session_type: sessionTypeForNewSession,
          status: "active",
        })
        .select()
        .single();

      if (sessionError?.code === "23505") {
        const { data: conflictSessions } = await supabase
          .from("task_sessions")
          .select("*")
          .eq("goal_id", goal_id)
          .eq("session_date", today)
          .eq("session_type", sessionTypeForNewSession)
          .order("created_at", { ascending: false });

        const existingSession =
          (conflictSessions || []).find(
            (session: any) =>
              session.session_type === sessionTypeForNewSession &&
              session.status === "active"
          ) ||
          conflictSessions?.[0] ||
          null;

        if (!existingSession) {
          return res.status(409).json({
            error: "adapt_retry_required",
            message: "Concurrent adaptation detected. Please retry.",
          });
        }

        targetSession = existingSession;
      } else if (sessionError || !newSession) {
        return res.status(500).json({ error: sessionError?.message || "Failed to create session" });
      } else {
        targetSession = newSession;
      }

      if (previousTargetSession && previousTargetSession.status !== "active") {
        reqLog.info(
          {
            event: "session.created",
            goal_id,
            previous_session_id: previousTargetSession.id,
            previous_session_status: previousTargetSession.status,
            new_session_id: targetSession?.id,
            session_type: resolveSessionType(targetSession?.session_type),
          },
          "Created new adaptation session instead of mutating non-active session"
        );
      }
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

    reqLog.info(
      {
        event: "tasks.adaptation.completed",
        goal_id,
        session_id: targetSession.id,
        task_count: inserted?.length ?? newTasks.length,
        type_distribution: adaptedTypeDistribution,
      },
      "Task adaptation completed"
    );

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
  const yesterdayStr = getLocalYesterdayString();

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