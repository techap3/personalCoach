export type SessionSummary = {
  completed: number;
  skipped: number;
  completion_rate: number;
  message: string;
};

export function getSummaryMessage(completionRate: number) {
  if (completionRate >= 0.8) {
    return "Great consistency today. Keep it up.";
  }

  if (completionRate >= 0.4) {
    return "Good effort. Try to complete a bit more tomorrow.";
  }

  return "Start small. Focus on completing at least one task fully.";
}

export function buildSessionSummaryFromTasks(tasks: Array<{ status?: string }>): SessionSummary {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const completed = safeTasks.filter((task) => task.status === "done").length;
  const skipped = safeTasks.filter((task) => task.status === "skipped").length;
  const total = safeTasks.length;
  const completionRate = total > 0 ? completed / total : 0;

  return {
    completed,
    skipped,
    completion_rate: Number(completionRate.toFixed(2)),
    message: getSummaryMessage(completionRate),
  };
}

export async function generateSessionSummary(sessionId: string, supabase: any): Promise<SessionSummary> {
  const { data: tasks } = await supabase
    .from("tasks")
    .select("status")
    .eq("session_id", sessionId)
    .neq("status", "archived");

  return buildSessionSummaryFromTasks(tasks || []);
}
