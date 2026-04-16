"use client";

import CTAButton from "../primitives/CTAButton";

type HomeScreenProps = {
  userEmail?: string;
  modeLabel?: string;
  onStartCreateGoal: () => void;
  onOpenGoals: () => void;
};

export default function HomeScreen({ userEmail, modeLabel, onStartCreateGoal, onOpenGoals }: HomeScreenProps) {
  return (
    <section className="space-y-8">
      <header className="space-y-2">
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#909AAC]">AI Personal Coach</p>
        <h1 className="text-[40px] font-bold leading-[1.02] tracking-[-0.03em] text-[var(--pc-text-primary)]">
          Focus With
          <br />
          Intent
        </h1>
        <p className="text-[15px] font-semibold text-[var(--pc-text-secondary)]">
          {userEmail || "Build your habit loop one guided step at a time."}
        </p>
      </header>

      <div className="rounded-[var(--pc-radius-panel)] border border-[#1F2733] bg-[linear-gradient(180deg,#121821_0%,#0E141D_100%)] p-5 shadow-[var(--pc-shadow-soft)]">
        <p className="text-[13px] font-bold uppercase tracking-[0.12em] text-[var(--pc-gold)]">Today mode</p>
        <p className="mt-2 text-[16px] font-semibold text-[var(--pc-text-primary)]">{modeLabel || "Fresh start"}</p>
        <p className="mt-1 text-[14px] text-[var(--pc-text-helper)]">No route jumps. One immersive flow from setup to completion.</p>
      </div>

      <div className="space-y-3">
        <CTAButton onClick={onOpenGoals}>Continue Daily Flow</CTAButton>
        <CTAButton variant="secondary" onClick={onStartCreateGoal}>
          Create New Goal
        </CTAButton>
      </div>
    </section>
  );
}
