"use client";

import { useEffect, useState } from "react";
import { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

import Login from "./components/Login";
import GoalForm from "./components/GoalForm";
import PlanView from "./components/PlanView";
import TasksView from "./components/TasksView";

import { PlanResponse } from "@/types/plan";

type Task = {
  id: string;
  title: string;
  description: string;
  difficulty: number;
  status?: string;
};

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [adapting, setAdapting] = useState(false);
  const [adaptError, setAdaptError] = useState<string | null>(null);
  // 🔐 Handle auth state changes
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // 🚪 Logout
  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setPlan(null);
    setTasks(null);
    setGoalId(null);
    setAdaptError(null);
  };

  // 🔑 Copy auth token
  const copyToken = async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (token) {
        await navigator.clipboard.writeText(token);
        setTokenCopied(true);
        setTimeout(() => setTokenCopied(false), 2000); // Hide after 2 seconds
      }
    } catch (error) {
      console.error("Failed to copy token:", error);
    }
  };

  // 📦 Fetch pending tasks from DB
  const fetchTasks = async (goalId: string) => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;

    const res = await fetch(
      `http://localhost:3001/tasks?goal_id=${goalId}&status=pending`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!res.ok) {
      console.error("Failed to fetch tasks:", res.statusText);
      return;
    }

    const data = await res.json();
    setTasks(data);
  };

  // 🌟 Adapt tasks via AI endpoint
  const adaptTasks = async () => {
    if (!goalId) {
      console.warn("adaptTasks: goalId missing");
      return;
    }

    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;

    if (!token) {
      console.warn("adaptTasks: no auth token available");
      return;
    }

    setAdapting(true);
    setAdaptError(null);
    try {
      const resp = await fetch("http://localhost:3001/tasks/adapt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ goal_id: goalId }),
      });

      if (!resp.ok) {
        let errorMessage = "Task adaptation failed";
        try {
          const errorPayload = await resp.json();
          errorMessage = errorPayload.error || `Status ${resp.status}: ${resp.statusText}`;
        } catch (_parseErr) {
          errorMessage = `Status ${resp.status}: ${resp.statusText}`;
        }
        console.error("adaptTasks failed:", errorMessage);
        setAdaptError(errorMessage);
        return;
      }

      await fetchTasks(goalId);
      setAdaptError(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      console.error("adaptTasks error:", errorMsg);
      setAdaptError(errorMsg);
    } finally {
      setAdapting(false);
    }
  };

  // � Count pending tasks
  const pendingCount = tasks?.filter((t) => t.status === "pending").length || 0;

  // �🔐 Show login if not authenticated
  if (!user) {
    return <Login onLogin={() => {}} />;
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex justify-between items-center max-w-2xl mx-auto mb-6">
        <div>
          <h1 className="text-xl font-bold">AI Personal Coach</h1>
          <p className="text-sm text-gray-500">{user?.email}</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={copyToken}
            className="bg-blue-100 text-blue-700 px-3 py-1 rounded text-sm"
          >
            Copy Token
          </button>
          <button
            onClick={logout}
            className="bg-gray-200 px-3 py-1 rounded"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Success message */}
      {tokenCopied && (
        <div className="max-w-2xl mx-auto mb-4 p-2 bg-green-100 text-green-700 rounded text-sm text-center">
          ✅ Token copied to clipboard!
        </div>
      )}

      {/* Goal + Plan */}
      <GoalForm
        goalId={goalId}
        fetchTasks={fetchTasks}
        onPlanGenerated={(planData: PlanResponse) => {
          setPlan(planData);
          setAdaptError(null);
        }}
        onTasksGenerated={(id: string) => {
          setGoalId(id);
          setAdaptError(null);
          fetchTasks(id); // ✅ correct place for fetching tasks
        }}
      />

      {/* Plan View */}
      <PlanView plan={plan} />

      {/* Tasks View */}
      <TasksView
        tasks={tasks}
        setTasks={setTasks}
      />

      {goalId && (
        <div className="max-w-2xl mx-auto mt-6 text-center">
          {pendingCount > 0 ? (
            <>
              <button
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-50"
                onClick={adaptTasks}
                disabled={adapting}
              >
                {adapting ? "Improving..." : "Improve My Plan"}
              </button>
              <div className="text-sm text-gray-500 mt-2">
                {pendingCount} pending task{pendingCount !== 1 ? "s" : ""}
              </div>
            </>
          ) : (
            <div className="p-3 bg-yellow-100 text-yellow-700 rounded text-sm">
              ℹ️ All tasks are completed or skipped. Generate new tasks to adapt them.
            </div>
          )}

          {adaptError && (
            <div className="mt-3 p-2 bg-red-100 text-red-700 rounded text-sm">
              ❌ {adaptError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}