import { getSupabaseClient } from "../../db/supabase";

const MEMORY_WINDOW_DAYS = 7;
const MAX_LOG_ROWS = 500;
const UPDATE_DEBOUNCE_MS = 2000;

type TaskLog = {
  status?: string | null;
  difficulty?: number | null;
  task_type?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
  skipped_at?: string | null;
};

const lastUpdateByUser = new Map<string, number>();

function getWindowStartIso(days: number) {
  const now = new Date();
  now.setDate(now.getDate() - days);
  return now.toISOString();
}

function getTaskEventTimestamp(log: TaskLog) {
  return log.completed_at || log.skipped_at || log.created_at || null;
}

function clampPreferredDifficulty(value: number) {
  if (!Number.isFinite(value)) return 2;
  if (value < 1) return 1;
  if (value > 3) return 3;
  return Math.round(value);
}

function mapTaskDifficultyToBucket(value: number) {
  if (value <= 2) return 1;
  if (value >= 4) return 3;
  return 2;
}

function computeWindowMetrics(logs: TaskLog[]) {
  const resolved = logs.filter((log) => log.status === "done" || log.status === "skipped");
  const totalTasks = resolved.length;
  const totalCompleted = resolved.filter((log) => log.status === "done").length;
  const totalSkipped = resolved.filter((log) => log.status === "skipped").length;
  const completionRate = totalTasks === 0 ? 0 : totalCompleted / totalTasks;
  const skipRate = totalTasks === 0 ? 0 : totalSkipped / totalTasks;

  return {
    completionRate,
    skipRate,
    totalTasks,
    totalCompleted,
    totalSkipped,
  };
}

export function buildSkipPattern(logs: TaskLog[]) {
  const skipPattern: Record<string, number> = {};

  for (const log of logs) {
    if (log.status !== "skipped") continue;
    const category =
      typeof log.task_type === "string" && log.task_type.trim().length > 0
        ? log.task_type.trim().toLowerCase()
        : "general";
    skipPattern[category] = (skipPattern[category] || 0) + 1;
  }

  return skipPattern;
}

export function inferDifficulty(logs: TaskLog[]) {
  const buckets: Record<1 | 2 | 3, { done: number; total: number }> = {
    1: { done: 0, total: 0 },
    2: { done: 0, total: 0 },
    3: { done: 0, total: 0 },
  };

  for (const log of logs) {
    if (log.status !== "done" && log.status !== "skipped") continue;
    const difficulty = Number(log.difficulty ?? 2);
    const bucket = mapTaskDifficultyToBucket(Number.isFinite(difficulty) ? difficulty : 2) as 1 | 2 | 3;
    buckets[bucket].total += 1;
    if (log.status === "done") {
      buckets[bucket].done += 1;
    }
  }

  const scored = (Object.keys(buckets) as Array<"1" | "2" | "3">)
    .map((key) => {
      const bucket = Number(key) as 1 | 2 | 3;
      const total = buckets[bucket].total;
      const done = buckets[bucket].done;
      return {
        bucket,
        total,
        completionRate: total === 0 ? 0 : done / total,
      };
    })
    .filter((item) => item.total > 0)
    .sort((left, right) => {
      if (right.completionRate !== left.completionRate) {
        return right.completionRate - left.completionRate;
      }

      if (right.total !== left.total) {
        return right.total - left.total;
      }

      return left.bucket - right.bucket;
    });

  if (!scored.length) {
    return 2;
  }

  return clampPreferredDifficulty(scored[0].bucket);
}

export function calculateConsistency(logs: TaskLog[], windowDays = MEMORY_WINDOW_DAYS) {
  const uniqueDays = new Set<string>();

  for (const log of logs) {
    const timestamp = getTaskEventTimestamp(log);
    if (!timestamp) continue;
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) continue;
    uniqueDays.add(date.toISOString().slice(0, 10));
  }

  return uniqueDays.size / Math.max(1, windowDays);
}

async function fetchRecentTaskLogs(supabase: any, userId: string, windowDays = MEMORY_WINDOW_DAYS) {
  const { data: userGoals } = await supabase
    .from("goals")
    .select("id")
    .eq("user_id", userId)
    .limit(200);

  const goalIds = (userGoals || []).map((goal: any) => goal.id).filter(Boolean);
  if (!goalIds.length) {
    return [] as TaskLog[];
  }

  const windowStartIso = getWindowStartIso(windowDays);

  const { data: logs } = await supabase
    .from("tasks")
    .select("status, difficulty, task_type, created_at, completed_at, skipped_at")
    .in("goal_id", goalIds)
    .or(
      `created_at.gte.${windowStartIso},completed_at.gte.${windowStartIso},skipped_at.gte.${windowStartIso}`
    )
    .order("created_at", { ascending: false })
    .limit(MAX_LOG_ROWS);

  return (logs || []) as TaskLog[];
}

export async function updateUserPreferences(
  token: string,
  userId: string,
  options?: { force?: boolean; windowDays?: number }
) {
  const now = Date.now();
  const last = lastUpdateByUser.get(userId) ?? 0;
  if (!options?.force && now - last < UPDATE_DEBOUNCE_MS) {
    return;
  }
  lastUpdateByUser.set(userId, now);

  const supabase = getSupabaseClient(token);
  const windowDays = options?.windowDays ?? MEMORY_WINDOW_DAYS;

  try {
    const logs = await fetchRecentTaskLogs(supabase, userId, windowDays);
    const metrics = computeWindowMetrics(logs);
    const skipPattern = buildSkipPattern(logs);
    const preferredDifficulty = inferDifficulty(logs);
    const consistencyScore = calculateConsistency(logs, windowDays);

    const lastActive = logs
      .map((log) => getTaskEventTimestamp(log))
      .filter((value): value is string => typeof value === "string")
      .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] || null;

    await supabase
      .from("user_preferences")
      .upsert(
        {
          user_id: userId,
          avg_completion_rate: metrics.completionRate,
          skip_rate: metrics.skipRate,
          preferred_difficulty: preferredDifficulty,
          total_tasks: metrics.totalTasks,
          total_completed: metrics.totalCompleted,
          total_skipped: metrics.totalSkipped,
          skip_pattern: skipPattern,
          consistency_score: consistencyScore,
          last_active: lastActive,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
  } catch (error: any) {
    console.warn("[memory] Skipping preference update", {
      user_id: userId,
      error: error?.message,
    });
  }
}

export async function updateUserMemory(
  token: string,
  userId: string,
  _metrics: any
) {
  await updateUserPreferences(token, userId, { force: true });
}

export async function getUserMemory(token: string, userId: string) {
  const supabase = getSupabaseClient(token);

  try {
    const { data } = await supabase
      .from("user_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    return data;
  } catch (error: any) {
    console.warn("[memory] Failed to fetch user preferences", {
      user_id: userId,
      error: error?.message,
    });
    return null;
  }
}