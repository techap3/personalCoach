"use client";

import { useMemo, useState } from "react";

type Task = {
  id: string;
  title: string;
  description: string;
  difficulty: number;
  task_type?: "action" | "learn" | "reflect" | "review" | "plan";
  status?: string;
  plan_step_id?: string | number;
};

export default function TasksView({
  tasksToRender,
  token,
  refreshTasks,
  refreshPlan,
  onStepCompleted,
  onSessionCompleted,
}: {
  tasksToRender: Task[];
  token: string;
  refreshTasks: () => void | Promise<void>;
  refreshPlan?: () => void | Promise<void>;
  onStepCompleted?: () => void;
  onSessionCompleted?: (summary: {
    completed: number;
    skipped: number;
    completion_rate: number;
    message: string;
  }) => void;
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

  const getTaskTypeStyles = (taskType?: Task["task_type"]) => {
    const resolvedTaskType = taskType || "learn";

    if (resolvedTaskType === "action") {
      return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-700";
    }
    if (resolvedTaskType === "learn") {
      return "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-200 dark:border-indigo-700";
    }
    if (resolvedTaskType === "reflect") {
      return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-700";
    }
    if (resolvedTaskType === "review") {
      return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-700";
    }
    if (resolvedTaskType === "plan") {
      return "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-200 dark:border-violet-700";
    }

    return "bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700";
  };

  const formatTaskType = (taskType?: Task["task_type"]) => {
    const resolvedTaskType = taskType || "learn";
    return resolvedTaskType.charAt(0).toUpperCase() + resolvedTaskType.slice(1);
  };

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

      const response = await res.json();

      if (response?.stepCompleted) {
        onStepCompleted?.();
      }

      if (response?.sessionCompleted && response?.session_summary) {
        onSessionCompleted?.(response.session_summary);
      }

      console.log("🔁 REFRESHING AFTER UPDATE");
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
          (() => {
            const isExpanded = expandedTaskId === task.id;

            return (
              <div
                key={task.id}
                data-testid={`task-card-${task.id}`}
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

                <div className="mt-2">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${getTaskTypeStyles(task.task_type)}`}
                  >
                    {formatTaskType(task.task_type)}
                  </span>
                </div>

                {isExpanded && (
              <>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{task.description}</p>

                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Difficulty: {task.difficulty}/5
                </p>

                {task.status === "pending" && (
                  <div className="flex gap-2 mt-3">
                    <button
                      data-testid={`task-done-${task.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void markTask(task.id, "done");
                      }}
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      Done
                    </button>

                    <button
                      data-testid={`task-skip-${task.id}`}
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
            );
          })()
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
