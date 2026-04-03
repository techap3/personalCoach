"use client";

import { PlanResponse } from "@/types/plan";

type TaskWithPlanStep = {
  id: string;
  status?: string;
  plan_step_id?: string | number;
};

interface PlanViewProps {
  plan: PlanResponse | null;
  tasks: TaskWithPlanStep[];
}

export default function PlanView({ plan, tasks }: PlanViewProps) {
  if (!plan) return null;

  const getStepStatus = (doneCount: number, totalCount: number) => {
    if (totalCount > 0 && doneCount === totalCount) return "completed";
    if (doneCount > 0) return "in-progress";
    return "pending";
  };

  const getStatusClasses = (status: "completed" | "in-progress" | "pending") => {
    if (status === "completed") {
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    }

    if (status === "in-progress") {
      return "bg-amber-50 text-amber-700 border-amber-200";
    }

    return "bg-gray-100 text-gray-700 border-gray-200";
  };

  // ✅ ACTIVE STEP LOGIC (0-based)
  const activeStepIndex = (() => {
    for (let i = 0; i < plan.plan.length; i++) {
      const stepTasks = tasks.filter(
        (t) => Number(t.plan_step_id) === i
      );

      const done = stepTasks.filter((t) => t.status === "done").length;

      if (stepTasks.length === 0 || done < stepTasks.length) {
        return i;
      }
    }
    return 0;
  })();

  return (
    <div className="max-w-2xl mx-auto mt-6">
      <h2 className="text-2xl font-bold mb-4">Your Plan</h2>

      <div className="flex flex-col gap-4">
        {plan.plan.map((step, index) => {
          const stepTasks = tasks.filter(
            (task) => Number(task.plan_step_id) === index
          );

          const doneCount = stepTasks.filter(
            (task) => task.status === "done"
          ).length;

          const totalCount = stepTasks.length;

          const status = getStepStatus(doneCount, totalCount);

          return (
            <div
              key={index}
              className={`border p-4 rounded shadow-sm transition ${
                index === activeStepIndex
                  ? "border-blue-500 bg-blue-50"
                  : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">
                    {index + 1}. {step.title}
                  </h3>

                  {index === activeStepIndex && (
                    <span className="text-xs text-blue-600 font-medium">
                      Current Step
                    </span>
                  )}
                </div>

                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${getStatusClasses(
                    status
                  )}`}
                >
                  {status}
                </span>
              </div>

              <p className="text-sm text-gray-600 mt-1">
                {step.description}
              </p>

              <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                <span>Difficulty: {step.difficulty}/5</span>
                <span>
                  {doneCount}/{totalCount} tasks done
                </span>
              </div>

              {stepTasks.length > 0 && (
                <div className="mt-2 text-xs text-gray-500">
                  {stepTasks.length} tasks mapped
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}