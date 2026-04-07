import type { Session } from "@repo/types";

export interface SessionSummaryResponse {
  success: boolean;
  session: Session | null;
  summary: {
    completed: number;
    skipped: number;
    completion_rate: number;
    message: string;
  } | null;
}
