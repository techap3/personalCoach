"use client";

import { motion } from "framer-motion";

type EntryScreenProps = {
  greeting: string;
  streak: number;
  focus: string;
  onStart: () => void;
};

export default function EntryScreen({ greeting, streak, focus, onStart }: EntryScreenProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="w-full max-w-lg rounded-2xl border border-white/10 bg-white/5 p-8 text-white backdrop-blur-xl shadow-[0_0_80px_rgba(0,0,0,0.6)]"
    >
      <div className="space-y-2">
        <h2 className="font-serif text-2xl font-semibold leading-tight tracking-tight">{greeting}</h2>
        <p className="text-sm text-[#E6C36A]">{streak}-day streak</p>
      </div>

      <div className="mt-6 space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/50">Today&apos;s focus</p>
        <p className="text-sm leading-relaxed text-white/70">{focus}</p>
      </div>

      <button
        type="button"
        onClick={onStart}
        className="mt-8 w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-white/20"
      >
        Start today&apos;s plan
      </button>
    </motion.section>
  );
}
