"use client";

type TaskCardProps = {
  title: string;
  subtitle?: string;
  mode: "active" | "completed" | "muted";
};

export default function TaskCard({ title, subtitle, mode }: TaskCardProps) {
  const modeStyles =
    mode === "active"
      ? "border-2 border-[var(--pc-gold)] bg-[linear-gradient(180deg,var(--pc-card-focus-top)_0%,var(--pc-card-focus-bottom)_100%)]"
      : "border border-[#2F3948] bg-[#161D28]";

  const titleStyles = mode === "completed" ? "line-through text-[#BAC3D0]" : "text-[#F3F4F6]";
  const wrapperOpacity = mode === "completed" ? "opacity-55" : "";

  return (
    <section className={`w-full rounded-[var(--pc-radius-card)] p-[14px] ${modeStyles} ${wrapperOpacity}`}>
      <p className={`text-[15px] font-semibold ${titleStyles}`}>{title}</p>
      {subtitle ? <p className="mt-1 text-[13px] font-semibold text-[#A6AFBC]">{subtitle}</p> : null}
    </section>
  );
}
