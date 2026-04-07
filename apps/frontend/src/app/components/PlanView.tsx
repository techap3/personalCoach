"use client";

import { PlanResponse } from "@/types/plan";

type TaskWithPlanStep = {
  id: string;
  status?: string;
  plan_step_id?: string | number;
};
type PlanStep = {
  id: string;
  step_index: number;
  status: string;
};

interface PlanViewProps {
  plan: PlanResponse | null;
  tasks: TaskWithPlanStep[];
  planSteps: PlanStep[];
}

export default function PlanView({ plan, tasks, planSteps }: PlanViewProps) {
  if (!plan) return null;

  const getStepStatus = (dbStatus?: string) => {
    if (dbStatus === "completed") return "completed";
    if (dbStatus === "active") return "in-progress";
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

  const getStepTaskMatches = (index: number) => {
    const stepId = planSteps[index]?.id;
    const stepTasks = tasks.filter(
      (task) => String(task.plan_step_id) === String(stepId)
    );

    return stepTasks;
  };

  const activeStepIndex = planSteps.findIndex((step) => step.status === "active");

  return (
    <div className="max-w-2xl mx-auto mt-6">
      <h2 className="text-2xl font-bold mb-4">Your Plan</h2>

      <div className="flex flex-col gap-4">
        {plan.plan.map((step, index) => {
          const stepTasks = getStepTaskMatches(index);

          const doneCount = stepTasks.filter(
            (task) => task.status === "done"
          ).length;

          const totalCount = stepTasks.length;

          const status = getStepStatus(planSteps[index]?.status);

          return (
            <div
              key={index}
              className={`border p-4 rounded shadow-sm transition ${
                index === (activeStepIndex === -1 ? 0 : activeStepIndex)
                  ? "border-blue-500 bg-blue-50"
                  : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">
                    {index + 1}. {step.title}
                  </h3>

                  {index === (activeStepIndex === -1 ? 0 : activeStepIndex) && (
                    <span className="text-xs text-blue-600 font-medium">
                      Current Step
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${getStatusClasses(
                      status
                    )}`}
                  >
                    {status}
                  </span>
                </div>
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