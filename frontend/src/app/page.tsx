"use client";

import { useEffect, useState } from "react";
import { User, Session } from "@supabase/supabase-js";
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
  console.log("🚀 PAGE RENDERED");

  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);

  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [goalId, setGoalId] = useState<string | null>(null);

  const [adapting, setAdapting] = useState(false);
  const [adaptError, setAdaptError] = useState<string | null>(null);

  const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL;
  const token = session?.access_token;

  console.log("ENV BASE_URL:", BASE_URL);
  console.log("SESSION:", session);
  console.log("TOKEN:", token);

  // 🔐 Auth setup (SAFE)
  useEffect(() => {
    console.log("🔄 AUTH EFFECT RUNNING");

    supabase.auth
      .getSession()
      .then(({ data }) => {
        console.log("✅ INITIAL SESSION:", data);
        setUser(data.session?.user ?? null);
        setSession(data.session ?? null);
      })
      .catch((err) => {
        console.error("❌ SESSION ERROR:", err);
      });

    const { data: { subscription } } =
      supabase.auth.onAuthStateChange((_event, session) => {
        console.log("🔁 AUTH CHANGE:", session);
        setUser(session?.user ?? null);
        setSession(session ?? null);
      });

    return () => subscription.unsubscribe();
  }, []);

  // 🚪 Logout
  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setPlan(null);
    setTasks(null);
    setGoalId(null);
  };

  // 📦 Fetch tasks
  const fetchTasks = async (goalId: string) => {
    if (!BASE_URL || !token) {
      console.warn("Missing BASE_URL or token");
      return;
    }

    const res = await fetch(
      `${BASE_URL}/tasks?goal_id=${goalId}&status=pending`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (!res.ok) {
      console.error("Fetch tasks failed");
      return;
    }

    const data = await res.json();
    setTasks([...data]);
  };

  // 🌟 Adapt tasks
  const adaptTasks = async () => {
    if (!goalId || !BASE_URL || !token) return;

    setAdapting(true);
    setAdaptError(null);

    try {
      const res = await fetch(`${BASE_URL}/tasks/adapt`, {
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

      await fetchTasks(goalId);
    } catch (err) {
      console.error(err);
      setAdaptError("Network error");
    } finally {
      setAdapting(false);
    }
  };

  const pendingCount =
    tasks?.filter((t) => t.status === "pending").length || 0;

  // 🔴 ALWAYS SHOW SOMETHING (NO BLANK SCREEN)
  return (
    <div className="p-6">
      {/* DEBUG PANEL */}
      <div className="mb-4 p-3 bg-gray-100 text-xs rounded">
        <div><b>User:</b> {user ? "Yes" : "No"}</div>
        <div><b>Session:</b> {session ? "Yes" : "No"}</div>
        <div><b>Token:</b> {token ? "Yes" : "No"}</div>
        <div><b>Backend URL:</b> {BASE_URL || "Missing"}</div>
      </div>

      {/* NOT LOGGED IN */}
      {!user ? (
        <Login onLogin={() => {}} />
      ) : (
        <>
          {/* Header */}
          <div className="flex justify-between items-center max-w-2xl mx-auto mb-6">
            <div>
              <h1 className="text-xl font-bold">AI Personal Coach</h1>
              <p className="text-sm text-gray-500">{user.email}</p>
            </div>

            <button
              onClick={logout}
              className="bg-gray-200 px-3 py-1 rounded"
            >
              Logout
            </button>
          </div>

          {/* WAIT FOR TOKEN */}
          {!token ? (
            <div className="text-center text-gray-500 mt-10">
              Preparing session...
            </div>
          ) : (
            <>
              <GoalForm
                goalId={goalId}
                fetchTasks={fetchTasks}
                token={token}
                onPlanGenerated={(planData) => {
                  setPlan(planData);
                }}
                onTasksGenerated={(id) => {
                  setGoalId(id);
                  fetchTasks(id);
                }}
              />

              <PlanView plan={plan} />

              <TasksView
                tasks={tasks}
                setTasks={setTasks}
                token={token}
              />

              {goalId && (
                <div className="max-w-2xl mx-auto mt-6 text-center">
                  {pendingCount > 0 && (
                    <button
                      className="bg-blue-600 text-white px-4 py-2 rounded"
                      onClick={adaptTasks}
                    >
                      Improve My Plan
                    </button>
                  )}

                  {adaptError && (
                    <div className="mt-3 text-red-500 text-sm">
                      ❌ {adaptError}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}