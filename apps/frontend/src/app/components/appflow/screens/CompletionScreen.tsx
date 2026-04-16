"use client";

import CTAButton from "../primitives/CTAButton";
import RewardText from "../primitives/RewardText";
import type { SessionSummary } from "../types";

type CompletionScreenProps = {
  summary: SessionSummary | null;
  message: string | null;
  planCompleted: boolean;
  onContinue: () => Promise<void>;
  onRestartPlan: () => void;
};

export default function CompletionScreen({
  summary,
  message,
  planCompleted,
  onContinue,
  onRestartPlan,
}: CompletionScreenProps) {
  return (
    <section className="space-y-5">
      <div className="rounded-[18px] border border-[#2D394C] bg-[linear-gradient(180deg,#121821_0%,#0F151F_100%)] p-6 text-center">
        <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-[#9AA2AE]">Completion</p>
        <h2 className="mt-2 text-[32px] font-bold leading-[1.03] tracking-[-0.02em] text-[#F3F4F6]">Session Complete</h2>
        <RewardText>{message || "Nice work today"}</RewardText>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-[14px] border border-[#2C3646] bg-[#131B27] p-3">
            <p className="text-[12px] text-[#95A0B0]">Completed</p>
            <p className="text-[24px] font-bold text-[#F3F4F6]">{summary?.completed ?? 0}</p>
          </div>
          <div className="rounded-[14px] border border-[#2C3646] bg-[#131B27] p-3">
            <p className="text-[12px] text-[#95A0B0]">Skipped</p>
            <p className="text-[24px] font-bold text-[#F3F4F6]">{summary?.skipped ?? 0}</p>
          </div>
        </div>
      </div>

      {planCompleted ? (
        <CTAButton onClick={onRestartPlan}>Start New Plan</CTAButton>
      ) : (
        <CTAButton onClick={() => void onContinue()}>Do More Today</CTAButton>
      )}
    </section>
  );
}
