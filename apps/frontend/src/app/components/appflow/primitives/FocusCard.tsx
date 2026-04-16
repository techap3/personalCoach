"use client";

type FocusCardProps = {
  label: string;
  title: string;
  subtitle?: string;
};

export default function FocusCard({ label, title, subtitle }: FocusCardProps) {
  return (
    <section
      className="w-full rounded-[var(--pc-radius-card)] border-2 border-[var(--pc-gold)] bg-[linear-gradient(180deg,var(--pc-card-focus-top)_0%,var(--pc-card-focus-bottom)_100%)] p-6 shadow-[var(--pc-shadow-focus)]"
    >
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--pc-gold)]">{label}</p>
      <h3 className="mt-2 whitespace-pre-line text-[34px] font-bold leading-[1.05] text-[var(--pc-text-primary)] tracking-[-0.02em]">
        {title}
      </h3>
      {subtitle ? (
        <p className="mt-2 text-[14px] font-semibold text-[#B5BECB]">{subtitle}</p>
      ) : null}
    </section>
  );
}
