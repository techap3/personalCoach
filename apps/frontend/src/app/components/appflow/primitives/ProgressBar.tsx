"use client";

export default function ProgressBar({ value, max }: { value: number; max: number }) {
  const normalized = Math.max(0, Math.min(100, max > 0 ? Math.round((value / max) * 100) : 0));

  return (
    <div className="h-[5px] w-full rounded-full bg-[#2A3340]">
      <div className="h-[5px] rounded-full bg-[var(--pc-gold)] transition-all duration-200" style={{ width: `${normalized}%` }} />
    </div>
  );
}
