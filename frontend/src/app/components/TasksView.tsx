"use client";

import { useMemo, useState } from "react";

type Task = {
  id: string;
  title: string;
  description: string;
  difficulty: number;
  status?: string;
  plan_step_id?: string | number;
};

export default function TasksView({
  tasksToRender,
  token,
  refreshTasks,
  refreshPlan,
}: {
  tasksToRender: Task[];
  token: string;
  refreshTasks: () => void | Promise<void>;
  refreshPlan?: () => void | Promise<void>;
}) {
  const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL;
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  const getTaskStyles = (status?: string) => {
    if (status === "done") {
      return "border-green-200 bg-green-50 text-green-800 dark:border-green-700 dark:bg-green-900/20 dark:text-green-200";
    }

    if (status === "skipped") {
      return "border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-200";
    }

    return "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900";
  };

  const visibleTasks = useMemo(
    () => tasksToRender.filter((task) => task.status !== "archived"),
    [tasksToRender]
  );

  const completedTasks = useMemo(
    () => visibleTasks.filter((task) => task.status === "done"),
    [visibleTasks]
  );

  const sortedTasks = useMemo(() => {
    const order: Record<string, number> = {
      pending: 0,
      done: 1,
      skipped: 2,
    };

    return [...visibleTasks].sort((a, b) => {
      const aStatus = a.status || "pending";
      const bStatus = b.status || "pending";
      return (order[aStatus] ?? 99) - (order[bStatus] ?? 99);
    });
  }, [visibleTasks]);

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
      if (refreshPlan) {
        await refreshPlan();
      }
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

      <div className="space-y-3">
        {sortedTasks.map((task) => (
          <div
            key={task.id}
            className={`rounded-lg border p-4 transition cursor-pointer ${getTaskStyles(task.status)}`}
            onClick={() => {
              setExpandedTaskId((prev) => (prev === task.id ? null : task.id));
            }}
          >
            <p className="text-xs font-medium uppercase mb-1">
              {task.status === "done" && "Completed"}
              {task.status === "skipped" && "Skipped"}
              {(task.status === "pending" || !task.status) && "Pending"}
            </p>

            <h3
              className={`font-semibold text-gray-900 dark:text-gray-100 ${
                task.status === "done" ? "line-through" : ""
              }`}
            >
              {task.title}
            </h3>

            {expandedTaskId === task.id && (
              <>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{task.description}</p>

                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Difficulty: {task.difficulty}/5
                </p>

                {task.status === "pending" && (
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void markTask(task.id, "done");
                      }}
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      Done
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        void markTask(task.id, "skipped");
                      }}
                      className="rounded-md bg-gray-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
                    >
                      Skip
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {tasksToRender.length === 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-300">
          No tasks available for this step yet.
        </p>
      )}
    </div>
  );
}
