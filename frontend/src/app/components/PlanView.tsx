"use client";

import { PlanResponse } from "@/types/plan";

interface PlanViewProps {
  plan: PlanResponse | null;
}

export default function PlanView({ plan }: PlanViewProps) {
  if (!plan) return null;

  return (
    <div className="max-w-2xl mx-auto mt-10">
      <h2 className="text-2xl font-bold mb-4">Your Plan</h2>

      <div className="flex flex-col gap-4">
        {plan.plan.map((step, index) => (
          <div
            key={index}
            className="border p-4 rounded shadow-sm"
          >
            <h3 className="font-semibold">
              {index + 1}. {step.title}
            </h3>

            <p className="text-sm text-gray-600 mt-1">
              {step.description}
            </p>

            <div className="mt-2 text-xs text-gray-500">
              Difficulty: {step.difficulty}/5
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}