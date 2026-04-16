"use client";

import { useMemo, useState } from "react";
import EntryScreen from "./EntryScreen";
import ActiveTaskScreen from "./ActiveTaskScreen";
import TransitionScreen from "./TransitionScreen";
import CompletionScreen from "./CompletionScreen";

type CoachState = "entry" | "active" | "transition" | "completion";

const MOCK_TASKS = [
  "Schedule focused practice time",
  "Ask one clarifying question before execution",
  "Write a 2-line debrief with next decision",
];

const MOCK_STREAK_DAYS = 3;
const MOCK_FOCUS = "Finish your top-priority task before context switching.";

export default function CoachFlow({ onExit }: { onExit: () => void }) {
  const [coachState, setCoachState] = useState<CoachState>("entry");
  const [currentTaskIndex, setCurrentTaskIndex] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [lastCompletedTask, setLastCompletedTask] = useState<string | null>(null);

  const currentTask = MOCK_TASKS[currentTaskIndex];
  const nextTask = currentTaskIndex < MOCK_TASKS.length - 1 ? MOCK_TASKS[currentTaskIndex + 1] : undefined;

  const transitionFeedback = useMemo(() => {
    if (completedCount === 0) return "Good start. Keep your pace steady.";
    if (completedCount === 1) return "Strong follow-through. One more focused push.";
    return "Clean finish. Lock in the win.";
  }, [completedCount]);

  const startCoachFlow = () => {
    setCoachState("active");
  };

  const completeActiveTask = () => {
    setLastCompletedTask(currentTask);
    setCompletedCount((count) => count + 1);
    setCoachState("transition");
  };

  const continueFromTransition = () => {
    if (currentTaskIndex < MOCK_TASKS.length - 1) {
      setCurrentTaskIndex((index) => index + 1);
      setCoachState("active");
      return;
    }

    setCoachState("completion");
  };

  const lockInAndExit = () => {
    onExit();
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-gradient-to-br from-[#020617] via-[#020617] to-[#0b1220] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_35%_20%,rgba(255,255,255,0.08),transparent_48%)]" />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5 md:px-10">
        <button
          type="button"
          onClick={onExit}
          className="inline-flex items-center gap-2 text-sm font-medium text-white/70 transition hover:text-white"
        >
          <span aria-hidden="true">←</span>
          Back
        </button>

        <p className="text-sm font-medium text-[#E6C36A]">🔥 {MOCK_STREAK_DAYS}-day streak</p>
      </header>

      <main className="relative z-10 flex min-h-[calc(100vh-76px)] items-center justify-center px-4 pb-10">
        {coachState === "entry" ? (
          <EntryScreen
            greeting="Welcome back"
            streak={MOCK_STREAK_DAYS}
            focus={MOCK_FOCUS}
            onStart={startCoachFlow}
          />
        ) : null}

        {coachState === "active" ? (
          <ActiveTaskScreen
            task={currentTask}
            helperText="Complete this task with full attention before switching context."
            currentStep={currentTaskIndex + 1}
            totalSteps={MOCK_TASKS.length}
            onDone={completeActiveTask}
          />
        ) : null}

        {coachState === "transition" && lastCompletedTask ? (
          <TransitionScreen
            completedTask={lastCompletedTask}
            feedback={transitionFeedback}
            nextTask={nextTask}
            onContinue={continueFromTransition}
          />
        ) : null}

        {coachState === "completion" ? (
          <CompletionScreen
            streak={MOCK_STREAK_DAYS}
            completedCount={completedCount}
            onLockIn={lockInAndExit}
          />
        ) : null}
      </main>
    </div>
  );
}
