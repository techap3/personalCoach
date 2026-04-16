"use client";

import { useState } from "react";

import CTAButton from "../primitives/CTAButton";
import ProgressBar from "../primitives/ProgressBar";
import type { CreateGoalPayload } from "../types";

type CreateGoalFlowScreenProps = {
  onStartToday: (payload: CreateGoalPayload) => Promise<void>;
  onBackToHome: () => void;
};

const STEP_COUNT = 4;

const STEP_DATA = {
  title: "Build Daily Consistency",
  description: "Show up every day with one focused action and finish your top priority before context switching.",
  intensity: "medium" as const,
};

export default function CreateGoalFlowScreen({ onStartToday, onBackToHome }: CreateGoalFlowScreenProps) {
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const payload: CreateGoalPayload = {
    title: STEP_DATA.title,
    description: STEP_DATA.description,
    intensity: STEP_DATA.intensity,
  };

  const handleStartToday = async () => {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      await onStartToday(payload);
    } catch {
      setSubmitError("Could not start your goal yet. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#909AAC]">Create Goal</p>
        <h2 className="text-[32px] font-bold leading-[1.05] tracking-[-0.03em] text-[#F3F4F6]">Define your next arc</h2>
        <p className="text-[14px] text-[#9AA2AE]">Step {step} of {STEP_COUNT}</p>
        <ProgressBar value={step} max={STEP_COUNT} />
      </header>

      {step < STEP_COUNT ? (
        <div className="space-y-4 rounded-[18px] border border-[#232C39] bg-[#121925] p-5">
          <p className="text-[15px] text-[#C7CED9]">
            {step === 1 && "Name the goal you want to move forward this week. This flow will start: Build Daily Consistency."}
            {step === 2 && "Clarify why this matters. This flow will anchor daily focus and reduce context switching."}
            {step === 3 && "Set intensity. This flow uses medium intensity for a sustainable daily pace."}
          </p>
          <div className="space-y-3">
            <CTAButton onClick={() => setStep((s) => Math.min(STEP_COUNT, s + 1))}>Next</CTAButton>
            <CTAButton variant="secondary" onClick={step === 1 ? onBackToHome : () => setStep((s) => Math.max(1, s - 1))}>
              {step === 1 ? "Back Home" : "Back"}
            </CTAButton>
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-[18px] border border-[#232C39] bg-[#121925] p-5">
          <div className="rounded-[14px] border border-[#2C3644] bg-[#151D2A] p-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#9AA2AE]">Summary</p>
            <p className="mt-2 text-[18px] font-semibold text-[#F3F4F6]">{payload.title}</p>
            <p className="mt-1 text-[14px] text-[#B4BDCA]">{payload.description}</p>
            <p className="mt-3 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#D7B764]">Intensity: {payload.intensity}</p>
          </div>

          {submitError ? <p className="text-[13px] text-[#E79A9A]">{submitError}</p> : null}

          <div className="space-y-3">
            <CTAButton onClick={() => void handleStartToday()} disabled={isSubmitting}>
              {isSubmitting ? "Starting..." : "Start today"}
            </CTAButton>
            <CTAButton variant="secondary" onClick={() => setStep(3)} disabled={isSubmitting}>
              Back
            </CTAButton>
          </div>
        </div>
      )}
    </section>
  );
}
