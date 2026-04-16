import type { PlanResponse } from "@/types/plan";

export type AppTask = {
  id: string;
  title: string;
  description: string;
  difficulty: number;
  status?: string;
  created_at?: string;
};

export type AppGoal = {
  id: string;
  title?: string;
  description?: string;
  created_at?: string;
};

export type SessionSummary = {
  completed: number;
  skipped: number;
  completion_rate: number;
  message: string;
};

export type TasksViewSessionSummary = {
  completed: number;
  skipped: number;
  completion_rate: number;
  message: string;
};

export type AppFlowScreen =
  | "HOME"
  | "GOALS"
  | "CREATE_GOAL"
  | "ACTIVE_TASK"
  | "TRANSITION"
  | "COMPLETION";

export type AppFlowMode = "BOOTSTRAP" | "RESUME" | "MISSED_DAY" | "IDLE";

export type CreateGoalPayload = {
  title: string;
  description: string;
  intensity: "low" | "medium" | "high";
};

export type AppFlowCoreProps = {
  userEmail?: string;
  goals: AppGoal[];
  todayTasks: AppTask[];
  plan: PlanResponse | null;
  sessionCompletedMessage: string | null;
  sessionSummary: SessionSummary | null;
  generateError: string | null;
  isLoading: boolean;
  sessionStatus: "none" | "active" | "completed" | "failed";
  planCompleted: boolean;
  onLogout: () => void;
  onStartCreateGoal: () => void;
  onPlanGenerated: (planData: PlanResponse) => void;
  onCreateGoalAndStart: (payload: CreateGoalPayload) => Promise<void>;
  onSelectGoal: (goalId: string) => Promise<void>;
  onGenerateSession: () => Promise<void>;
  onRestartPlan: () => void;
  onStepCompleted: () => void;
  onSessionCompleted: (summary: TasksViewSessionSummary) => void;
  refreshTasks: () => Promise<void>;
  refreshPlan: () => Promise<void>;
  token: string;
};
