"use client";

import { useEffect, useState, useCallback } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

import Login from "./components/Login";
import GoalForm from "./components/GoalForm";
import PlanView from "./components/PlanView";
import TasksView from "./components/TasksView";
import DailySummary from "./components/DailySummary";
import {
  getCompletionCtaVariant,
  getGenerateButtonLabel,
  isGenerateDisabled,
  type SessionStatus,
  type SessionType,
} from "./sessionUi";
import { DEFAULT_SESSION_TYPE, SESSION_STATUS, SESSION_TYPE } from "@repo/constants";

import { PlanResponse } from "@/types/plan";

declare global {
  interface Window {
    __SESSION_ID__?: string | null;
  }
}

type Task = {
  id: string;
  title: string;
  description: string;
  difficulty: number;
  task_type?: "action" | "learn" | "reflect" | "review";
  status?: string;
  plan_step_id?: string; // UUID — matches plan_steps.id
  session_id?: string;
  created_at?: string;
};

type PlanStepMeta = {
  id: string;
  step_index: number;
  status: string;
};

type AllTask = {
  id: string;
  goal_id: string;
  status: string;
  completed_at?: string;
  skipped_at?: string;
  created_at: string;
  scheduled_date: string;
};

type Goal = {
  id: string;
  title?: string;
  description?: string;
  created_at?: string;
};

type SessionSummary = {
  completed: number;
  skipped: number;
  completion_rate: number;
  message: string;
};

