"use client";

import CTAButton from "../primitives/CTAButton";

type TransitionScreenProps = {
  isLoading: boolean;
  error: string | null;
  onRetry: () => Promise<void>;
};

export default function TransitionScreen({ isLoading, error, onRetry }: TransitionScreenProps) {
  return (
    <section className="space-y-5">
      <div className="rounded-[18px] border border-[#243042] bg-[#101722] p-6 text-center">
        <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--pc-gold)]">Transition</p>
        <h2 className="mt-2 text-[30px] font-bold leading-[1.05] tracking-[-0.02em] text-[#F3F4F6]">
          {isLoading ? "Preparing your next set" : "Session paused"}
        </h2>
        <p className="mt-2 text-[14px] text-[#A5AFBD]">
          {isLoading
            ? "We are building your next action sequence. Stay in flow."
            : error || "Something interrupted task generation."}
        </p>
      </div>

      {!isLoading ? <CTAButton onClick={() => void onRetry()}>Retry Session</CTAButton> : null}
    </section>
  );
}
