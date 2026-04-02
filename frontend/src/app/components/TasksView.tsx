"use client";

type Task = {
  id: string;
  title: string;
  description: string;
  difficulty: number;
  status?: string;
  scheduled_date?: string;
};

export default function TasksView({
  tasks,
  token,
  refreshTasks,
}: {
  tasks: Task[];
  token: string;
  refreshTasks: () => void;
}) {
  const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

  if (!tasks || tasks.length === 0) return null;

  const updateStatus = async (taskId: string, status: string) => {
    try {
      const res = await fetch(`${BASE_URL}/tasks/update`, {
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

      if (!res.ok) {
        console.error("❌ Failed to update");
        return;
      }

      refreshTasks();
    } catch (err) {
      console.error("❌ Update error:", err);
    }
  };

  const visibleTasks = tasks.filter((t) => t.status !== "archived");
  const pendingTasks = visibleTasks.filter((t) => t.status === "pending");
  const completedTasks = visibleTasks.filter((t) => t.status === "done");
  const skippedTasks = visibleTasks.filter((t) => t.status === "skipped");

  const doneTasks = visibleTasks.filter((t) => t.status === "done").length;
  const totalTasks = visibleTasks.length;
  const progress = totalTasks === 0 ? 0 : doneTasks / totalTasks;
  const progressPercent = Math.round(progress * 100);

  return (
    <div className="max-w-2xl mx-auto mt-10">
      <h2 className="text-xl font-semibold mb-2">Today&apos;s Tasks</h2>

      {/* 🔥 PROGRESS */}
      <div className="mb-6">
        <div className="flex justify-between text-sm mb-1">
          <span>Progress</span>
          <span>
            {progressPercent}% ({doneTasks}/{totalTasks})
          </span>
        </div>

        <div className="w-full bg-gray-200 rounded h-2">
          <div
            className="bg-blue-600 h-2 rounded transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* 🔥 PENDING */}
      {pendingTasks.length > 0 && (
        <>
          <h3 className="text-md font-semibold mb-2 text-gray-700">
            🟢 Pending Tasks
          </h3>

          {pendingTasks.map((task) => (
            <div key={task.id} className="border p-4 rounded mb-3">
              <h3 className="font-semibold">{task.title}</h3>
              <p>{task.description}</p>

              <p className="text-sm text-gray-500">
                Difficulty: {task.difficulty}/5
              </p>

              <div className="flex gap-2 mt-2">
                <button
                  className="bg-green-500 text-white px-3 py-1 rounded"
                  onClick={() => updateStatus(task.id, "done")}
                >
                  Done
                </button>

                <button
                  className="bg-red-500 text-white px-3 py-1 rounded"
                  onClick={() => updateStatus(task.id, "skipped")}
                >
                  Skip
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {/* 🔥 COMPLETED */}
      {completedTasks.length > 0 && (
        <>
          <h3 className="text-md font-semibold mt-6 mb-2 text-gray-500">
            ✅ Completed Today
          </h3>

          {completedTasks.map((task) => (
            <div
              key={task.id}
              className="border p-4 rounded mb-2 opacity-60 bg-gray-50"
            >
              <h3 className="font-semibold line-through">{task.title}</h3>
              <p className="text-sm text-gray-500">{task.description}</p>
            </div>
          ))}
        </>
      )}

      {skippedTasks.length > 0 && (
        <>
          <h3 className="text-md font-semibold mt-6 mb-2 text-gray-400">
            Skipped Tasks
          </h3>

          {skippedTasks.map((task) => (
            <div
              key={task.id}
              className="mb-2 rounded border border-dashed border-gray-200 bg-gray-50 p-3 opacity-60 dark:border-gray-700 dark:bg-gray-900"
            >
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
                Skipped
              </div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{task.title}</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">{task.description}</p>
            </div>
          ))}
        </>
      )}
    </div>
  );
}