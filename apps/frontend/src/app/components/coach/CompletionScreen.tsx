"use client";

import { motion } from "framer-motion";

type CompletionScreenProps = {
  streak: number;
  completedCount: number;
  onLockIn: () => void;
};

export default function CompletionScreen({ streak, completedCount, onLockIn }: CompletionScreenProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-8 text-white backdrop-blur-xl shadow-[0_0_80px_rgba(0,0,0,0.6)]"
    >
      <div className="flex min-h-[280px] flex-col items-center justify-center text-center">
        <p className="text-sm font-medium uppercase tracking-[0.16em] text-white/50">Completed</p>
        <h2 className="mt-3 font-serif text-3xl font-semibold tracking-tight">You showed up today</h2>
        <p className="mt-3 text-[#E6C36A]">{streak}-day streak</p>
        <p className="mt-2 text-sm text-white/70">{completedCount} tasks completed in this coach cycle.</p>

        <button
          type="button"
          onClick={onLockIn}
          className="mt-8 w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-white/20"
        >
          Lock in today
        </button>
      </div>
    </motion.section>
  );
}
