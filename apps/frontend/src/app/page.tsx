"use client";

import { useEffect, useState, useCallback } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

import Login from "./components/Login";
import AppFlow from "./components/appflow/AppFlow";
import type { CreateGoalPayload } from "./components/appflow/types";
import {
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
  task_type?: "action" | "learn" | "reflect" | "review" | "plan";
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

const buildFallbackTasks = (goalTitle: string): Task[] => {
  const now = new Date().toISOString();
  const base = goalTitle || "Your goal";

  return [
    {
      id: `fallback-${Date.now()}-1`,
      title: `Define first action for ${base}`,
      description: "Pick one concrete action you can finish in under 20 minutes.",
      difficulty: 1,
      status: "pending",
      created_at: now,
    },
    {
      id: `fallback-${Date.now()}-2`,
      title: "Schedule focused time",
      description: "Block one uninterrupted time slot today for this goal.",
      difficulty: 2,
      status: "pending",
      created_at: now,
    },
    {
      id: `fallback-${Date.now()}-3`,
      title: "Complete and reflect",
      description: "Finish the first action and capture one learning.",
      difficulty: 2,
      status: "pending",
      created_at: now,
    },
  ];
};

export default function Home() {

  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [todayTasks, setTodayTasks] = useState<Task[]>([]);
  const [, setAllGoalTasks] = useState<Task[]>([]);
  const [planStepMeta, setPlanStepMeta] = useState<PlanStepMeta[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [goals, setGoals] = useState<any[]>([]);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [, setView] = useState<"HOME" | "CREATE_GOAL" | "PLAN" | "TASKS" | "COACH_FLOW">("HOME");
  const [, setActiveStepIndex] = useState(0);

  const [sessionCompletedMessage, setSessionCompletedMessage] = useState<string | null>(null);
  const [sessionSummary, setSessionSummary] = useState<SessionSummary | null>(null);
  const [latestSessionStatus, setLatestSessionStatus] = useState<SessionStatus>(SESSION_STATUS.NONE);
  const [latestSessionType, setLatestSessionType] = useState<SessionType>(DEFAULT_SESSION_TYPE);
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
    setGoals([]);
    setGoalId(null);
    setView("HOME");
    setSessionCompletedMessage(null);
    setSessionSummary(null);
    setLatestSessionStatus(SESSION_STATUS.NONE);
    setLatestSessionType(DEFAULT_SESSION_TYPE);
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
      fetchGoals();
    }
  }, [token, fetchGoals]);

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

  const createGoalAndStartFromFlow = async (payload: CreateGoalPayload) => {
    const apiBaseUrl = getApiBaseUrl();

    if (!apiBaseUrl || !token) {
      throw new Error("Missing API base URL or token");
    }

    setGeneratingTasks(true);
    setGenerateError(null);
    setPlanCompleted(false);
    setSessionCompletedMessage(null);
    setSessionSummary(null);
    setLatestSessionStatus(SESSION_STATUS.NONE);
    setLatestSessionType(DEFAULT_SESSION_TYPE);
    setGenerationInProgress(false);

    try {
      const goalRes = await fetch(`${apiBaseUrl}/goals`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: payload.title,
          description: `${payload.description} (intensity: ${payload.intensity})`,
        }),
      });

      if (!goalRes.ok) {
        const goalErr = await goalRes.text();
        throw new Error(goalErr || "Goal creation failed");
      }

      const goalData = await goalRes.json();
      const createdGoalId: string | undefined = goalData?.goal?.id;
      const createdPlan: PlanResponse | null = goalData?.plan ?? null;

      if (!createdGoalId) {
        throw new Error("Goal created without an ID");
      }

      setGoalId(createdGoalId);
      if (createdPlan) {
        setPlan(createdPlan);
      }

      const goalsData = await fetchGoals();
      if (!goalsData.some((goal) => goal.id === createdGoalId)) {
        setGoals((prev) => [
          {
            id: createdGoalId,
            title: payload.title,
            description: payload.description,
            created_at: new Date().toISOString(),
          },
          ...(Array.isArray(prev) ? prev : []),
        ]);
      }

      const taskRes = await fetch(`${apiBaseUrl}/tasks/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ goal_id: createdGoalId }),
      });

      if (!taskRes.ok) {
        const taskErr = await taskRes.text();
        console.error("❌ Task generation on create-goal flow failed:", taskErr);
        const fallback = buildFallbackTasks(payload.title);
        setTodayTasks(fallback);
        setLatestSessionStatus(SESSION_STATUS.ACTIVE);
        setLatestSessionType(DEFAULT_SESSION_TYPE);
        return;
      }

      const taskPayload = await taskRes.json();
      const generatedTasks: Task[] = Array.isArray(taskPayload)
        ? taskPayload
        : Array.isArray(taskPayload?.tasks)
          ? taskPayload.tasks
          : [];

      const normalizedGeneratedTasks: Task[] = generatedTasks.map((task: Task) => ({
        ...task,
        status: "pending",
        plan_step_id: task.plan_step_id ? String(task.plan_step_id) : undefined,
      }));

      if (normalizedGeneratedTasks.length >= 2) {
        setTodayTasks(normalizedGeneratedTasks);
      } else {
        const refreshed = await fetchTasks(createdGoalId);
        const normalizedRefreshed = refreshed.map((task) => ({
          ...task,
          status: "pending",
        }));

        if (normalizedRefreshed.length >= 2) {
          setTodayTasks(normalizedRefreshed);
        } else {
          setTodayTasks(buildFallbackTasks(payload.title));
        }
      }

      await fetchPlan(createdGoalId);
      await fetchAllGoalTasks(createdGoalId);

      setLatestSessionStatus(SESSION_STATUS.ACTIVE);
      setLatestSessionType(DEFAULT_SESSION_TYPE);
      setView("TASKS");
    } catch (err) {
      console.error("❌ Create-goal flow failed:", err);
      setGenerateError("Could not start your goal. Please try again.");
      throw err;
    } finally {
      setGeneratingTasks(false);
    }
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
        setView("TASKS");
        return;
      }

      if (normalizedGeneratedTasks.length > 0) {
        setTodayTasks(normalizedGeneratedTasks);
      }

      // Success path always transitions into tasks view.
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
    setGoalId(null);
    setPlan(null);
    setPlanStepMeta([]);
    setTodayTasks([]);
    setAllGoalTasks([]);
    setView("CREATE_GOAL");
  };

  const sessionStatus: SessionStatus = latestSessionStatus;
  const sessionType: SessionType = latestSessionType;

  if (!user) {
    return (
      <div className="min-h-screen bg-[var(--pc-bg)] px-4 py-8">
        <div className="mx-auto max-w-md rounded-[16px] border border-[#1E2734] bg-[#0E141D] p-5 shadow-[var(--pc-shadow-soft)]">
          <Login onLogin={() => {}} />
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-[var(--pc-bg)] px-4 py-8 text-[var(--pc-text-primary)]">
        <div className="mx-auto max-w-md rounded-[16px] border border-[#1E2734] bg-[#0E141D] p-5 text-center shadow-[var(--pc-shadow-soft)]">
          Preparing session...
        </div>
      </div>
    );
  }

  return (
    <AppFlow
      userEmail={user.email}
      goals={goals}
      todayTasks={todayTasks}
      plan={plan}
      sessionCompletedMessage={sessionCompletedMessage}
      sessionSummary={sessionSummary}
      generateError={generateError}
      isLoading={generatingTasks || generationInProgress}
      sessionStatus={sessionStatus}
      planCompleted={planCompleted}
      onLogout={logout}
      onStartCreateGoal={() => {
        setView("CREATE_GOAL");
      }}
      onCreateGoalAndStart={createGoalAndStartFromFlow}
      onPlanGenerated={(planData) => {
        void handlePlanGenerated(planData);
      }}
      onSelectGoal={async (selectedGoalId) => {
        const selectedGoal = goals.find((goal: Goal) => goal.id === selectedGoalId);
        if (selectedGoal) {
          await handleGoalSelect(selectedGoal);
        }
      }}
      onGenerateSession={handleGenerateClick}
      onRestartPlan={restartPlan}
      onStepCompleted={() => {}}
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
      token={token}
    />
  );
}