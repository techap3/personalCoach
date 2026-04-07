import type { SessionStatus, SessionType, Task } from "@repo/types";

export interface GenerateTasksResponse {
  type: "NEW_SESSION" | "ACTIVE_SESSION" | "LATEST_SESSION" | "NO_SESSION";
  sessionStatus: SessionStatus;
  sessionType: SessionType;
  sessionCompleted: boolean;
  tasks: Task[];
}

export interface UpdateTaskResponse {
  success: boolean;
  sessionCompleted: boolean;
  stepCompleted: boolean;
  message?: string;
}
