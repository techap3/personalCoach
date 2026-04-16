"use client";

import { motion } from "framer-motion";

type ActiveTaskScreenProps = {
  task: string;
  helperText: string;
  currentStep: number;
  totalSteps: number;
  onDone: () => void;
};

export default function ActiveTaskScreen({
  task,
  helperText,
  currentStep,
  totalSteps,
  onDone,
}: ActiveTaskScreenProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-8 text-white backdrop-blur-xl shadow-[0_0_80px_rgba(0,0,0,0.6)]"
    >
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/50">
        Active Task {currentStep}/{totalSteps}
      </p>

      <motion.div
        animate={{ scale: [1, 1.01, 1] }}
        transition={{ duration: 1.8, repeat: Infinity, repeatType: "loop", ease: "easeInOut" }}
        className="mt-4 rounded-xl border border-[#E6C36A] bg-white/[0.03] p-5"
      >
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/50">Current focus</p>
        <p className="mt-2 text-lg font-semibold leading-snug tracking-tight text-white">{task}</p>
      </motion.div>

      <p className="mt-5 text-sm leading-relaxed text-white/70">{helperText}</p>

      <button
        type="button"
        onClick={onDone}
        className="mt-8 w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-white/20"
      >
        Done - move forward
      </button>
    </motion.section>
  );
}
