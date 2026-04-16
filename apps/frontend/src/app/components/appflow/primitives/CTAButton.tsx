"use client";

import type { ReactNode } from "react";

type CTAButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  className?: string;
};

export default function CTAButton({
  children,
  onClick,
  disabled,
  variant = "primary",
  className = "",
}: CTAButtonProps) {
  const base =
    "inline-flex h-[58px] w-full items-center justify-center rounded-[var(--pc-radius-cta)] text-[17px] font-bold transition-all duration-200";

  const styles =
    variant === "secondary"
      ? "border border-[#394253] bg-[#141B27] text-[#C1C9D5] hover:bg-[#182232]"
      : "bg-[linear-gradient(180deg,var(--pc-btn-top)_0%,var(--pc-btn-bottom)_100%)] text-[#EEF2F7] shadow-[var(--pc-shadow-soft)] hover:brightness-110";

  const disabledStyles = disabled ? "cursor-not-allowed opacity-50" : "";

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${styles} ${disabledStyles} ${className}`}>
      {children}
    </button>
  );
}