export default function Home() {

  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [todayTasks, setTodayTasks] = useState<Task[]>([]);
  const [allGoalTasks, setAllGoalTasks] = useState<Task[]>([]);
  const [planStepMeta, setPlanStepMeta] = useState<PlanStepMeta[]>([]);
  const [allTasks, setAllTasks] = useState<AllTask[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [goals, setGoals] = useState<any[]>([]);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [view, setView] = useState<"HOME" | "CREATE_GOAL" | "PLAN" | "TASKS">("HOME");
  const [viewMode, setViewMode] = useState<"plan" | "tasks">("plan");
  const [showAllGoals, setShowAllGoals] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  const [sessionCompletedMessage, setSessionCompletedMessage] = useState<string | null>(null);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [latestSessionStatus, setLatestSessionStatus] = useState<SessionStatus>(SESSION_STATUS.NONE);
  const [latestSessionType, setLatestSessionType] = useState<SessionType>(DEFAULT_SESSION_TYPE);
  const [stepCompleted, setStepCompleted] = useState(false);
  const [planCompleted, setPlanCompleted] = useState(false);
  const [generatingTasks, setGeneratingTasks] = useState(false);
  const [generationInProgress, setGenerationInProgress] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL;
  const token = session?.access_token;

  const shouldExposeSessionId =
    process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_E2E === "true";

  const setDevSessionId = useCallback((sessionId?: string | null) => {
    if (shouldExposeSessionId && typeof window !== "undefined") {
      window.__SESSION_ID__ = sessionId ?? null;
    }
  }, [shouldExposeSessionId]);

  const normalizeSessionType = useCallback((value: unknown): SessionType => {
    return value === SESSION_TYPE.BONUS ? SESSION_TYPE.BONUS : DEFAULT_SESSION_TYPE;
  }, []);

  const getApiBaseUrl = useCallback(() => {
    if (!BASE_URL) return null;

    if (typeof window === "undefined") {
      return BASE_URL;
    }

    try {
      const resolvedUrl = new URL(BASE_URL);
      const currentHost = window.location.hostname;
      const isLocalBackendHost = ["localhost", "127.0.0.1"].includes(resolvedUrl.hostname);
      const isLocalBrowserHost = ["localhost", "127.0.0.1"].includes(currentHost);

      if (isLocalBackendHost && !isLocalBrowserHost) {
        resolvedUrl.hostname = currentHost;
      }

      return resolvedUrl.toString().replace(/\/$/, "");
    } catch {
      return BASE_URL;
    }
  }, [BASE_URL]);

  /* =========================
     AUTH
  ========================= */
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setSession(data.session ?? null);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setSession(session ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  /* =========================
     LOGOUT
  ========================= */
  const logout = async () => {
    await supabase.auth.signOut();

    setUser(null);
    setSession(null);
    setPlan(null);
    setTodayTasks([]);
    setAllGoalTasks([]);
    setPlanStepMeta([]);
    setAllTasks([]);
    setGoals([]);
    setGoalId(null);
    setView("HOME");
    setViewMode("plan");
    setSessionCompletedMessage(null);
    setSessionSummary(null);
    setLatestSessionStatus(SESSION_STATUS.NONE);
    setLatestSessionType(DEFAULT_SESSION_TYPE);
    setStepCompleted(false);
    setPlanCompleted(false);
    setGeneratingTasks(false);
    setGenerationInProgress(false);
    setGenerateError(null);
    setDevSessionId(null);
  };

  /* =========================
     FETCH TASKS (ALL STATES)
  ========================= */
  const fetchTasks = useCallback(async (goalId: string): Promise<Task[]> => {
    const apiBaseUrl = getApiBaseUrl();

    if (!apiBaseUrl || !token) return [] as Task[];

    try {
      const res = await fetch(`${apiBaseUrl}/tasks?goal_id=${goalId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      const responseType = data?.type;
      const responseSessionStatus = data?.sessionStatus || data?.session?.status;
      const responseSessionType = normalizeSessionType(
        data?.sessionType || data?.session?.session_type || DEFAULT_SESSION_TYPE
      );
      const responseProgressStatus = data?.status;
      const responseSessionId = data?.session?.id ? String(data.session.id) : null;
      const explicitCompleted =
        data?.sessionCompleted === true ||
        (responseType === "LATEST_SESSION" && responseSessionStatus === SESSION_STATUS.COMPLETED);
      const explicitActiveOrIncomplete =
        responseType === "ACTIVE_SESSION" || responseSessionStatus === SESSION_STATUS.ACTIVE;
      const explicitFailed = responseSessionStatus === SESSION_STATUS.FAILED;

      if (data?.planCompleted) {
        setPlanCompleted(true);
        // Preserve existing completion summary unless backend explicitly starts an active session.
        if (explicitActiveOrIncomplete) {
          setSessionCompletedMessage(null);
          setSessionSummary(null);
        }
        setStepCompleted(false);
        setLatestSessionStatus(SESSION_STATUS.COMPLETED);
        setLatestSessionType(normalizeSessionType(responseSessionType));
        setGenerationInProgress(false);
        setDevSessionId(null);
        setTodayTasks([]);
        return [] as Task[];
      }

      setDevSessionId(responseSessionId);

      setPlanCompleted(false);

      if (responseType === "ACTIVE_SESSION" || responseSessionStatus === SESSION_STATUS.ACTIVE) {
        setLatestSessionStatus(SESSION_STATUS.ACTIVE);
        setLatestSessionType(normalizeSessionType(responseSessionType));
        setGenerationInProgress(responseProgressStatus === "generation_in_progress");
      } else if (responseSessionStatus === SESSION_STATUS.FAILED) {
        setLatestSessionStatus(SESSION_STATUS.FAILED);
        setLatestSessionType(normalizeSessionType(responseSessionType));
        setGenerationInProgress(false);
      } else if (responseType === "LATEST_SESSION" && responseSessionStatus === SESSION_STATUS.COMPLETED) {
        setLatestSessionStatus(SESSION_STATUS.COMPLETED);
        setLatestSessionType(normalizeSessionType(responseSessionType));
        setGenerationInProgress(false);
      } else if (responseType === "NO_SESSION") {
        setLatestSessionStatus(SESSION_STATUS.NONE);
        setLatestSessionType(DEFAULT_SESSION_TYPE);
        setGenerationInProgress(false);
        setDevSessionId(null);
      }

      if (explicitCompleted) {
        const nextSummary = data?.session_summary || data?.session?.summary_json || null;
        const nextMessage =
          data?.message ||
          nextSummary?.message ||
          "Nice work today 🎉";

        setSessionCompletedMessage(nextMessage);
        if (nextSummary) {
          setSessionSummary(nextSummary);
        }
        setLatestSessionStatus(SESSION_STATUS.COMPLETED);
        setLatestSessionType(normalizeSessionType(responseSessionType));
        setGenerationInProgress(false);
        setTodayTasks([]);
        return [] as Task[];
      }

      if (explicitActiveOrIncomplete) {
        setSessionCompletedMessage(null);
        setSessionSummary(null);
        setLatestSessionStatus(SESSION_STATUS.ACTIVE);
        setLatestSessionType(normalizeSessionType(responseSessionType));
        setGenerationInProgress(responseProgressStatus === "generation_in_progress");
      }

      if (explicitFailed) {
        setSessionCompletedMessage(null);
        setSessionSummary(null);
        setLatestSessionStatus(SESSION_STATUS.FAILED);
        setLatestSessionType(normalizeSessionType(responseSessionType));
        setGenerateError("Last session failed to generate tasks. Retry to start a fresh session.");
        setGenerationInProgress(false);
        setDevSessionId(responseSessionId);
        setTodayTasks([]);
        return [] as Task[];
      }

      const normalizedTasks: Task[] = (Array.isArray(data) ? data : data.tasks || []).map((task: Task) => ({
        ...task,
        plan_step_id: task.plan_step_id ? String(task.plan_step_id) : undefined,
      }));

      setTodayTasks(normalizedTasks);
      return normalizedTasks;
    } catch (err) {
      console.error("❌ Fetch tasks error:", err);
      return [] as Task[];
    }
  }, [getApiBaseUrl, normalizeSessionType, setDevSessionId, token]);

  /* =========================
     FETCH PLAN
  ========================= */
  const fetchPlan = useCallback(async (nextGoalId: string) => {
    if (!nextGoalId) return;

    const { data, error } = await supabase
      .from("plans")
      .select("plan_json")
      .eq("goal_id", nextGoalId)
      .maybeSingle();

    if (error) {
      console.error("❌ Fetch plan error:", error);
      return;
    }

    const normalizedPlan = data?.plan_json
      ? {
          plan: ((data.plan_json as PlanResponse).plan || []).map((step) => ({
            title: String(step.title || "").trim(),
            description: String(step.description || "").trim(),
            difficulty: Number(step.difficulty ?? 1),
          })),
        }
      : null;

    setPlan(normalizedPlan);

    // Fetch plan_steps for UUID-based task ↔ step matching
    const { data: steps } = await supabase
      .from("plan_steps")
      .select("id, step_index, status")
      .eq("goal_id", nextGoalId)
      .order("step_index", { ascending: true });

    const normalizedSteps = ((steps as PlanStepMeta[]) || []).map((step) => ({
      ...step,
    }));

    setPlanStepMeta(normalizedSteps);

    return {
      plan: normalizedPlan,
      stepMeta: normalizedSteps,
    };
  }, []);

  /* =========================
     FETCH ALL GOAL TASKS (for plan view progress)
  ========================= */
  const fetchAllGoalTasks = useCallback(async (gid: string): Promise<Task[]> => {
    const apiBaseUrl = getApiBaseUrl();
    if (!apiBaseUrl || !token) return [];

    try {
      const res = await fetch(`${apiBaseUrl}/tasks?goal_id=${gid}&all=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      const normalized: Task[] = (Array.isArray(data) ? data : []).map((task: Task) => ({
        ...task,
        plan_step_id: task.plan_step_id ? String(task.plan_step_id) : undefined,
      }));
      setAllGoalTasks(normalized);
      return normalized;
    } catch (err) {
      console.error("❌ fetchAllGoalTasks error:", err);
      return [];
    }
  }, [getApiBaseUrl, token]);

  /* =========================
     FETCH ALL USER TASKS
  ========================= */
  const fetchAllTasks = useCallback(async () => {
    const apiBaseUrl = getApiBaseUrl();

    if (!apiBaseUrl || !token) return;

    try {
      const res = await fetch(`${apiBaseUrl}/tasks/all`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();

      setAllTasks(data || []);
    } catch (err) {
      console.error("❌ Fetch all tasks error:", err);
    }
  }, [getApiBaseUrl, token]);

  /* =========================
     FETCH GOALS
  ========================= */
  const fetchGoals = useCallback(async () => {
    const apiBaseUrl = getApiBaseUrl();

    if (!apiBaseUrl || !token) return [] as Goal[];

    try {
      const res = await fetch(`${apiBaseUrl}/goals`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      const nextGoals = Array.isArray(data) ? data : [];

      setGoals(nextGoals);
      return nextGoals;
    } catch (err) {
      console.error("❌ Fetch goals error:", err);
      return [] as Goal[];
    }
  }, [getApiBaseUrl, token]);

  /* =========================
     FETCH ALL TASKS ON LOGIN
  ========================= */
  useEffect(() => {
    if (token) {
      fetchAllTasks();
      fetchGoals();
    }
  }, [token, fetchAllTasks, fetchGoals]);

  useEffect(() => {
    if (goalId) {
      void fetchTasks(goalId);
      void fetchPlan(goalId);
      void fetchAllGoalTasks(goalId);
    }
  }, [goalId, fetchPlan, fetchTasks, fetchAllGoalTasks]);

  const getLatestGoal = (items: Goal[]) => {
    if (!items.length) return null;

    return [...items].sort((left, right) => {
      const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0;
      const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0;
      return rightTime - leftTime;
    })[0];
  };

  const handlePlanGenerated = async (planData: PlanResponse) => {
    setPlan(planData);

    const nextGoals = await fetchGoals();
    const latestGoal = getLatestGoal(nextGoals);

    if (latestGoal) {
      setGoalId(latestGoal.id);
    }

    setView("PLAN");
  };

  const startNewSession = async () => {
    const apiBaseUrl = getApiBaseUrl();

    if (generatingTasks || planCompleted || !goalId || !apiBaseUrl || !token) return;

    console.log("🟦 CTA CLICKED: startNewSession", {
      goalId,
      sessionStatus,
      sessionType,
    });

    setGeneratingTasks(true);
    setGenerateError(null);
    setStepCompleted(false);

    try {
      const res = await fetch(`${apiBaseUrl}/tasks/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ goal_id: goalId }),
      });

      if (!res.ok) {
        const errorPayload = await res.json().catch(() => null);
        const errText =
          errorPayload?.error === "daily_limit_reached"
            ? "You've reached today's limit"
            : errorPayload?.error || "Failed to generate tasks.";
        console.error("❌ Task gen error:", errorPayload || errText);
        setGenerateError(errText);

        if (errorPayload?.error === "daily_limit_reached") {
          setLatestSessionStatus(SESSION_STATUS.COMPLETED);
          setLatestSessionType(SESSION_TYPE.BONUS);
          if (errorPayload?.summary) {
            setSessionSummary(errorPayload.summary);
            setSessionCompletedMessage(errorPayload.summary.message || "Great momentum!");
          }
        }
        return;
      }

      const payload = await res.json();
      console.log("🟩 GENERATE RESPONSE", payload);
      console.log("🧾 SESSION ID", payload?.session?.id || null);
      setDevSessionId(payload?.session?.id ? String(payload.session.id) : null);

      if (payload?.type === "ACTIVE_SESSION") {
        setLatestSessionStatus(SESSION_STATUS.ACTIVE);
        setLatestSessionType(normalizeSessionType(payload?.sessionType));
        setGenerationInProgress(payload?.status === "generation_in_progress");
        setSessionCompletedMessage(null);
        setSessionSummary(null);
      } else if (payload?.type === "NEW_SESSION") {
        setLatestSessionStatus(SESSION_STATUS.ACTIVE);
        setLatestSessionType(normalizeSessionType(payload?.sessionType));
        setGenerationInProgress(false);
        setSessionCompletedMessage(null);
        setSessionSummary(null);
      } else if (payload?.type === "LATEST_SESSION" && payload?.sessionStatus === "completed") {
        // Guard against accidentally continuing a completed session when a new one was requested.
        setLatestSessionStatus(SESSION_STATUS.COMPLETED);
        setLatestSessionType(normalizeSessionType(payload?.sessionType));
        setGenerationInProgress(false);
        setGenerateError("Unable to start a new session yet. Previous session is already completed.");
      } else if (payload?.sessionStatus === "failed") {
        setLatestSessionStatus(SESSION_STATUS.FAILED);
        setLatestSessionType(normalizeSessionType(payload?.sessionType));
        setGenerationInProgress(false);
        setGenerateError("Last session failed to generate tasks. Retry to continue.");
      }

      const generatedTasks: Task[] = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.tasks)
          ? payload.tasks
          : [];

      const normalizedGeneratedTasks: Task[] = generatedTasks.map((task: Task) => ({
        ...task,
        plan_step_id: task.plan_step_id ? String(task.plan_step_id) : undefined,
      }));

      if (generatedTasks.length === 0 && payload?.message) {
        setSessionCompletedMessage(payload.message);
        setSessionSummary(payload.session_summary || null);
        setLatestSessionStatus(SESSION_STATUS.COMPLETED);
        setLatestSessionType(normalizeSessionType(payload?.sessionType));
        setGenerationInProgress(false);
        setTodayTasks([]);
        await fetchAllGoalTasks(goalId);
        await fetchAllTasks();
        setViewMode("tasks");
        setView("TASKS");
        return;
      }

      if (normalizedGeneratedTasks.length > 0) {
        setTodayTasks(normalizedGeneratedTasks);
      }

      // Success path always transitions into tasks view.
      setViewMode("tasks");
      setView("TASKS");

      await fetchTasks(goalId);
      const goalTasks = await fetchAllGoalTasks(goalId);

      // Find first step with pending tasks using UUID matching
      const firstPendingStepIdx = planStepMeta.findIndex((step) => {
        const stepTasks = goalTasks.filter(
          (task) => String(task.plan_step_id) === String(step.id)
        );
        return stepTasks.some((task) => task.status === "pending");
      });

      if (firstPendingStepIdx !== -1) {
        setActiveStepIndex(firstPendingStepIdx);
      }

      await fetchAllTasks();
    } catch (err) {
      console.error("❌ Task generation failed:", err);
      setGenerateError("Failed to generate tasks. Please try again.");
    } finally {
      setGeneratingTasks(false);
    }
  };

  const continueSession = async () => {
    if (!goalId) return;

    setGenerateError(null);
    setViewMode("tasks");
    setView("TASKS");

    await fetchTasks(goalId);
    await fetchAllGoalTasks(goalId);
  };

  const handleGenerateClick = async () => {
    if (sessionStatus === SESSION_STATUS.COMPLETED && sessionType === SESSION_TYPE.BONUS) {
      setGenerateError("You've reached today's limit");
      return;
    }

    if (sessionStatus === SESSION_STATUS.ACTIVE) {
      await continueSession();
      return;
    }

    await startNewSession();
  };

  const handleGoalSelect = async (goal: Goal) => {
    setPlanCompleted(false);
    setGenerateError(null);
    setGeneratingTasks(false);
    setLatestSessionStatus(SESSION_STATUS.NONE);
    setLatestSessionType(DEFAULT_SESSION_TYPE);
    setGenerationInProgress(false);
    setDevSessionId(null);
    setGoalId(goal.id);
    setActiveStepIndex(0);
    setViewMode("plan");
    setView("PLAN");
  };

  const restartPlan = () => {
    setPlanCompleted(false);
    setSessionCompletedMessage(null);
    setSessionSummary(null);
    setLatestSessionStatus(SESSION_STATUS.NONE);
    setLatestSessionType(DEFAULT_SESSION_TYPE);
    setGenerationInProgress(false);
    setDevSessionId(null);
    setStepCompleted(false);
    setGoalId(null);
    setPlan(null);
    setPlanStepMeta([]);
    setTodayTasks([]);
    setAllGoalTasks([]);
    setViewMode("plan");
    setView("CREATE_GOAL");
  };

  const handleBackNavigation = () => {
    if (view === "TASKS" || view === "PLAN") {
      setViewMode("plan");
      setView("PLAN");
      return;
    }

    if (view === "CREATE_GOAL") {
      setView("HOME");
    }
  };

  const getPendingCountForGoal = (id: string) =>
    allTasks.filter((task) => task.goal_id === id && task.status === "pending").length;

  const goalsSorted = [...goals].sort((left: Goal, right: Goal) => {
    const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0;
    const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0;
    return rightTime - leftTime;
  });

  const activeGoal = goalsSorted[0] || null;
  const remainingGoals = activeGoal
    ? goalsSorted.filter((goal: Goal) => goal.id !== activeGoal.id)
    : goalsSorted;
  const visibleRemainingGoals = showAllGoals
    ? remainingGoals
    : remainingGoals.slice(0, 3);

  const roadmapSteps = plan?.plan ?? [];
  const sessionStatus: SessionStatus = latestSessionStatus;
  const sessionType: SessionType = latestSessionType;

  const completionVariant = getCompletionCtaVariant(sessionType);

  const derivedActiveStep = (() => {
    if (!planStepMeta.length) return -1;

    // Primary source: plan_steps status from backend progression engine.
    const firstIncompleteStep = planStepMeta.findIndex(
      (step) => step.status !== "completed"
    );
    if (firstIncompleteStep !== -1) {
      return firstIncompleteStep;
    }

    // Fallback: pending tasks if status sync is delayed.
    return planStepMeta.findIndex((step) => {
      const stepTasks = allGoalTasks.filter(
        (task) => String(task.plan_step_id) === String(step.id)
      );
      return stepTasks.some((task) => task.status === "pending");
    });
  })();

  const safeActiveStepIndex =
    activeStepIndex >= 0 && activeStepIndex < roadmapSteps.length
      ? activeStepIndex
      : 0;

  const finalActiveStep =
    derivedActiveStep !== -1 && derivedActiveStep !== undefined
      ? derivedActiveStep
      : safeActiveStepIndex;
  const totalSteps = roadmapSteps.length;
  const currentStepDisplayIndex = totalSteps ? Math.min(finalActiveStep + 1, totalSteps) : 0;
  const overallStepProgressPercent = totalSteps
    ? Math.round((currentStepDisplayIndex / totalSteps) * 100)
    : 0;

  const getCurrentCycle = (tasks: Task[]) => {
    const visible = tasks.filter((task) => task.status !== "archived");
    if (!visible.length) {
      return {
        cycleTasks: [] as Task[],
        cycleStart: null as number | null,
      };
    }

    const pendingTasks = visible.filter((task) => task.status === "pending");
    if (!pendingTasks.length) {
      const oldest = visible
        .map((task) => (task.created_at ? new Date(task.created_at).getTime() : 0))
        .filter((time) => Number.isFinite(time) && time > 0)
        .sort((a, b) => a - b)[0] ?? null;

      return {
        cycleTasks: visible,
        cycleStart: oldest,
      };
    }

    const pendingTimes = pendingTasks
      .map((task) => (task.created_at ? new Date(task.created_at).getTime() : 0))
      .filter((time) => Number.isFinite(time) && time > 0);

    if (!pendingTimes.length) {
      return {
        cycleTasks: pendingTasks,
        cycleStart: null as number | null,
      };
    }

    const cycleStart = Math.min(...pendingTimes);

    const cycleTasks = visible.filter((task) => {
      const createdAt = task.created_at ? new Date(task.created_at).getTime() : 0;
      return Number.isFinite(createdAt) && createdAt >= cycleStart;
    });

    return {
      cycleTasks,
      cycleStart,
    };
  };

  const getStepProgress = (tasks: Task[], isCompletedStep: boolean) => {
    if (isCompletedStep) {
      return { percent: 100, done: 1, total: 1 };
    }

    const visible = tasks.filter((task) => task.status !== "archived");
    const { cycleTasks, cycleStart } = getCurrentCycle(visible);
    const cycleTotal = cycleTasks.length;

    if (!cycleTotal) {
      return { percent: 0, done: 0, total: 0 };
    }

    const cycleDone = cycleTasks.filter((task) => task.status === "done").length;

    const historicalDone = visible.filter((task) => {
      if (task.status !== "done") return false;
      if (cycleStart === null) return false;
      const createdAt = task.created_at ? new Date(task.created_at).getTime() : 0;
      return Number.isFinite(createdAt) && createdAt > 0 && createdAt < cycleStart;
    }).length;

    const effectiveDone = Math.min(cycleTotal, cycleDone + historicalDone);
    const percent = Math.round((effectiveDone / cycleTotal) * 100);

    return { percent, done: effectiveDone, total: cycleTotal };
  };

  const effectiveView =
    view === "TASKS" && viewMode === "plan" ? "PLAN" : view;

  const renderHeader = () => (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm text-gray-900 dark:text-gray-100">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            AI Personal Coach
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
            {user?.email}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setView("HOME")}
            className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            Home
          </button>

          <button
            onClick={handleBackNavigation}
            disabled={view === "HOME"}
            className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:hover:bg-gray-700"
          >
            Back
          </button>

          <button
            onClick={logout}
            className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
          >
            Logout
          </button>
        </div>
      </div>
    </div>
  );

  const renderHomeView = () => (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button
          data-testid="new-goal-nav-button"
          onClick={() => setView("CREATE_GOAL")}
          className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-blue-700"
        >
          + Start a new goal
        </button>
      </div>

      {goals.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 border border-gray-200 dark:border-gray-700 shadow-sm text-center">
          <p className="text-base text-gray-600 dark:text-gray-300">
            You haven&apos;t started a goal yet
          </p>
          <button
            onClick={() => setView("CREATE_GOAL")}
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
          >
            Start a new goal
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
              Continue your journey
            </p>
            {activeGoal && (
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {activeGoal.title || "Active goal"}
                </h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-300">
                  {activeGoal.description || "Keep building momentum today."}
                </p>

                <div className="mt-4 flex items-center justify-between gap-4">
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                    {getPendingCountForGoal(activeGoal.id)} tasks pending
                  </span>

                  <button
                    onClick={() => {
                      void handleGoalSelect(activeGoal);
                    }}
                    className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}
          </div>

          {allTasks.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
                Today
              </p>
              <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700 shadow-sm">
                <DailySummary tasks={allTasks} />
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-semibold uppercase tracking-[0.12em] text-gray-500 dark:text-gray-400">
                Your goals
              </p>

              {remainingGoals.length > 3 && (
                <button
                  onClick={() => setShowAllGoals((prev) => !prev)}
                  className="text-sm font-medium text-blue-600 transition hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  {showAllGoals ? "Show fewer" : "View all goals"}
                </button>
              )}
            </div>

            {visibleRemainingGoals.length > 0 ? (
              <div className="space-y-3">
                {visibleRemainingGoals.map((goal: Goal, index: number) => (
                  <button
                    key={goal.id}
                    onClick={() => {
                      void handleGoalSelect(goal);
                    }}
                    className="w-full bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 text-left transition hover:shadow-md cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
                          {goal.title || `Goal ${index + 1}`}
                        </p>
                        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                          {goal.description || "Open this goal to continue your task flow."}
                        </p>
                      </div>
                      <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                        {getPendingCountForGoal(goal.id)} tasks pending
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-300">
                You only have one goal right now.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );

  const renderCreateGoalView = () => (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm text-gray-900 dark:text-gray-100">
      <GoalForm
        token={token}
        onPlanGenerated={(planData) => {
          void handlePlanGenerated(planData);
        }}
      />
    </div>
  );

  const renderPlanView = () => (
    <div className="space-y-8">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm text-gray-900 dark:text-gray-100">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">
              Roadmap
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
              Build my roadmap
            </h2>
          </div>

          <button
            data-testid="plan-generate-session-button"
            onClick={() => {
              void handleGenerateClick();
            }}
            className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            disabled={isGenerateDisabled(sessionStatus, sessionType, generatingTasks, Boolean(goalId), planCompleted)}
          >
            {getGenerateButtonLabel(sessionStatus, sessionType, generatingTasks)}
          </button>
        </div>

        {generateError && (
          <div className="mt-3 text-sm text-red-500 dark:text-red-400">
            ❌ {generateError}
          </div>
        )}

        <div className="mt-3 text-sm text-gray-500 dark:text-gray-400">
          Plan improvement will be available after a few sessions.
        </div>

        <div className="mt-6">
          <PlanView
            plan={plan}
            tasks={allGoalTasks}
            planSteps={planStepMeta}
          />
        </div>
      </div>
    </div>
  );

  const renderTasksView = () => (
    planCompleted ? (
      <div className="p-6 border rounded-lg bg-green-50 dark:bg-green-900/20 dark:border-green-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">🏁 Plan Completed</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          You&apos;ve successfully completed all steps. Great job!
        </p>

        <button
          onClick={restartPlan}
          className="mt-4 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          Start New Plan
        </button>
      </div>
    ) : (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="w-full lg:w-72 lg:flex-shrink-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm text-gray-900 dark:text-gray-100">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">
          Roadmap
        </p>
        <h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
          Current plan
        </h2>

        <div className="mt-3">
          <div className="flex justify-between text-xs text-gray-600 dark:text-gray-300 mb-1">
            <span>Step {currentStepDisplayIndex} of {totalSteps || 0}</span>
            <span>{overallStepProgressPercent}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded dark:bg-gray-700">
            <div
              className="h-2 bg-blue-500 rounded"
              style={{ width: `${overallStepProgressPercent}%` }}
            />
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {roadmapSteps.length ? (
            roadmapSteps.map((step, index) => {
              const stepId = planStepMeta[index]?.id;
              const stepTasks = allGoalTasks.filter(
                (task) => String(task.plan_step_id) === String(stepId)
              );
              const isCompletedStep = planStepMeta[index]?.status === "completed";
              const { percent: progress } = getStepProgress(stepTasks, isCompletedStep);
              const isActive = index === finalActiveStep;

              return (
                <button
                  key={`${step.title}-${index}`}
                  onClick={() => {
                    setActiveStepIndex(index);
                  }}
                  className={`w-full text-left rounded-lg border px-3 py-3 text-sm text-gray-700 dark:text-gray-200 transition ${
                    isActive
                      ? "bg-blue-50 border-blue-400 dark:bg-blue-900/20 dark:border-blue-500"
                      : "border-gray-200 bg-gray-50 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
                  }`}
                >
                  <span className="mr-2 text-xs font-semibold text-blue-600 dark:text-blue-400">
                    {index + 1}
                  </span>
                  {step.title}

                  <div className="mt-2 h-1 bg-gray-200 rounded dark:bg-gray-700">
                    <div
                      className="h-1 bg-blue-500 rounded"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </button>
              );
            })
          ) : (
            <div className="rounded-lg border border-dashed border-gray-300 px-3 py-4 text-sm text-gray-600 dark:border-gray-600 dark:text-gray-300">
              Plan titles will appear here after you build a roadmap.
            </div>
          )}
        </div>
      </aside>

      <div className="min-w-0 flex-1 space-y-8">
        {/* {allTasks.length > 0 && (
          <div className="bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-xl p-5 shadow-md">
            <div className="mx-auto max-w-3xl">
              <DailySummary tasks={allTasks} />
            </div>
          </div>
        )} */}

        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm text-gray-900 dark:text-gray-100">
          {(() => {
            const currentStepMeta = planStepMeta[finalActiveStep];
            const currentStepTasks = currentStepMeta
              ? allGoalTasks.filter(
                  (task) => String(task.plan_step_id) === String(currentStepMeta.id)
                )
              : [];
            const { percent: progressPercent } = getStepProgress(
              currentStepTasks,
              currentStepMeta?.status === "completed"
            );

            return (
              <div className="mb-4 p-4 border rounded bg-gray-50 dark:bg-gray-900 dark:border-gray-700">
                <p className="text-sm text-gray-500 dark:text-gray-400">Current Step</p>
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                  {roadmapSteps[finalActiveStep]?.title || "Current step"}
                </h3>

                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400" data-testid="current-step-indicator">
                  Step {currentStepDisplayIndex} of {totalSteps || 0}
                </p>

                <div className="mt-2">
                  <div className="flex justify-between text-xs mb-1 text-gray-600 dark:text-gray-300">
                    <span>Progress</span>
                    <span>{progressPercent}%</span>
                  </div>

                  <div className="w-full bg-gray-200 h-2 rounded dark:bg-gray-700">
                    <div
                      className="bg-blue-500 h-2 rounded"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })()}

          {stepCompleted && (
            <div className="p-6 border rounded-lg bg-green-50 dark:bg-green-900/20 dark:border-green-700 mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Nice work — you’ve completed this step 🎉</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                Ready to move to the next step
              </p>

              <button
                className="mt-4 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                onClick={() => {
                  void handleGenerateClick();
                }}
              >
                Continue to Next Step
              </button>
            </div>
          )}

          {sessionStatus === "completed" ? (
            <>
              <button
                onClick={() => { setViewMode("plan"); setView("PLAN"); }}
                className="mb-4 text-sm text-blue-600 hover:underline dark:text-blue-400"
              >
                ← Back to Plan
              </button>

              <div className="p-6 text-center border rounded dark:border-gray-700" data-testid="session-completed-screen">
                {sessionType === "primary" ? (
                  <>
                    <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">
                      🎉 {completionVariant.heading}
                    </h2>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      {completionVariant.subheading}
                    </p>
                  </>
                ) : (
                  <>
                    <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">
                      {completionVariant.heading}
                    </h2>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      {completionVariant.subheading}
                    </p>
                  </>
                )}

                <div className="mt-3 grid grid-cols-2 gap-3 text-left">
                  <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Completed</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {sessionSummary?.completed ?? 0}
                    </p>
                  </div>
                  <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Skipped</p>
                    <p className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {sessionSummary?.skipped ?? 0}
                    </p>
                  </div>
                </div>

                <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">
                  {sessionSummary?.message || sessionCompletedMessage || "Nice work today 🎉"}
                </p>

                {sessionType === "primary" ? (
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
                    <button
                      className="rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                      onClick={() => {
                        setViewMode("plan");
                        setView("PLAN");
                      }}
                    >
                      Continue Tomorrow
                    </button>
                    <button
                      className="rounded bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
                      onClick={() => {
                        void handleGenerateClick();
                      }}
                    >
                      Do More Today
                    </button>
                  </div>
                ) : (
                  <button
                    className="mt-3 bg-gray-300 text-gray-700 px-4 py-2 rounded cursor-not-allowed dark:bg-gray-700 dark:text-gray-300"
                    disabled
                  >
                    Come Back Tomorrow
                  </button>
                )}
              </div>
            </>
          ) : sessionStatus === "failed" ? (
            <div className="p-6 text-center border rounded dark:border-gray-700" data-testid="session-failed-screen">
              <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-gray-100">
                Session needs a retry
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                We couldn&apos;t finish task generation for your last session.
              </p>
              <button
                className="mt-4 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                onClick={() => {
                  void startNewSession();
                }}
              >
                Retry Session
              </button>
            </div>
          ) : todayTasks.length > 0 ? (
            <>
              
              {(() => {
                const tasksToRender = getCurrentCycle(todayTasks).cycleTasks;

                return (
                  <>
                    {stepCompleted && (
                      <h3 className="text-sm text-gray-500 dark:text-gray-400 mt-4 mb-2">
                        What you completed
                      </h3>
                    )}

                    <button
                      onClick={() => { setViewMode("plan"); setView("PLAN"); }}
                      className="mb-4 text-sm text-blue-600 hover:underline dark:text-blue-400"
                    >
                      ← Back to Plan
                    </button>


                    <TasksView
                      tasksToRender={tasksToRender}
                      token={token!}
                      onStepCompleted={() => {
                        setStepCompleted(true);
                      }}
                      onSessionCompleted={(summary) => {
                        setLatestSessionStatus("completed");
                        setSessionCompletedMessage(summary.message);
                        setSessionSummary(summary);
                      }}
                      refreshTasks={async () => {
                        if (goalId) {
                          await fetchTasks(goalId);
                          await fetchAllGoalTasks(goalId);
                        }
                      }}
                      refreshPlan={async () => {
                        if (goalId) {
                          await fetchPlan(goalId);
                        }
                      }}
                    />

                    <div className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
                      Plan improvement will be available after a few sessions.
                    </div>
                  </>
                );
              })()}
            </>
          ) : generationInProgress ? (
            <div className="text-sm text-gray-600 dark:text-gray-300" data-testid="generation-in-progress-state">
              Tasks are being generated. Please wait a moment...
            </div>
          ) : (
            <div className="text-sm text-gray-600 dark:text-gray-300">
              Your active tasks will appear here.
            </div>
          )}
        </div>
      </div>
    </div>
    )
  );

  /* =========================
     UI
  ========================= */
  return (
    <div className="min-h-screen bg-white text-black dark:bg-gray-900 dark:text-white">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {!user ? (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm text-gray-900 dark:text-gray-100">
            <Login onLogin={() => {}} />
          </div>
        ) : (
          <>
            {renderHeader()}

            {!token ? (
              <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm text-center text-gray-900 dark:text-gray-100">
                <p className="text-gray-600 dark:text-gray-300">Preparing session...</p>
              </div>
            ) : (
              <>
                {effectiveView === "HOME" && renderHomeView()}
                {effectiveView === "CREATE_GOAL" && renderCreateGoalView()}
                {effectiveView === "PLAN" && renderPlanView()}
                {effectiveView === "TASKS" && renderTasksView()}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}