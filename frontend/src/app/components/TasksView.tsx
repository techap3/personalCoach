"use client";

import { useState } from "react";

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
  token, // ✅ NEW
}: {
  tasks: Task[] | null;
  setTasks: (tasks: Task[]) => void;
  token: string | undefined;
}) {
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);

  const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

  if (!tasks || tasks.length === 0) return null;

  const completedCount = tasks.filter((t) => t.status === "done").length;
  const totalCount = tasks.length;
  const pendingCount = tasks.filter((t) => t.status !== "done").length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  const updateStatus = async (taskId: string, status: string) => {
    if (!token || !BASE_URL) {
      setUpdateError("Missing auth or backend config");
      return;
    }

    const originalTasks = tasks;

    // ✅ optimistic update
    const updatedTasks = tasks.map((t) =>
      t.id === taskId ? { ...t, status } : t
    );
    setTasks(updatedTasks);
    setUpdatingTaskId(taskId);
    setUpdateError(null);

    try {
      const resp = await fetch(`${BASE_URL}/tasks/update`, {
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
        const err = await resp.json().catch(() => ({}));
        setUpdateError(err.error || "Update failed");
        setTasks(originalTasks); // rollback
        return;
      }

      console.log(`✅ Task ${taskId} updated`);
    } catch (err) {
      console.error("Task update error:", err);
      setUpdateError("Network error");
      setTasks(originalTasks); // rollback
    } finally {
      setUpdatingTaskId(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto mt-10 px-3 sm:px-0">
      <div className="bg-white border rounded-2xl shadow-lg p-6 space-y-6">
        <div className="flex justify-between">
          <h2 className="text-2xl font-bold">Today&apos;s Tasks</h2>
          <span className="text-sm text-gray-500">
            {new Date().toLocaleDateString()}
          </span>
        </div>

        {/* Progress */}
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span>Progress</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="w-full bg-gray-200 h-2 rounded">
            <div
              className="bg-blue-500 h-2 rounded"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Nudge */}
        {completedCount === totalCount ? (
          <div className="text-green-600 text-sm">
            🎉 All tasks done!
          </div>
        ) : (
          <div className="text-yellow-600 text-sm">
            {pendingCount} pending tasks
          </div>
        )}

        {updateError && (
          <div className="text-red-500 text-sm">
            ❌ {updateError}
          </div>
        )}

        {/* Tasks */}
        <div className="space-y-4">
          {tasks.map((task) => (
            <div key={task.id} className="border p-4 rounded">
              <h3 className="font-semibold">{task.title}</h3>
              <p className="text-sm text-gray-600">{task.description}</p>

              <div className="text-xs text-gray-500 mt-1">
                Difficulty: {task.difficulty}/5
              </div>

              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => updateStatus(task.id, "done")}
                  disabled={updatingTaskId === task.id}
                  className="bg-green-500 text-white px-3 py-1 rounded"
                >
                  Done
                </button>

                <button
                  onClick={() => updateStatus(task.id, "skipped")}
                  disabled={updatingTaskId === task.id}
                  className="bg-red-500 text-white px-3 py-1 rounded"
                >
                  Skip
                </button>
              </div>

              <div className="text-xs mt-2">
                Status: {task.status || "pending"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}