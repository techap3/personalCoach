import type { TaskStatus as SharedTaskStatus } from "../../../../packages/types";

const DEFAULT_DIFFICULTY = 2;
const MIN_DIFFICULTY = 1;
const MAX_DIFFICULTY = 5;
const DEFAULT_LOOKBACK = 5;
const MIN_PREFERENCE_DIFFICULTY = 1;
const MAX_PREFERENCE_DIFFICULTY = 3;

type SessionRow = { id: string };
type TaskStatus = SharedTaskStatus | "archived" | string;
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
  const completion = Number(metrics.completion_rate);

  if (!Number.isFinite(completion)) {
    return 2;
  }

  if (completion < 0.4) {
    return 1;
  }

  if (completion < 0.75) {
    return 2;
  }

  return 3;
}

function clampPreferenceDifficulty(value: number) {
  if (!Number.isFinite(value)) return 2;
  if (value < MIN_PREFERENCE_DIFFICULTY) return MIN_PREFERENCE_DIFFICULTY;
  if (value > MAX_PREFERENCE_DIFFICULTY) return MAX_PREFERENCE_DIFFICULTY;
  return Math.round(value);
}

function mapDifficultyToPreference(value: number) {
  const rounded = clampDifficulty(value);
  if (rounded <= 2) return 1;
  if (rounded >= 4) return 3;
  return 2;
}

function mapPreferenceToDifficulty(value: number) {
  const clamped = clampPreferenceDifficulty(value);
  if (clamped <= 1) return 2;
  if (clamped >= 3) return 4;
  return 3;
}

function inferPreferenceFromMetrics(
  currentPreference: number,
  metrics: Pick<DifficultyMetrics, "completion_rate" | "skip_rate">
) {
  const completion = Number(metrics.completion_rate);

  if (!Number.isFinite(completion)) {
    return 2;
  }

  if (completion < 0.4) return 1;
  if (completion < 0.75) return 2;
  return 3;
}

function smoothPreferenceDifficulty(previousPreference: number, inferredPreference: number) {
  const smoothed = Math.round(0.7 * previousPreference + 0.3 * inferredPreference);
  return clampPreferenceDifficulty(smoothed);
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
    preferredDifficulty?: number;
  }
) {
  const lookbackSessions = options?.lookbackSessions ?? DEFAULT_LOOKBACK;
  const fallbackDifficulty = clampDifficulty(options?.defaultDifficulty ?? DEFAULT_DIFFICULTY);

  const currentDifficulty =
    options?.currentDifficulty == null
      ? await getCurrentStepDifficulty(supabase, goalId, fallbackDifficulty)
      : clampDifficulty(options.currentDifficulty);

  let preferenceRow: { preferred_difficulty?: number | null } | null = null;
  if (typeof options?.preferredDifficulty === "number" && Number.isFinite(options.preferredDifficulty)) {
    preferenceRow = { preferred_difficulty: options.preferredDifficulty };
  } else {
    try {
      const preferenceQuery = await supabase
        .from("user_preferences")
        .select("preferred_difficulty")
        .eq("user_id", userId)
        .maybeSingle();

      if (preferenceQuery?.error) {
        console.warn("[difficulty] Failed to read user preference, falling back", {
          user_id: userId,
          error: preferenceQuery.error.message,
        });
      } else {
        preferenceRow = (preferenceQuery?.data ?? null) as {
          preferred_difficulty?: number | null;
        } | null;
      }
    } catch (error: any) {
      console.warn("[difficulty] Failed to read user preference, falling back", {
        user_id: userId,
        error: error?.message,
      });
    }
  }

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

  const rawPreference = preferenceRow?.preferred_difficulty;
  const hasStoredPreference =
    typeof rawPreference === "number" &&
    Number.isFinite(rawPreference);

  const previousPreference = hasStoredPreference
    ? rawPreference
    : null;

  const basePreference = hasStoredPreference
    ? clampPreferenceDifficulty(previousPreference)
    : mapDifficultyToPreference(currentDifficulty);
  const inferredPreference = inferPreferenceFromMetrics(basePreference, metrics);
  const smoothedPreference = smoothPreferenceDifficulty(basePreference, inferredPreference);
  const targetDifficulty = hasStoredPreference
    ? mapPreferenceToDifficulty(smoothedPreference)
    : chooseTargetDifficulty(currentDifficulty, metrics);

  console.log("[difficulty] Computed target difficulty", {
    goal_id: goalId,
    completion_rate: metrics.completion_rate,
    skip_rate: metrics.skip_rate,
    current_difficulty: currentDifficulty,
    has_stored_preference: hasStoredPreference,
    previous_preference: basePreference,
    inferred_preference: inferredPreference,
    smoothed_preference: smoothedPreference,
    chosen_difficulty: targetDifficulty,
  });

  return {
    targetDifficulty,
    metrics,
    usedDefault: false,
  };
}
