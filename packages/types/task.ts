export type TaskStatus = "pending" | "done" | "skipped";

export type TaskType = "learn" | "action" | "reflect" | "review";

export interface Task {
  id?: string;
  goal_id?: string;
  session_id?: string;
  plan_step_id?: string;
  title: string;
  description: string;
  difficulty: number;
  status?: TaskStatus;
  task_type?: TaskType;
  created_at?: string;
  scheduled_date?: string;
}
