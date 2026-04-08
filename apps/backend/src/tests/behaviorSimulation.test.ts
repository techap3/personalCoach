import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  enforceBehavioralPreferences,
  enforceTaskCount,
  enforceTargetDifficulty,
  type GeneratedTask,
} from "../services/ai/taskLimits";
import {
  chooseTargetDifficulty,
  computeDifficultyMetrics,
} from "../services/difficultyService";

type TaskRow = {
  goal_id: string;
  status: "done" | "skipped" | "pending";
  difficulty: number;
  task_type: string;
  created_at: string;
  completed_at?: string | null;
  skipped_at?: string | null;
};

type UserPreferenceRow = Record<string, any>;

type InMemoryState = {
  goals: Array<{ id: string; user_id: string }>;
  tasks: TaskRow[];
  user_preferences: UserPreferenceRow[];
};

const state: InMemoryState = {
  goals: [],
  tasks: [],
  user_preferences: [],
};

function shouldLogSimulation() {
  return process.env.SIMULATION_MODE === "true";
}

function simulationLog(message: string) {
  if (shouldLogSimulation()) {
    console.log(message);
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function formatTasks(label: string, tasks: GeneratedTask[]) {
  simulationLog(`${label}:`);
  for (const task of tasks) {
    simulationLog(`- [${task.task_type}] [d${task.difficulty}] ${task.title} :: ${task.description}`);
  }
}

function formatMemory(memory: any) {
  const skipPattern = memory?.skip_pattern || {};
  simulationLog("Memory State:");
  simulationLog(`- completion rate: ${Number(memory?.avg_completion_rate ?? 0).toFixed(2)}`);
  simulationLog(`- preferred difficulty: ${memory?.preferred_difficulty ?? "n/a"}`);
  simulationLog(`- consistency score: ${Number(memory?.consistency_score ?? 0).toFixed(2)}`);
  simulationLog(`- skip pattern: ${JSON.stringify(skipPattern)}`);
}

function formatDifficultyComparison(before: GeneratedTask[], after: GeneratedTask[]) {
  const beforeAvg = before.length
    ? before.reduce((sum, task) => sum + task.difficulty, 0) / before.length
    : 0;
  const afterAvg = after.length
    ? after.reduce((sum, task) => sum + task.difficulty, 0) / after.length
    : 0;

  simulationLog(`Difficulty Before: ${beforeAvg.toFixed(2)}`);
  simulationLog(`Difficulty After: ${afterAvg.toFixed(2)}`);
  simulationLog(`Difficulty Vector Before: [${before.map((task) => task.difficulty).join(", ")}]`);
  simulationLog(`Difficulty Vector After: [${after.map((task) => task.difficulty).join(", ")}]`);
}

function buildScenarioPipeline(
  baseTasks: GeneratedTask[],
  memory: any,
  recentStatusRows: Array<{ status: "done" | "skipped" }>
) {
  const beforeAdaptation = enforceTaskCount(baseTasks, {
    desiredCount: 3,
    stepTitle: "Simulation Step",
  });

  const metrics = computeDifficultyMetrics(recentStatusRows as any);
  const targetDifficulty = chooseTargetDifficulty(2, metrics);

  const difficultyAdjusted = enforceTargetDifficulty(beforeAdaptation, targetDifficulty);
  const behaviorAdjusted = enforceBehavioralPreferences(difficultyAdjusted, {
    preferredDifficulty: memory?.preferred_difficulty,
    skipPattern: memory?.skip_pattern,
    originalTasks: difficultyAdjusted,
  });

  const finalTasks = enforceTaskCount(behaviorAdjusted, {
    desiredCount: 3,
    stepTitle: "Simulation Step",
  });

  return {
    metrics,
    targetDifficulty,
    beforeAdaptation,
    finalTasks,
  };
}

function setLogs(tasks: TaskRow[]) {
  state.tasks = clone(tasks);
}

function resetState() {
  state.goals = [{ id: "goal-1", user_id: "user-1" }];
  state.tasks = [];
  state.user_preferences = [];
}

vi.mock("../db/supabase", () => {
  class Query {
    private goalIds: string[] | null = null;
    private userId: string | null = null;

    constructor(private table: keyof InMemoryState) {}

    select() {
      return this;
    }

    eq(field: string, value: any) {
      if (this.table === "goals" && field === "user_id") {
        this.userId = String(value);
      }
      if (this.table === "user_preferences" && field === "user_id") {
        this.userId = String(value);
      }
      return this;
    }

    in(field: string, values: any[]) {
      if (this.table === "tasks" && field === "goal_id") {
        this.goalIds = values.map(String);
      }
      return this;
    }

    or() {
      return this;
    }

    order() {
      return this;
    }

    async limit(_count: number) {
      if (this.table === "goals") {
        const rows = state.goals.filter((goal) => goal.user_id === this.userId);
        return { data: clone(rows), error: null };
      }
      if (this.table === "tasks") {
        const rows = this.goalIds
          ? state.tasks.filter((task) => this.goalIds?.includes(task.goal_id))
          : state.tasks;
        return { data: clone(rows), error: null };
      }
      return { data: [], error: null };
    }

    async upsert(payload: any, _options?: any) {
      if (this.table !== "user_preferences") {
        return { data: null, error: null };
      }

      const existingIndex = state.user_preferences.findIndex(
        (row) => row.user_id === payload.user_id
      );

      if (existingIndex >= 0) {
        state.user_preferences[existingIndex] = {
          ...state.user_preferences[existingIndex],
          ...clone(payload),
        };
      } else {
        state.user_preferences.push(clone(payload));
      }

      return { data: null, error: null };
    }

    async maybeSingle() {
      if (this.table === "user_preferences") {
        const row = state.user_preferences.find((item) => item.user_id === this.userId) || null;
        return { data: clone(row), error: null };
      }
      return { data: null, error: null };
    }
  }

  return {
    getSupabaseClient: () => ({
      from: (table: keyof InMemoryState) => new Query(table),
    }),
  };
});

describe("behavior-driven adaptation simulation", () => {
  beforeEach(() => {
    resetState();
  });

  it("simulates skip-pattern adaptation and prints readable summaries", async () => {
    const { updateUserPreferences, getUserMemory } = await import("../services/memory/userMemory");

    setLogs([
      {
        goal_id: "goal-1",
        status: "skipped",
        difficulty: 2,
        task_type: "running",
        created_at: "2026-04-05T09:00:00.000Z",
        skipped_at: "2026-04-05T09:20:00.000Z",
      },
      {
        goal_id: "goal-1",
        status: "skipped",
        difficulty: 2,
        task_type: "running",
        created_at: "2026-04-06T09:00:00.000Z",
        skipped_at: "2026-04-06T09:20:00.000Z",
      },
      {
        goal_id: "goal-1",
        status: "skipped",
        difficulty: 2,
        task_type: "running",
        created_at: "2026-04-07T09:00:00.000Z",
        skipped_at: "2026-04-07T09:20:00.000Z",
      },
    ]);

    await updateUserPreferences("token", "user-1", { force: true, windowDays: 7 });
    const memory = await getUserMemory("token", "user-1");

    const baseTasks = [
      { title: "Run drills", description: "20 min running drills", difficulty: 2, task_type: "running" as any },
      { title: "Core work", description: "10 min core", difficulty: 2, task_type: "action" },
      { title: "Reflect fatigue", description: "journal notes", difficulty: 2, task_type: "reflect" },
    ] as GeneratedTask[];

    const result = buildScenarioPipeline(baseTasks, memory, state.tasks.map((t) => ({ status: t.status })) as any);

    simulationLog("\n=== SKIP PATTERN TEST ===");
    formatMemory(memory);
    formatTasks("Before Adaptation", result.beforeAdaptation);
    formatTasks("After Adaptation", result.finalTasks);
    formatDifficultyComparison(result.beforeAdaptation, result.finalTasks);

    const beforeRunning = result.beforeAdaptation.filter((task) => (task as any).task_type === "running").length;
    const afterRunning = result.finalTasks.filter((task) => (task as any).task_type === "running").length;
    expect(afterRunning).toBeLessThanOrEqual(beforeRunning);
  });

  it("simulates high completion and shows difficulty lift", async () => {
    const { updateUserPreferences, getUserMemory } = await import("../services/memory/userMemory");

    setLogs([
      { goal_id: "goal-1", status: "done", difficulty: 3, task_type: "action", created_at: "2026-04-05T09:00:00.000Z", completed_at: "2026-04-05T09:20:00.000Z" },
      { goal_id: "goal-1", status: "done", difficulty: 3, task_type: "learn", created_at: "2026-04-06T09:00:00.000Z", completed_at: "2026-04-06T09:20:00.000Z" },
      { goal_id: "goal-1", status: "done", difficulty: 3, task_type: "reflect", created_at: "2026-04-07T09:00:00.000Z", completed_at: "2026-04-07T09:20:00.000Z" },
    ]);

    await updateUserPreferences("token", "user-1", { force: true, windowDays: 7 });
    const memory = await getUserMemory("token", "user-1");

    const baseTasks: GeneratedTask[] = [
      { title: "Build feature", description: "Implement a focused feature", difficulty: 2, task_type: "action" },
      { title: "Read docs", description: "Read one section", difficulty: 2, task_type: "learn" },
      { title: "Daily review", description: "Summarize wins", difficulty: 2, task_type: "review" },
    ];

    const result = buildScenarioPipeline(baseTasks, memory, state.tasks.map((t) => ({ status: t.status })) as any);

    simulationLog("\n=== HIGH COMPLETION TEST ===");
    formatMemory(memory);
    simulationLog(`Completion Rate: ${result.metrics.completion_rate.toFixed(2)}`);
    formatTasks("Before Adaptation", result.beforeAdaptation);
    formatTasks("After Adaptation", result.finalTasks);
    formatDifficultyComparison(result.beforeAdaptation, result.finalTasks);

    expect(result.targetDifficulty).toBeGreaterThanOrEqual(3);
  });

  it("simulates low completion and shows easier tasks", async () => {
    const { updateUserPreferences, getUserMemory } = await import("../services/memory/userMemory");

    setLogs([
      { goal_id: "goal-1", status: "skipped", difficulty: 2, task_type: "action", created_at: "2026-04-05T09:00:00.000Z", skipped_at: "2026-04-05T09:20:00.000Z" },
      { goal_id: "goal-1", status: "skipped", difficulty: 2, task_type: "learn", created_at: "2026-04-06T09:00:00.000Z", skipped_at: "2026-04-06T09:20:00.000Z" },
      { goal_id: "goal-1", status: "skipped", difficulty: 2, task_type: "review", created_at: "2026-04-07T09:00:00.000Z", skipped_at: "2026-04-07T09:20:00.000Z" },
    ]);

    await updateUserPreferences("token", "user-1", { force: true, windowDays: 7 });
    const memory = await getUserMemory("token", "user-1");

    const baseTasks: GeneratedTask[] = [
      { title: "Push implementation", description: "Harder deliverable", difficulty: 2, task_type: "action" },
      { title: "Deep dive", description: "Advanced reading", difficulty: 2, task_type: "learn" },
      { title: "Review notes", description: "Retrospective", difficulty: 2, task_type: "review" },
    ];

    const result = buildScenarioPipeline(baseTasks, memory, state.tasks.map((t) => ({ status: t.status })) as any);

    simulationLog("\n=== LOW COMPLETION TEST ===");
    formatMemory(memory);
    simulationLog(`Completion Rate: ${result.metrics.completion_rate.toFixed(2)}`);
    formatTasks("Before Adaptation", result.beforeAdaptation);
    formatTasks("After Adaptation", result.finalTasks);
    formatDifficultyComparison(result.beforeAdaptation, result.finalTasks);

    expect(result.targetDifficulty).toBeLessThanOrEqual(1);
  });

  it("simulates mixed behavior across 3 days and prints day-4 adaptation", async () => {
    const { updateUserPreferences, getUserMemory } = await import("../services/memory/userMemory");

    setLogs([
      { goal_id: "goal-1", status: "done", difficulty: 2, task_type: "action", created_at: "2026-04-05T09:00:00.000Z", completed_at: "2026-04-05T09:20:00.000Z" },
      { goal_id: "goal-1", status: "done", difficulty: 2, task_type: "learn", created_at: "2026-04-05T10:00:00.000Z", completed_at: "2026-04-05T10:20:00.000Z" },
      { goal_id: "goal-1", status: "skipped", difficulty: 2, task_type: "running", created_at: "2026-04-05T11:00:00.000Z", skipped_at: "2026-04-05T11:20:00.000Z" },

      { goal_id: "goal-1", status: "done", difficulty: 2, task_type: "action", created_at: "2026-04-06T09:00:00.000Z", completed_at: "2026-04-06T09:20:00.000Z" },
      { goal_id: "goal-1", status: "skipped", difficulty: 2, task_type: "running", created_at: "2026-04-06T10:00:00.000Z", skipped_at: "2026-04-06T10:20:00.000Z" },
      { goal_id: "goal-1", status: "skipped", difficulty: 2, task_type: "learn", created_at: "2026-04-06T11:00:00.000Z", skipped_at: "2026-04-06T11:20:00.000Z" },

      { goal_id: "goal-1", status: "done", difficulty: 3, task_type: "action", created_at: "2026-04-07T09:00:00.000Z", completed_at: "2026-04-07T09:20:00.000Z" },
      { goal_id: "goal-1", status: "done", difficulty: 3, task_type: "learn", created_at: "2026-04-07T10:00:00.000Z", completed_at: "2026-04-07T10:20:00.000Z" },
      { goal_id: "goal-1", status: "done", difficulty: 3, task_type: "review", created_at: "2026-04-07T11:00:00.000Z", completed_at: "2026-04-07T11:20:00.000Z" },
    ]);

    await updateUserPreferences("token", "user-1", { force: true, windowDays: 7 });
    const memory = await getUserMemory("token", "user-1");

    const day4Base: GeneratedTask[] = [
      { title: "Run hill sprints", description: "Hard running set", difficulty: 2, task_type: "running" as any },
      { title: "Implement module", description: "Build concrete feature", difficulty: 2, task_type: "action" },
      { title: "Review outcomes", description: "Write end-of-day review", difficulty: 2, task_type: "review" },
    ];

    const result = buildScenarioPipeline(day4Base, memory, state.tasks.map((t) => ({ status: t.status })) as any);

    simulationLog("\n=== MIXED BEHAVIOR TEST ===");
    formatMemory(memory);
    formatTasks("Before Adaptation", result.beforeAdaptation);
    formatTasks("After Adaptation", result.finalTasks);
    formatDifficultyComparison(result.beforeAdaptation, result.finalTasks);

    expect(result.finalTasks).toHaveLength(3);
  });

  it("simulates day-by-day streak updates with printed outputs", () => {
    type Action = "done" | "skipped";
    type ProgressState = {
      streak: number;
      lastCompletedDate: string | null;
      completedToday: number;
      totalToday: number;
    };

    const getMessage = (streak: number, completionRateToday: number) => {
      if (streak >= 5) return "You're on fire 🔥";
      if (completionRateToday >= 0.7) return "Great consistency";
      if (completionRateToday > 0) return "Nice. You're making progress";
      return "Let's get started";
    };

    const shiftDay = (dateIso: string, days: number) => {
      const date = new Date(`${dateIso}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    };

    const applyDayAction = (
      state: ProgressState,
      dateIso: string,
      action: Action
    ): ProgressState => {
      const next: ProgressState = {
        ...state,
        totalToday: state.totalToday + 1,
        completedToday: state.completedToday,
      };

      if (action === "done") {
        next.completedToday += 1;
        if (next.completedToday === 1) {
          const yesterday = shiftDay(dateIso, -1);
          next.streak = next.lastCompletedDate === yesterday ? next.streak + 1 : 1;
          next.lastCompletedDate = dateIso;
        }
      }

      const completionRateToday =
        next.totalToday > 0 ? next.completedToday / next.totalToday : 0;

      simulationLog(`\n--- ${dateIso} (${action}) ---`);
      simulationLog(`completed_today: ${next.completedToday}`);
      simulationLog(`total_today: ${next.totalToday}`);
      simulationLog(`streak: ${next.streak}`);
      simulationLog(`message: ${getMessage(next.streak, completionRateToday)}`);

      return next;
    };

    simulationLog("\n=== STREAK FEEDBACK SIMULATION ===");

    // Day 1: complete 1 task -> streak = 1
    let state: ProgressState = {
      streak: 0,
      lastCompletedDate: null,
      completedToday: 0,
      totalToday: 0,
    };
    state = applyDayAction(state, "2026-04-01", "done");
    expect(state.streak).toBe(1);

    // Day 2: complete 1 task -> streak = 2
    state = {
      ...state,
      completedToday: 0,
      totalToday: 0,
    };
    state = applyDayAction(state, "2026-04-02", "done");
    expect(state.streak).toBe(2);

    // Day 3: skip -> streak unchanged
    state = {
      ...state,
      completedToday: 0,
      totalToday: 0,
    };
    state = applyDayAction(state, "2026-04-03", "skipped");
    expect(state.streak).toBe(2);

    // Day 4: complete -> streak resets to 1
    state = {
      ...state,
      completedToday: 0,
      totalToday: 0,
    };
    state = applyDayAction(state, "2026-04-04", "done");
    expect(state.streak).toBe(1);
  });
});
