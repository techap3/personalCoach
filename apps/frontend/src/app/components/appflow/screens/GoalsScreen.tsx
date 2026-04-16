"use client";

import type { AppGoal } from "../types";
import CTAButton from "../primitives/CTAButton";
import FocusCard from "../primitives/FocusCard";

type GoalsScreenProps = {
  goals: AppGoal[];
  onSelectGoal: (goalId: string) => Promise<void>;
  onCreateGoal: () => void;
};

export default function GoalsScreen({ goals, onSelectGoal, onCreateGoal }: GoalsScreenProps) {
  const sorted = [...goals].sort((a, b) => {
    const left = a.created_at ? new Date(a.created_at).getTime() : 0;
    const right = b.created_at ? new Date(b.created_at).getTime() : 0;
    return right - left;
  });

  const active = sorted[0];
  const remaining = sorted.slice(1);

  return (
    <section className="space-y-5">
      <FocusCard
        label="Current Goal"
        title={active?.title || "No active goal"}
        subtitle={active?.description || "Start a new goal to begin your flow."}
      />

      {active ? (
        <CTAButton onClick={() => void onSelectGoal(active.id)}>Resume This Goal</CTAButton>
      ) : (
        <CTAButton onClick={onCreateGoal}>Create First Goal</CTAButton>
      )}

      <div className="space-y-3">
        {remaining.map((goal) => (
          <button
            key={goal.id}
            type="button"
            onClick={() => void onSelectGoal(goal.id)}
            className="w-full rounded-[16px] border border-[#2A3442] bg-[#131A25] px-4 py-3 text-left transition hover:border-[#3A4658]"
          >
            <p className="text-[15px] font-semibold text-[#F3F4F6]">{goal.title || "Untitled Goal"}</p>
            <p className="mt-1 text-[13px] text-[#9AA2AE]">{goal.description || "Open this goal to continue."}</p>
          </button>
        ))}
      </div>
    </section>
  );
}
