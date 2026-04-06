const DEFAULT_DIFFICULTY = 2;
const MIN_DIFFICULTY = 1;
const MAX_DIFFICULTY = 5;
const DEFAULT_LOOKBACK = 5;

type SessionRow = { id: string };
type TaskStatus = "done" | "skipped" | "pending" | "archived" | string;
type TaskRow = { status: TaskStatus };

export type DifficultyMetrics = {
  completion_rate: number;
  skip_rate: number;
  total_tasks: number;
  done_tasks: number;
  skipped_tasks: number;
};

export function clampDifficulty(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_DIFFICULTY;
  if (value < MIN_DIFFICULTY) return MIN_DIFFICULTY;
  if (value > MAX_DIFFICULTY) return MAX_DIFFICULTY;
  return Math.round(value);
}

export function computeDifficultyMetrics(tasks: TaskRow[]): DifficultyMetrics {
  const relevant = tasks.filter((task) => task.status !== "archived");
  const total = relevant.length;
  const done = relevant.filter((task) => task.status === "done").length;
  const skipped = relevant.filter((task) => task.status === "skipped").length;

  return {
    completion_rate: total === 0 ? 0 : done / total,
    skip_rate: total === 0 ? 0 : skipped / total,
    total_tasks: total,
    done_tasks: done,
    skipped_tasks: skipped,
  };
}

export function chooseTargetDifficulty(
  currentDifficulty: number,
  metrics: Pick<DifficultyMetrics, "completion_rate" | "skip_rate">
) {
  const base = clampDifficulty(currentDifficulty);

  if (metrics.skip_rate > 0.5) {
    return clampDifficulty(base - 1);
  }

  if (metrics.completion_rate > 0.8) {
    return clampDifficulty(base + 1);
  }

  return base;
}

async function getCurrentStepDifficulty(
  supabase: any,
  goalId: string,
  fallbackDifficulty: number
) {
  const { data: activeStep } = await supabase
    .from("plan_steps")
    .select("difficulty")
    .eq("goal_id", goalId)
    .neq("status", "completed")
    .order("step_index", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (activeStep?.difficulty == null) {
    return clampDifficulty(fallbackDifficulty);
  }

  return clampDifficulty(Number(activeStep.difficulty));
}

export async function getTargetDifficulty(
  supabase: any,
  userId: string,
  goalId: string,
  options?: {
    lookbackSessions?: number;
    defaultDifficulty?: number;
    currentDifficulty?: number;
  }
) {
  const lookbackSessions = options?.lookbackSessions ?? DEFAULT_LOOKBACK;
  const fallbackDifficulty = clampDifficulty(options?.defaultDifficulty ?? DEFAULT_DIFFICULTY);

  const currentDifficulty =
    options?.currentDifficulty == null
      ? await getCurrentStepDifficulty(supabase, goalId, fallbackDifficulty)
      : clampDifficulty(options.currentDifficulty);

  const { data: goal } = await supabase
    .from("goals")
    .select("id, user_id")
    .eq("id", goalId)
    .maybeSingle();

  if (!goal || goal.user_id !== userId) {
    console.warn("[difficulty] Goal not found for user, using default difficulty", {
      user_id: userId,
      goal_id: goalId,
      chosen_difficulty: fallbackDifficulty,
    });
    return {
      targetDifficulty: fallbackDifficulty,
      metrics: {
        completion_rate: 0,
        skip_rate: 0,
        total_tasks: 0,
        done_tasks: 0,
        skipped_tasks: 0,
      } satisfies DifficultyMetrics,
      usedDefault: true,
    };
  }

  const { data: recentSessions } = await supabase
    .from("task_sessions")
    .select("id")
    .eq("goal_id", goalId)
    .order("created_at", { ascending: false })
    .limit(lookbackSessions);

  const sessionIds = (recentSessions || []).map((session: SessionRow) => session.id);

  if (!sessionIds.length) {
    console.log("[difficulty] No recent session history, using default difficulty", {
      goal_id: goalId,
      completion_rate: 0,
      skip_rate: 0,
      chosen_difficulty: fallbackDifficulty,
    });
    return {
      targetDifficulty: fallbackDifficulty,
      metrics: {
        completion_rate: 0,
        skip_rate: 0,
        total_tasks: 0,
        done_tasks: 0,
        skipped_tasks: 0,
      } satisfies DifficultyMetrics,
      usedDefault: true,
    };
  }

  const { data: recentTasks } = await supabase
    .from("tasks")
    .select("status")
    .eq("goal_id", goalId)
    .in("session_id", sessionIds);

  const metrics = computeDifficultyMetrics((recentTasks || []) as TaskRow[]);

  if (!metrics.total_tasks) {
    console.log("[difficulty] No recent task history, using default difficulty", {
      goal_id: goalId,
      completion_rate: metrics.completion_rate,
      skip_rate: metrics.skip_rate,
      chosen_difficulty: fallbackDifficulty,
    });
    return {
      targetDifficulty: fallbackDifficulty,
      metrics,
      usedDefault: true,
    };
  }

  const targetDifficulty = chooseTargetDifficulty(currentDifficulty, metrics);

  console.log("[difficulty] Computed target difficulty", {
    goal_id: goalId,
    completion_rate: metrics.completion_rate,
    skip_rate: metrics.skip_rate,
    current_difficulty: currentDifficulty,
    chosen_difficulty: targetDifficulty,
  });

  return {
    targetDifficulty,
    metrics,
    usedDefault: false,
  };
}
