import type { Task } from "@repo/types";

export interface PlanStep {
  title: string;
  description: string;
  difficulty: number;
}

export interface PlanResponse {
  plan: PlanStep[];
}

export interface TasksResponse {
  tasks: Task[];
}