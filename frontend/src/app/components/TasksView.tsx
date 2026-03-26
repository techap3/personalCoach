"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

type Task = {
  id: string;
  title: string;
  description: string;
  difficulty: number;
  status?: string;
};

export default function TasksView({
  tasks,
  setTasks,
}: {
  tasks: Task[] | null;
  setTasks: (tasks: Task[]) => void;
}) {
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);

  if (!tasks || tasks.length === 0) return null;

  const completedCount = tasks.filter((t) => t.status === "done").length;
  const totalCount = tasks.length;
  const pendingCount = tasks.filter((t) => t.status !== "done").length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  const updateStatus = async (taskId: string, status: string) => {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;

    if (!token) {
      setUpdateError("No auth token available");
      return;
    }

    // Store original state for rollback
    const originalTasks = tasks;

    // ✅ 1. Optimistic UI update
    const updatedTasks = tasks.map((t) =>
      t.id === taskId ? { ...t, status } : t
    );
    setTasks(updatedTasks);
    setUpdatingTaskId(taskId);
    setUpdateError(null);

    try {
      // ✅ 2. Backend update
      const resp = await fetch("http://localhost:3001/tasks/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          task_id: taskId,
          status,
        }),
      });

      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        const errorMsg = errorData.error || `Status ${resp.status}: ${resp.statusText}`;
        console.error("Task update failed:", errorMsg);
        setUpdateError(errorMsg);
        // Rollback UI on failure
        setTasks(originalTasks);
        return;
      }

      console.log(`✅ Task ${taskId} updated to status: ${status}`);
      setUpdateError(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      console.error("Task update error:", errorMsg);
      setUpdateError(errorMsg);
      // Rollback UI on failure
      setTasks(originalTasks);
    } finally {
      setUpdatingTaskId(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto mt-10 px-3 sm:px-0">
      <div className="bg-white border border-gray-200 rounded-2xl shadow-lg p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">Today&apos;s Tasks</h2>
          <span className="text-sm font-medium text-slate-500">{new Date().toLocaleDateString()}</span>
        </div>

        {/* Progress */}
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-slate-700">Progress</p>
            <p className="text-sm font-semibold text-blue-600">{Math.round(progress)}%</p>
          </div>
          <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-3 bg-gradient-to-r from-blue-500 to-cyan-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {completedCount} completed • {pendingCount} pending • {totalCount} total
          </div>
        </div>

        {/* Nudge messages */}
        {completedCount === totalCount ? (
          <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800 shadow-sm">
            🎉 <span className="font-semibold">All tasks are done!</span> Fantastic progress today. Consider setting up new goals for tomorrow.
          </div>
        ) : pendingCount > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 shadow-sm">
            ⏳ <span className="font-semibold">{pendingCount} pending task{pendingCount === 1 ? "" : "s"}.</span> You’re close — finish the next one now and build momentum.
          </div>
        ) : null}

        {updateError && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded text-sm">
            ❌ {updateError}
          </div>
        )}

        <div className="grid gap-4">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm transition hover:shadow-md"
            >
              <h3 className="font-semibold">{task.title}</h3>

              <p className="text-sm text-gray-600 mt-1">{task.description}</p>

              <div className="mt-2 text-xs text-gray-500">Difficulty: {task.difficulty}/5</div>

              <div className="flex gap-2 mt-3">
                <button
                  className="bg-green-500 hover:bg-green-600 text-white px-3 py-1 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => updateStatus(task.id, "done")}
                  disabled={updatingTaskId === task.id}
                >
                  {updatingTaskId === task.id ? "Saving..." : "Done"}
                </button>

                <button
                  className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => updateStatus(task.id, "skipped")}
                  disabled={updatingTaskId === task.id}
                >
                  {updatingTaskId === task.id ? "Saving..." : "Skip"}
                </button>
              </div>

              <div className="text-xs mt-2 text-slate-500">
                Status: <span className={task.status === "done" ? "text-green-600" : task.status === "skipped" ? "text-amber-600" : "text-slate-600"}>{task.status || "pending"}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}