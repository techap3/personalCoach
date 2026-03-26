export interface PlanStep {
  title: string;
  description: string;
  difficulty: number;
}

export interface PlanResponse {
  plan: PlanStep[];
}

export interface Task {
  title: string;
  description: string;
  difficulty: number;
}

export interface TasksResponse {
  tasks: Task[];
}