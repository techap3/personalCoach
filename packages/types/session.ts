export type SessionStatus = "active" | "completed" | "failed" | "none";

export type SessionType = "primary" | "bonus";

export interface Session {
  id?: string;
  goal_id?: string;
  plan_id?: string;
  plan_step_id?: string;
  session_date?: string;
  status: SessionStatus;
  session_type: SessionType;
  generation_locked?: boolean;
  summary_json?: {
    completed: number;
    skipped: number;
    completion_rate: number;
    message: string;
  } | null;
}
