"use client";

import { useMemo } from "react";

type Task = {
  id: string;
  title: string;
  description: string;
  difficulty: number;
  status?: string;
  plan_step_id?: number;
};

export default function TasksView({
  tasksToRender,
  token,
  refreshTasks,
}: {
  tasksToRender: Task[];
  token: string;
  refreshTasks: () => void | Promise<void>;
}) {
  const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

  const visibleTasks = useMemo(
    () => tasksToRender.filter((task) => task.status !== "archived"),
    [tasksToRender]
  );

  const pendingTasks = useMemo(
    () => visibleTasks.filter((task) => task.status === "pending"),
    [visibleTasks]
  );
  const completedTasks = useMemo(
    () => visibleTasks.filter((task) => task.status === "done"),
    [visibleTasks]
  );
  const skippedTasks = useMemo(
    () => visibleTasks.filter((task) => task.status === "skipped"),
    [visibleTasks]
  );

  console.log("RENDER SOURCE:", {
    total: visibleTasks.length,
    rendered: tasksToRender.length,
    pending: pendingTasks.length,
  });

  if (!tasksToRender || tasksToRender.length === 0) return null;

  const markTask = async (taskId: string, status: "done" | "skipped") => {
    if (!BASE_URL || !token) return;

    try {
      const res = await fetch(`${BASE_URL}/tasks/update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ task_id: taskId, status }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error("❌ Task update error:", err);
        return;
      }

      await refreshTasks();
    } catch (err) {
      console.error("❌ Task update failed:", err);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          Today&apos;s Tasks
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-300">
          {completedTasks.length}/{visibleTasks.length} completed
        </p>
      </div>

      {pendingTasks.length > 0 && (
        <div className="space-y-3">
          {pendingTasks.map((task) => (
            <div
              key={task.id}
              className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
            >
              <p className="font-medium text-gray-900 dark:text-gray-100">{task.title}</p>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{task.description}</p>

              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  Difficulty: {task.difficulty}/5
                </span>

                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      void markTask(task.id, "done");
                    }}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    Done
                  </button>
                  <button
                    onClick={() => {
                      void markTask(task.id, "skipped");
                    }}
                    className="rounded-md bg-gray-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
                  >
                    Skip
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {completedTasks.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Completed
          </p>
          {completedTasks.map((task) => (
            <div
              key={task.id}
              className="rounded-lg border border-gray-200 bg-gray-50 p-4 opacity-80 dark:border-gray-700 dark:bg-gray-900"
            >
              <p className="font-medium line-through text-gray-700 dark:text-gray-300">{task.title}</p>
            </div>
          ))}
        </div>
      )}

      {skippedTasks.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Skipped
          </p>
          {skippedTasks.map((task) => (
            <div
              key={task.id}
              className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 opacity-70 dark:border-gray-600 dark:bg-gray-900"
            >
              <p className="font-medium text-gray-700 dark:text-gray-300">{task.title}</p>
            </div>
          ))}
        </div>
      )}

      {tasksToRender.length === 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          No tasks available for this step yet.
        </p>
      )}
    </div>
  );
}
