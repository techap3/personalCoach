"use client";

import type { ReactNode } from "react";

export default function RewardText({ children }: { children: ReactNode }) {
  return (
    <p className="text-[18px] font-bold text-[var(--pc-gold)] drop-shadow-[0_2px_10px_rgba(230,195,106,0.25)]">
      {children}
    </p>
  );
}
