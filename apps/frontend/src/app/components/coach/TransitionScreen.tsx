"use client";

import { motion } from "framer-motion";

type TransitionScreenProps = {
  completedTask: string;
  feedback: string;
  nextTask?: string;
  onContinue: () => void;
};

export default function TransitionScreen({
  completedTask,
  feedback,
  nextTask,
  onContinue,
}: TransitionScreenProps) {
  const ctaLabel = nextTask ? "Next task" : "Finish today";

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-8 text-white backdrop-blur-xl shadow-[0_0_80px_rgba(0,0,0,0.6)]"
    >
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/50">Completed</p>
        <p className="mt-2 text-sm text-white/50 line-through">{completedTask}</p>
      </div>

      <p className="mt-5 text-sm leading-relaxed text-white/70">{feedback}</p>

      {nextTask ? (
        <div className="mt-5">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/50">Next task</p>
          <p className="mt-2 text-base font-medium leading-snug tracking-tight text-white">{nextTask}</p>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onContinue}
        className="mt-8 w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-white/20"
      >
        {ctaLabel}
      </button>
    </motion.section>
  );
}
