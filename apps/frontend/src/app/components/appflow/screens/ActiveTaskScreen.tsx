"use client";

import TasksView from "../../TasksView";
import FocusCard from "../primitives/FocusCard";
import TaskCard from "../primitives/TaskCard";
import ProgressBar from "../primitives/ProgressBar";
import type { AppTask, TasksViewSessionSummary } from "../types";

type ActiveTaskScreenProps = {
  tasks: AppTask[];
  token: string;
  onStepCompleted: () => void;
  onSessionCompleted: (summary: TasksViewSessionSummary) => void;
  refreshTasks: () => Promise<void>;
  refreshPlan: () => Promise<void>;
};

function getCycleTasks(tasks: AppTask[]) {
  const visible = tasks.filter((task) => task.status !== "archived");
  if (!visible.length) return [] as AppTask[];

  const pending = visible.filter((task) => task.status === "pending");
  if (!pending.length) return visible;

  const pendingTimes = pending
    .map((task) => (task.created_at ? new Date(task.created_at).getTime() : 0))
    .filter((time) => Number.isFinite(time) && time > 0);

  if (!pendingTimes.length) return pending;

  const cycleStart = Math.min(...pendingTimes);
  return visible.filter((task) => {
    const createdAt = task.created_at ? new Date(task.created_at).getTime() : 0;
    return Number.isFinite(createdAt) && createdAt >= cycleStart;
  });
}

export default function ActiveTaskScreen({
  tasks,
  token,
  onStepCompleted,
  onSessionCompleted,
  refreshTasks,
  refreshPlan,
}: ActiveTaskScreenProps) {
  const tasksToRender = getCycleTasks(tasks);
  const completed = tasksToRender.filter((task) => task.status === "done").length;

  return (
    <section className="space-y-5">
      <FocusCard
        label="Today Focus"
        title={tasksToRender[0]?.title || "Ready for the next move"}
        subtitle={`${completed} of ${tasksToRender.length || 0} completed`}
      />

      <ProgressBar value={completed} max={tasksToRender.length || 1} />

      <div className="space-y-2">
        {tasksToRender.map((task) => (
          <TaskCard
            key={task.id}
            title={task.title}
            subtitle={task.description}
            mode={task.status === "done" ? "completed" : "active"}
          />
        ))}
      </div>

      <div className="rounded-[18px] border border-[#253247] bg-[#111825] p-3">
        <TasksView
          tasksToRender={tasksToRender}
          token={token}
          onStartCoachFlow={() => {
            // AppFlow is already immersive; no route transition needed.
          }}
          onStepCompleted={onStepCompleted}
          onSessionCompleted={onSessionCompleted}
          refreshTasks={refreshTasks}
          refreshPlan={refreshPlan}
        />
      </div>
    </section>
  );
}
