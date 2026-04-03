"use client";

import { useEffect, useState, useCallback } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

import Login from "./components/Login";
import GoalForm from "./components/GoalForm";
import PlanView from "./components/PlanView";
import TasksView from "./components/TasksView";
import DailySummary from "./components/DailySummary";

import { PlanResponse } from "@/types/plan";

type Task = {
  id: string;
  title: string;
  description: string;
  difficulty: number;
  status?: string;
  plan_step_id?: number; // ✅ ADD THIS
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

export default function Home() {

  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allTasks, setAllTasks] = useState<AllTask[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [goals, setGoals] = useState<any[]>([]);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [view, setView] = useState<"HOME" | "CREATE_GOAL" | "PLAN" | "TASKS">("HOME");
  const [showAllGoals, setShowAllGoals] = useState(false);
  const [showTodayTasks, setShowTodayTasks] = useState(false);
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  const [adapting, setAdapting] = useState(false);
  const [adaptError, setAdaptError] = useState<string | null>(null);

  const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL;
  const token = session?.access_token;

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
    setTasks([]);
    setAllTasks([]);
    setGoals([]);
    setGoalId(null);
    setView("HOME");
  };

  /* =========================
     FETCH TASKS (ALL STATES)
  ========================= */
  const fetchTasks = useCallback(async (goalId: string): Promise<Task[]> => {
    const apiBaseUrl = getApiBaseUrl();

    console.log("👉 FETCH goal_id:", goalId);

    if (!apiBaseUrl || !token) return [] as Task[];

    console.log("📡 Fetching ALL tasks...");

    try {
      const res = await fetch(`${apiBaseUrl}/tasks?goal_id=${goalId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();

      console.log("📋 RAW TASK RESPONSE:", data);

      const normalizedTasks: Task[] = (Array.isArray(data) ? data : data.tasks || []).map((task: Task) => ({
        ...task,
        plan_step_id: Number(task.plan_step_id),
      }));

      console.log("✅ NORMALIZED TASKS:", normalizedTasks);
      console.log(
        "✅ TASK SHAPE CHECK:",
        normalizedTasks.map((task: Task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          plan_step_id: task.plan_step_id,
        }))
      );

      setTasks(normalizedTasks);
      return normalizedTasks;
    } catch (err) {
      console.error("❌ Fetch tasks error:", err);
      return [] as Task[];
    }
  }, [getApiBaseUrl, token]);

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

    setPlan((data?.plan_json as PlanResponse | null) ?? null);
  }, []);

  /* =========================
     FETCH ALL USER TASKS
  ========================= */
  const fetchAllTasks = useCallback(async () => {
    const apiBaseUrl = getApiBaseUrl();

    if (!apiBaseUrl || !token) return;

    console.log("📊 Fetching ALL user tasks...");

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
    }
  }, [goalId, fetchPlan, fetchTasks]);

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

  const generateTodaysTasks = async () => {
    const apiBaseUrl = getApiBaseUrl();

    if (!goalId || !apiBaseUrl || !token) return;

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
        const err = await res.text();
        console.error("❌ Task gen error:", err);
        return;
      }

      await res.json();
      const normalizedTasks = await fetchTasks(goalId);

      const firstPendingStep = plan?.plan?.findIndex((_, index) => {
        const stepTasks = normalizedTasks.filter(
          (task) => Number(task.plan_step_id) === index
        );

        return stepTasks.some((task) => task.status === "pending");
      });

      if (firstPendingStep !== undefined && firstPendingStep !== -1) {
        setActiveStepIndex(firstPendingStep);
      }

      setShowTodayTasks(true);
      await fetchAllTasks();
      setView("TASKS");
    } catch (err) {
      console.error("❌ Task generation failed:", err);
    }
  };

  const handleGoalSelect = async (goal: Goal) => {
    setGoalId(goal.id);
    setActiveStepIndex(0);
    setShowTodayTasks(false);
    setView("TASKS");
  };

  const handleBackNavigation = () => {
    if (view === "PLAN") {
      setView("HOME");
      return;
    }

    if (view === "TASKS") {
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

  const derivedActiveStep = plan?.plan?.findIndex((_, index) => {
    const stepTasks = tasks.filter(
      (task) => Number(task.plan_step_id) === index
    );

    return stepTasks.some((task) => task.status === "pending");
  });

  const finalActiveStep =
    derivedActiveStep !== -1 && derivedActiveStep !== undefined
      ? derivedActiveStep
      : activeStepIndex;

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
        goalId={goalId}
        fetchTasks={fetchTasks}
        token={token}
        onPlanGenerated={(planData) => {
          void handlePlanGenerated(planData);
        }}
        onTasksGenerated={(id) => {
          setGoalId(id);
          void fetchTasks(id);
          void fetchAllTasks();
          setView("TASKS");
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
            onClick={() => {
              setShowTodayTasks(true);

              if (plan?.plan?.length) {
                const firstPendingStep = plan.plan.findIndex((_, index) => {
                  const stepTasks = tasks.filter(
                    (task) => Number(task.plan_step_id) === index
                  );

                  return stepTasks.some((task) => task.status === "pending");
                });

                if (firstPendingStep !== -1) {
                  setActiveStepIndex(firstPendingStep);
                }
              }

              void generateTodaysTasks();
            }}
            className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
            disabled={!goalId}
          >
            Give me today&apos;s tasks
          </button>
        </div>

        <div className="mt-6">
          <PlanView plan={plan} tasks={tasks} />
        </div>
      </div>
    </div>
  );

  const renderTasksView = () => (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="w-full lg:w-72 lg:flex-shrink-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 shadow-sm text-gray-900 dark:text-gray-100">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-blue-600 dark:text-blue-400">
          Roadmap
        </p>
        <h2 className="mt-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
          Current plan
        </h2>

        <div className="mt-6 space-y-3">
          {plan?.plan?.length ? (
            plan.plan.map((step, index) => (
              <button
                key={`${step.title}-${index}`}
                onClick={() => {
                  setActiveStepIndex(index);
                  setShowTodayTasks(false);
                }}
                className={`w-full text-left rounded-lg border px-3 py-3 text-sm text-gray-700 dark:text-gray-200 transition ${
                  index === finalActiveStep
                    ? "bg-blue-50 border-blue-500 dark:bg-blue-900/20 dark:border-blue-500"
                    : "border-gray-200 bg-gray-50 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800"
                }`}
              >
                <span className="mr-2 text-xs font-semibold text-blue-600 dark:text-blue-400">
                  {index + 1}
                </span>
                {step.title}
              </button>
            ))
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
          {tasks.length > 0 ? (
            <>
              
              {(() => {
                if (!plan) return null;

                const stepTasks = tasks.filter(
                  (task) => Number(task.plan_step_id) === finalActiveStep
                );

                const tasksToRender = tasks;

                console.log("TOTAL TASKS:", tasks.length);
                console.log("STEP TASKS:", stepTasks.length);
                console.log("ACTIVE STEP:", finalActiveStep);

                return (
                  <>
                    {showTodayTasks && (
                      <button
                        onClick={() => setShowTodayTasks(false)}
                        className="mb-4 text-sm text-blue-600 hover:underline dark:text-blue-400"
                      >
                        ← Back to Plan
                      </button>
                    )}

                    <div className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                      DEBUG: {tasks.length} total / {stepTasks.length} filtered
                    </div>

                    <TasksView
                      tasksToRender={tasksToRender}
                      token={token!}
                      refreshTasks={async () => {
                        if (goalId) {
                          await fetchTasks(goalId);
                        }
                      }}
                    />
                  </>
                );
              })()}

              {goalId && tasks.some((t) => t.status === "pending") && (
                <div className="mt-6 text-center">
                  <button
                    className="rounded-lg bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={adaptTasks}
                    disabled={adapting}
                  >
                    {adapting ? "Improving..." : "Improve My Plan"}
                  </button>

                  {adaptError && (
                    <div className="mt-3 text-sm text-red-500 dark:text-red-400">
                      ❌ {adaptError}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-gray-600 dark:text-gray-300">
              Your active tasks will appear here.
            </div>
          )}
        </div>
      </div>
    </div>
  );

  /* =========================
     ADAPT
  ========================= */
  const adaptTasks = async () => {
    const apiBaseUrl = getApiBaseUrl();

    if (!goalId || !apiBaseUrl || !token) return;

    setAdapting(true);
    setAdaptError(null);

    try {
      const res = await fetch(`${apiBaseUrl}/tasks/adapt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ goal_id: goalId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setAdaptError(err.error || "Adapt failed");
        return;
      }

      console.log("✅ Adapt success → refetching");

      await fetchTasks(goalId);
    } catch (err) {
      console.error(err);
      setAdaptError("Network error");
    } finally {
      setAdapting(false);
    }
  };

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
                {view === "HOME" && renderHomeView()}
                {view === "CREATE_GOAL" && renderCreateGoalView()}
                {view === "PLAN" && renderPlanView()}
                {view === "TASKS" && renderTasksView()}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}