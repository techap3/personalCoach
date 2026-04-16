"use client";

import { useMemo, useState } from "react";

import HomeScreen from "./screens/HomeScreen";
import GoalsScreen from "./screens/GoalsScreen";
import CreateGoalFlowScreen from "./screens/CreateGoalFlowScreen";
import ActiveTaskScreen from "./screens/ActiveTaskScreen";
import TransitionScreen from "./screens/TransitionScreen";
import CompletionScreen from "./screens/CompletionScreen";
import type { AppFlowCoreProps, AppFlowMode, AppFlowScreen } from "./types";

type AppFlowState = {
  screen: AppFlowScreen;
  mode: AppFlowMode;
};

function deriveState(props: AppFlowCoreProps): AppFlowState {
  if (props.isLoading) {
    return { screen: "TRANSITION", mode: "BOOTSTRAP" };
  }

  if (props.sessionStatus === "failed") {
    return { screen: "TRANSITION", mode: "MISSED_DAY" };
  }

  if (props.sessionStatus === "completed" || props.planCompleted) {
    return { screen: "COMPLETION", mode: "IDLE" };
  }

  if (props.todayTasks.length > 0) {
    return { screen: "ACTIVE_TASK", mode: "RESUME" };
  }

  if (props.goals.length > 0) {
    return { screen: "GOALS", mode: "IDLE" };
  }

  return { screen: "HOME", mode: "IDLE" };
}

export default function AppFlow(props: AppFlowCoreProps) {
  const [flowState, setFlowState] = useState<AppFlowState>(() => deriveState(props));

  const derived = useMemo(() => deriveState(props), [props]);

  const effectiveState: AppFlowState =
    derived.screen === "TRANSITION" ||
    derived.screen === "COMPLETION" ||
    derived.screen === "ACTIVE_TASK"
      ? derived
      : flowState;

  const goBack = () => {
    setFlowState((current) => {
      if (current.screen === "GOALS") {
        return { ...current, screen: "HOME" };
      }
      if (current.screen === "CREATE_GOAL") {
        return { ...current, screen: "HOME" };
      }
      if (current.screen === "ACTIVE_TASK") {
        return { ...current, screen: "GOALS" };
      }
      if (current.screen === "COMPLETION" || current.screen === "TRANSITION") {
        return { ...current, screen: "HOME" };
      }
      return current;
    });
  };

  const modeLabel =
    effectiveState.mode === "RESUME"
      ? "Resume in progress"
      : effectiveState.mode === "MISSED_DAY"
        ? "Recovery mode"
        : effectiveState.mode === "BOOTSTRAP"
          ? "Preparing"
          : "Fresh start";

  return (
    <div className="min-h-screen bg-[radial-gradient(120%_90%_at_50%_0%,#1A2331_0%,#0B0F16_55%,#07090D_100%)] px-4 py-6 text-[var(--pc-text-primary)]">
      <div className="mx-auto w-full max-w-[460px]">
        <header className="mb-5 flex items-center justify-between rounded-[16px] border border-[#202A38] bg-[#0F141D]/90 px-4 py-3 backdrop-blur-sm">
          <button
            type="button"
            onClick={goBack}
            className="text-[13px] font-semibold text-[#AAB3C0] transition hover:text-[#E4E9F0]"
          >
            Back
          </button>
          <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[var(--pc-gold)]">{modeLabel}</p>
          <button
            type="button"
            onClick={props.onLogout}
            className="text-[13px] font-semibold text-[#AAB3C0] transition hover:text-[#E4E9F0]"
          >
            Logout
          </button>
        </header>

        {effectiveState.screen === "HOME" ? (
          <HomeScreen
            userEmail={props.userEmail}
            modeLabel={modeLabel}
            onStartCreateGoal={() => setFlowState((s) => ({ ...s, screen: "CREATE_GOAL" }))}
            onOpenGoals={() => setFlowState((s) => ({ ...s, screen: props.goals.length ? "GOALS" : "CREATE_GOAL" }))}
          />
        ) : null}

        {effectiveState.screen === "GOALS" ? (
          <GoalsScreen
            goals={props.goals}
            onCreateGoal={() => setFlowState((s) => ({ ...s, screen: "CREATE_GOAL" }))}
            onSelectGoal={async (goalId) => {
              await props.onSelectGoal(goalId);
              setFlowState((s) => ({ ...s, screen: "ACTIVE_TASK", mode: "RESUME" }));
            }}
          />
        ) : null}

        {effectiveState.screen === "CREATE_GOAL" ? (
          <CreateGoalFlowScreen
            onStartToday={async (payload) => {
              await props.onCreateGoalAndStart(payload);
              setFlowState((s) => ({ ...s, screen: "ACTIVE_TASK", mode: "RESUME" }));
            }}
            onBackToHome={() => setFlowState((s) => ({ ...s, screen: "HOME" }))}
          />
        ) : null}

        {effectiveState.screen === "ACTIVE_TASK" ? (
          <ActiveTaskScreen
            tasks={props.todayTasks}
            token={props.token}
            onStepCompleted={props.onStepCompleted}
            onSessionCompleted={props.onSessionCompleted}
            refreshTasks={props.refreshTasks}
            refreshPlan={props.refreshPlan}
          />
        ) : null}

        {effectiveState.screen === "TRANSITION" ? (
          <TransitionScreen
            isLoading={props.isLoading}
            error={props.generateError}
            onRetry={props.onGenerateSession}
          />
        ) : null}

        {effectiveState.screen === "COMPLETION" ? (
          <CompletionScreen
            summary={props.sessionSummary}
            message={props.sessionCompletedMessage}
            planCompleted={props.planCompleted}
            onContinue={props.onGenerateSession}
            onRestartPlan={props.onRestartPlan}
          />
        ) : null}
      </div>

      {props.isLoading ? (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-[#07090D]/60 backdrop-blur-[2px]">
          <div className="rounded-[14px] border border-[#2E394A] bg-[#101722] px-6 py-4 text-center shadow-[var(--pc-shadow-soft)]">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#D7B764]">Loading</p>
            <p className="mt-1 text-[14px] text-[#C4CDDA]">Preparing your next focus set...</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
