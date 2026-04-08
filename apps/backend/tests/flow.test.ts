import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import type supertest from "supertest";
import { normalizeTaskTitle } from "../src/services/ai/taskDedup";

const {
  generateAdaptedPlanMock,
  generateAdaptedTasksMock,
  parseAdaptedPlanMock,
  generatePlanMock,
  generateTasksForStepMock,
} = vi.hoisted(() => ({
  generateAdaptedPlanMock: vi.fn(async () => "{\"updated_plan\":[]}"),
  generateAdaptedTasksMock: vi.fn(async () => ({
    updated_tasks: [
      {
        title: "Adapted Task A",
        description: "Adjusted task A",
        difficulty: 2,
        task_type: "learn",
      },
      {
        title: "Adapted Task B",
        description: "Adjusted task B",
        difficulty: 2,
        task_type: "build",
      },
      {
        title: "Adapted Task C",
        description: "Adjusted task C",
        difficulty: 3,
        task_type: "review",
      },
    ],
  })),
  parseAdaptedPlanMock: vi.fn(() => ({
    updated_plan: [
      {
        title: "Improved Step 1",
        description: "Refined first step",
        difficulty: 2,
      },
      {
        title: "Improved Step 2",
        description: "Refined second step",
        difficulty: 3,
      },
    ],
  })),
  generatePlanMock: vi.fn(async () => ({
    plan: [
      {
        id: "step-1",
        title: "Step 1",
        description: "First step",
        difficulty: 1,
      },
      {
        id: "step-2",
        title: "Step 2",
        description: "Second step",
        difficulty: 2,
      },
    ],
  })),
  generateTasksForStepMock: vi.fn(async () => [
    {
      title: "Task A",
      description: "Do Task A",
      difficulty: 1,
    },
    {
      title: "Task B",
      description: "Do Task B",
      difficulty: 2,
    },
  ]),
}));

vi.mock("../src/services/ai", () => ({
  generatePlan: generatePlanMock,
}));

vi.mock("../src/services/ai/taskGenerator", () => ({
  generateTasksForStep: generateTasksForStepMock,
}));

vi.mock("../src/services/ai/adaptPlan", () => ({
  generateAdaptedPlan: generateAdaptedPlanMock,
}));

vi.mock("../src/services/ai/adaptTasks", () => ({
  generateAdaptedTasks: generateAdaptedTasksMock,
}));

vi.mock("../src/services/ai/adaptParser", () => ({
  parseAdaptedPlan: parseAdaptedPlanMock,
}));

vi.mock("../src/db/supabase", () => {
  type Row = Record<string, any>;

  const state = {
    id: 1,
    failPlanStepsInsert: false,
    forceGenerationLockContention: false,
    forceTaskSessionInsertConflictOnce: false,
    failUserPreferencesReadOnce: false,
    failUserPreferencesUpsertOnce: false,
    failTasksReadOnce: false,
    tables: {
      goals: [] as Row[],
      plans: [] as Row[],
      plan_steps: [] as Row[],
      task_sessions: [] as Row[],
      tasks: [] as Row[],
      user_preferences: [] as Row[],
    },
  };

  const nextId = (prefix: string) => `${prefix}-${state.id++}`;

  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

  const reset = () => {
    state.id = 1;
    state.failPlanStepsInsert = false;
    state.forceGenerationLockContention = false;
    state.forceTaskSessionInsertConflictOnce = false;
    state.failUserPreferencesReadOnce = false;
    state.failUserPreferencesUpsertOnce = false;
    state.failTasksReadOnce = false;
    state.tables.goals = [];
    state.tables.plans = [];
    state.tables.plan_steps = [];
    state.tables.task_sessions = [];
    state.tables.tasks = [];
    state.tables.user_preferences = [];
  };

  class QueryBuilder {
    private action: "select" | "insert" | "update" | "upsert" = "select";
    private filters: Array<{ op: string; field: string; value: any }> = [];
    private orderField: string | null = null;
    private ascending = true;
    private limitValue: number | null = null;
    private selectColumns = "*";
    private insertValues: Row[] = [];
    private updateValues: Row = {};
    private returnMutatedRows = false;

    constructor(private table: keyof typeof state.tables) {}

    select(columns = "*") {
      this.selectColumns = columns;
      if (this.action === "insert" || this.action === "update") {
        this.returnMutatedRows = true;
      }
      return this;
    }

    insert(values: Row | Row[]) {
      this.action = "insert";
      this.insertValues = Array.isArray(values) ? values : [values];
      return this;
    }

    upsert(values: Row | Row[], _options?: { onConflict?: string }) {
      this.action = "upsert";
      this.insertValues = Array.isArray(values) ? values : [values];
      return this;
    }

    update(values: Row) {
      this.action = "update";
      this.updateValues = values;
      return this;
    }

    delete() {
      this.action = "update";
      this.updateValues = { __delete: true };
      return this;
    }

    eq(field: string, value: any) {
      this.filters.push({ op: "eq", field, value });
      return this;
    }

    neq(field: string, value: any) {
      this.filters.push({ op: "neq", field, value });
      return this;
    }

    gt(field: string, value: any) {
      this.filters.push({ op: "gt", field, value });
      return this;
    }

    in(field: string, values: any[]) {
      this.filters.push({ op: "in", field, value: values });
      return this;
    }

    order(field: string, options?: { ascending?: boolean }) {
      this.orderField = field;
      this.ascending = options?.ascending ?? true;
      return this;
    }

    limit(value: number) {
      this.limitValue = value;
      return this;
    }

    async single() {
      const result = await this.execute();
      const first = Array.isArray(result.data) ? result.data[0] ?? null : result.data;
      return { data: first, error: result.error };
    }

    async maybeSingle() {
      const result = await this.execute();
      const first = Array.isArray(result.data) ? result.data[0] ?? null : result.data;
      return { data: first, error: result.error };
    }

    then(resolve: (value: any) => void, reject?: (reason?: any) => void) {
      this.execute().then(resolve, reject);
    }

    private getFieldValue(row: Row, field: string) {
      if (field.includes(".")) {
        const [left, right] = field.split(".");
        if (left === "goals" && right === "user_id") {
          const goal = state.tables.goals.find((g) => g.id === row.goal_id);
          return goal?.user_id;
        }
      }
      return row[field];
    }

    private applyFilters(rows: Row[]) {
      return rows.filter((row) => {
        for (const filter of this.filters) {
          const rowValue = this.getFieldValue(row, filter.field);
          if (filter.op === "eq" && rowValue !== filter.value) return false;
          if (filter.op === "neq" && rowValue === filter.value) return false;
          if (filter.op === "gt" && !(rowValue > filter.value)) return false;
          if (filter.op === "in" && !filter.value.includes(rowValue)) return false;
        }
        return true;
      });
    }

    private applySelect(rows: Row[]) {
      if (this.selectColumns === "*") return rows;

      const cols = this.selectColumns.split(",").map((c) => c.trim());
      return rows.map((row) => {
        const projected: Row = {};
        for (const col of cols) {
          if (col.includes("!")) {
            if (col.startsWith("goals!inner")) {
              const goal = state.tables.goals.find((g) => g.id === row.goal_id);
              projected.goals = { user_id: goal?.user_id };
            }
            continue;
          }
          projected[col] = row[col];
        }
        return projected;
      });
    }

    private async execute() {
      const table = state.tables[this.table];

      if (this.action === "insert" || this.action === "upsert") {
        if (this.table === "plan_steps" && state.failPlanStepsInsert) {
          return {
            data: null,
            error: { message: "simulated plan_steps failure" },
          };
        }

        if (this.table === "task_sessions") {
          if (state.forceTaskSessionInsertConflictOnce) {
            state.forceTaskSessionInsertConflictOnce = false;
            return {
              data: null,
              error: {
                message:
                  'duplicate key value violates unique constraint "task_sessions_goal_session_date_type_key"',
                code: "23505",
              },
            };
          }

          for (const item of this.insertValues) {
            const duplicate = table.find(
              (row) =>
                row.goal_id === item.goal_id &&
                row.session_date === item.session_date &&
                (row.session_type || "primary") === (item.session_type || "primary")
            );

            if (duplicate) {
              return {
                data: null,
                error: {
                  message:
                    'duplicate key value violates unique constraint "task_sessions_goal_session_date_type_key"',
                  code: "23505",
                },
              };
            }
          }
        }

        if (
          this.table === "user_preferences" &&
          this.action === "upsert" &&
          state.failUserPreferencesUpsertOnce
        ) {
          state.failUserPreferencesUpsertOnce = false;
          return {
            data: null,
            error: { message: "simulated user_preferences upsert failure" },
          };
        }

        if (this.table === "user_preferences" && this.action === "upsert") {
          const upserted = this.insertValues.map((item) => {
            const existing = table.find((row) => row.user_id === item.user_id);
            if (existing) {
              Object.assign(existing, item);
              return clone(existing);
            }

            const row: Row = { ...item };
            if (!row.id) row.id = nextId(this.table.slice(0, -1) || "row");
            if (!row.created_at) row.created_at = new Date().toISOString();
            table.push(row);
            return clone(row);
          });

          return {
            data: this.returnMutatedRows ? upserted : null,
            error: null,
          };
        }

        const inserted = this.insertValues.map((item) => {
          const row: Row = { ...item };
          if (!row.id) row.id = nextId(this.table.slice(0, -1) || "row");
          if (this.table === "task_sessions" && typeof row.generation_locked === "undefined") {
            row.generation_locked = false;
          }
          if (!row.created_at) row.created_at = new Date().toISOString();
          table.push(row);
          return clone(row);
        });

        return {
          data: this.returnMutatedRows ? inserted : null,
          error: null,
        };
      }

      if (this.action === "update") {
        const filtered = this.applyFilters(table);

        if (
          this.table === "task_sessions" &&
          state.forceGenerationLockContention &&
          this.updateValues?.generation_locked === true &&
          this.filters.some((filter) => filter.op === "eq" && filter.field === "generation_locked" && filter.value === false)
        ) {
          return {
            data: this.returnMutatedRows ? [] : null,
            error: null,
          };
        }

        if ((this.updateValues as any).__delete) {
          const remaining = table.filter(
            (row) => !filtered.some((candidate) => candidate.id === row.id)
          );
          state.tables[this.table] = remaining as any;
          return {
            data: this.returnMutatedRows ? clone(filtered) : null,
            error: null,
          };
        }

        const updated = filtered.map((row) => {
          Object.assign(row, this.updateValues);
          return clone(row);
        });

        return {
          data: this.returnMutatedRows ? updated : null,
          error: null,
        };
      }

      if (this.table === "user_preferences" && state.failUserPreferencesReadOnce) {
        state.failUserPreferencesReadOnce = false;
        return {
          data: null,
          error: { message: "simulated user_preferences read failure" },
        };
      }

      if (this.table === "tasks" && state.failTasksReadOnce) {
        state.failTasksReadOnce = false;
        return {
          data: null,
          error: { message: "simulated tasks read failure" },
        };
      }

      let rows = this.applyFilters(table).map((row) => clone(row));

      if (this.orderField) {
        rows.sort((a, b) => {
          const av = this.getFieldValue(a, this.orderField as string);
          const bv = this.getFieldValue(b, this.orderField as string);
          if (av === bv) return 0;
          if (this.ascending) return av > bv ? 1 : -1;
          return av < bv ? 1 : -1;
        });
      }

      if (typeof this.limitValue === "number") {
        rows = rows.slice(0, this.limitValue);
      }

      rows = this.applySelect(rows);

      return { data: rows, error: null };
    }
  }

  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } } }),
    },
    rpc: async (name: string, params: Record<string, any>) => {
      if (name !== "update_task_if_session_not_completed") {
        return { data: null, error: { message: `Unknown rpc function: ${name}` } };
      }

      const taskId = params.p_task_id;
      const task = state.tables.tasks.find((candidate) => String(candidate.id) === String(taskId));
      if (!task) {
        return { data: [], error: null };
      }

      const session = state.tables.task_sessions.find((candidate) => candidate.id === task.session_id);
      if (!session || session.status === "completed") {
        return { data: [], error: null };
      }

      task.status = params.p_status;
      task.completed_at = params.p_completed_at ?? null;
      task.skipped_at = params.p_skipped_at ?? null;

      return { data: [clone(task)], error: null };
    },
    from: (table: keyof typeof state.tables) => new QueryBuilder(table),
  };

  return {
    __mockState: state,
    __resetMockDb: reset,
    getSupabaseClient: () => client,
  };
});

let app: Express;
let request: typeof supertest;
let mockState: any;
let resetMockDb: () => void;

const authHeader = () => {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: "user-1" })).toString("base64url");
  const signature = Buffer.from("signature").toString("base64url");
  return `Bearer ${header}.${payload}.${signature}`;
};

const getLocalDateString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

async function createGoal() {
  const response = await request(app)
    .post("/goals")
    .set("Authorization", authHeader())
    .send({ title: "Learn booking", description: "Flow test" });

  expect(response.status).toBe(200);
  return response.body.goal.id as string;
}

async function createGoalWithTitle(title: string) {
  const response = await request(app)
    .post("/goals")
    .set("Authorization", authHeader())
    .send({ title, description: "Flow test" });

  expect(response.status).toBe(200);
  return response.body.goal.id as string;
}

function containsGoal(task: { title?: string; description?: string }, goal: string) {
  const text = `${task.title || ""} ${task.description || ""}`.toLowerCase();
  const goalTokens = goal
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length >= 4);

  return (
    text.includes("coach") ||
    text.includes("app") ||
    text.includes("goal") ||
    text.includes("objective") ||
    text.includes("target") ||
    goalTokens.some((token) => text.includes(token))
  );
}

function semanticGroupKey(title: string) {
  const normalized = title.toLowerCase();
  if (/(win|worked|achievement)/.test(normalized)) return "wins";
  if (/(plan|next step|priority)/.test(normalized)) return "plan";
  if (/(implement|build|fix|create)/.test(normalized)) return "action";
  if (/(review|reflect|summarize)/.test(normalized)) return "review";
  return "other";
}

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  request = (await import("supertest")).default;
  ({ app } = await import("../src/index"));

  const supabaseModule = (await import("../src/db/supabase")) as any;
  mockState = supabaseModule.__mockState;
  resetMockDb = supabaseModule.__resetMockDb;
});

beforeEach(() => {
  resetMockDb();
  generatePlanMock.mockClear();
  generateTasksForStepMock.mockClear();
  generatePlanMock.mockImplementation(async () => ({
    plan: [
      {
        id: "step-1",
        title: "Step 1",
        description: "First step",
        difficulty: 1,
      },
      {
        id: "step-2",
        title: "Step 2",
        description: "Second step",
        difficulty: 2,
      },
    ],
  }));
  generateTasksForStepMock.mockImplementation(async () => [
    {
      title: "Task A",
      description: "Do Task A",
      difficulty: 1,
    },
    {
      title: "Task B",
      description: "Do Task B",
      difficulty: 2,
    },
  ]);
  generateAdaptedPlanMock.mockClear();
  generateAdaptedTasksMock.mockClear();
  parseAdaptedPlanMock.mockClear();
  generateAdaptedPlanMock.mockImplementation(async () => "{\"updated_plan\":[]}");
  generateAdaptedTasksMock.mockImplementation(async () => ({
    updated_tasks: [
      {
        title: "Adapted Task A",
        description: "Adjusted task A",
        difficulty: 2,
        task_type: "learn",
      },
      {
        title: "Adapted Task B",
        description: "Adjusted task B",
        difficulty: 2,
        task_type: "build",
      },
      {
        title: "Adapted Task C",
        description: "Adjusted task C",
        difficulty: 3,
        task_type: "review",
      },
    ],
  }));
  parseAdaptedPlanMock.mockImplementation(() => ({
    updated_plan: [
      {
        title: "Improved Step 1",
        description: "Refined first step",
        difficulty: 2,
      },
      {
        title: "Improved Step 2",
        description: "Refined second step",
        difficulty: 3,
      },
    ],
  }));
});

describe("Flow tests", () => {
  it("should generate tasks for active step", async () => {
    const goalId = await createGoal();

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(response.status).toBe(200);
    expect(response.body.tasks).toHaveLength(3);
    expect(mockState.tables.task_sessions).toHaveLength(1);
    expect(mockState.tables.task_sessions[0].status).toBe("active");
    expect(mockState.tables.task_sessions[0].session_type).toBe("primary");
    expect(response.body.sessionType).toBe("primary");
  });

  it("should not regenerate tasks if session active", async () => {
    const goalId = await createGoal();

    const first = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    const second = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mockState.tables.task_sessions).toHaveLength(1);

    const firstIds = first.body.tasks.map((t: any) => t.id);
    const secondIds = second.body.tasks.map((t: any) => t.id);
    expect(secondIds).toEqual(firstIds);
  });

  it("should generate bonus session for next step when primary session is completed", async () => {
    const goalId = await createGoal();

    const first = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    for (const task of first.body.tasks) {
      await request(app)
        .post("/tasks/update")
        .set("Authorization", authHeader())
        .send({ task_id: task.id, status: "done" });
    }

    const second = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(second.status).toBe(200);
    expect(second.body.type).toBe("NEW_SESSION");
    expect(second.body.sessionType).toBe("bonus");
    expect(second.body.tasks).toHaveLength(3);

    const firstStep = mockState.tables.plan_steps.find((s: any) => s.step_index === 0);
    const secondStep = mockState.tables.plan_steps.find((s: any) => s.step_index === 1);
    const secondTaskStepIds = second.body.tasks.map((t: any) => t.plan_step_id);
    const secondSession = mockState.tables.task_sessions.find((s: any) => s.id === second.body.session.id);

    expect(firstStep?.status).toBe("completed");
    expect(secondStep?.status).toBe("active");
    expect(secondTaskStepIds.every((id: string) => id === secondStep?.id)).toBe(true);
    expect(secondSession?.session_type).toBe("bonus");
  });

  it("should mark step completed after tasks done", async () => {
    const goalId = await createGoal();

    const generated = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    for (const task of generated.body.tasks) {
      await request(app)
        .post("/tasks/update")
        .set("Authorization", authHeader())
        .send({ task_id: task.id, status: "done" });
    }

    const firstStep = mockState.tables.plan_steps.find((s: any) => s.step_index === 0);
    expect(firstStep?.status).toBe("completed");
  });

  it("should activate next step", async () => {
    const goalId = await createGoal();

    const generated = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    for (const task of generated.body.tasks) {
      await request(app)
        .post("/tasks/update")
        .set("Authorization", authHeader())
        .send({ task_id: task.id, status: "done" });
    }

    const nextStep = mockState.tables.plan_steps.find((s: any) => s.step_index === 1);
    expect(nextStep?.status).toBe("active");
  });

  it("should preserve done/skipped history when generating next set on same day", async () => {
    const goalId = await createGoal();

    const first = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(first.status).toBe(200);
    expect(first.body.tasks).toHaveLength(3);

    await request(app)
      .post("/tasks/update")
      .set("Authorization", authHeader())
      .send({ task_id: first.body.tasks[0].id, status: "done" });

    await request(app)
      .post("/tasks/update")
      .set("Authorization", authHeader())
      .send({ task_id: first.body.tasks[1].id, status: "skipped" });

    for (const task of first.body.tasks.slice(2)) {
      await request(app)
        .post("/tasks/update")
        .set("Authorization", authHeader())
        .send({ task_id: task.id, status: "skipped" });
    }

    const second = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(second.status).toBe(200);
    expect(second.body.type).toBe("NEW_SESSION");
    expect(second.body.sessionType).toBe("bonus");
    expect(second.body.tasks).toHaveLength(3);

    const firstTaskA = mockState.tables.tasks.find(
      (t: any) => t.id === first.body.tasks[0].id
    );
    const firstTaskB = mockState.tables.tasks.find(
      (t: any) => t.id === first.body.tasks[1].id
    );

    expect(firstTaskA?.status).toBe("done");
    expect(firstTaskB?.status).toBe("skipped");
  });

  it("creates primary session first and bonus session second, then blocks third", async () => {
    const goalId = await createGoal();

    const first = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(first.status).toBe(200);
    expect(first.body.sessionType).toBe("primary");

    for (const task of first.body.tasks) {
      await request(app)
        .post("/tasks/update")
        .set("Authorization", authHeader())
        .send({ task_id: task.id, status: "done" });
    }

    const second = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(second.status).toBe(200);
    expect(second.body.sessionType).toBe("bonus");

    for (const task of second.body.tasks) {
      await request(app)
        .post("/tasks/update")
        .set("Authorization", authHeader())
        .send({ task_id: task.id, status: "done" });
    }

    const third = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(third.status).toBe(409);
    expect(third.body.error).toBe("daily_limit_reached");
    expect(third.body.sessionType).toBe("bonus");
    expect(third.body.sessionStatus).toBe("completed");

    const today = getLocalDateString();
    const sessions = mockState.tables.task_sessions
      .filter((session: any) => session.goal_id === goalId && session.session_date === today)
      .sort((a: any, b: any) => a.created_at.localeCompare(b.created_at));

    expect(sessions).toHaveLength(2);
    expect(sessions[0].session_type).toBe("primary");
    expect(sessions[1].session_type).toBe("bonus");
  });

  it("applies lower target difficulty for bonus sessions", async () => {
    const goalId = await createGoal();

    const first = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(first.status).toBe(200);
    expect(first.body.tasks.every((task: any) => task.difficulty >= 1 && task.difficulty <= 3)).toBe(true);

    for (const task of first.body.tasks) {
      await request(app)
        .post("/tasks/update")
        .set("Authorization", authHeader())
        .send({ task_id: task.id, status: "done" });
    }

    const step2 = mockState.tables.plan_steps.find((s: any) => s.step_index === 1);
    if (step2) {
      step2.difficulty = 1;
    }

    const second = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(second.status).toBe(200);
    expect(second.body.sessionType).toBe("bonus");
    expect(second.body.tasks.every((task: any) => task.difficulty >= 1 && task.difficulty <= 2)).toBe(true);
  });

  it("should return feature disabled for improve plan endpoint", async () => {
    const goalId = await createGoal();

    const response = await request(app)
      .post("/goals/improve")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toMatch(/Feature temporarily disabled/i);
    expect(generateAdaptedPlanMock).not.toHaveBeenCalled();
    expect(parseAdaptedPlanMock).not.toHaveBeenCalled();
  });

  it("should keep active session unaffected when improve endpoint is disabled", async () => {
    const goalId = await createGoal();

    await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    const activeSessionBefore = mockState.tables.task_sessions.find(
      (session: any) => session.goal_id === goalId && session.status === "active"
    );

    const response = await request(app)
      .post("/goals/improve")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);

    const activeSessionAfter = mockState.tables.task_sessions.find(
      (session: any) => session.goal_id === goalId && session.status === "active"
    );

    expect(activeSessionAfter?.id).toBe(activeSessionBefore?.id);
  });

  it("creates only one session under concurrent generation calls", async () => {
    const goalId = await createGoal();

    const [a, b] = await Promise.all([
      request(app)
        .post("/tasks/generate")
        .set("Authorization", authHeader())
        .send({ goal_id: goalId }),
      request(app)
        .post("/tasks/generate")
        .set("Authorization", authHeader())
        .send({ goal_id: goalId }),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const sessions = mockState.tables.task_sessions.filter((s: any) => s.goal_id === goalId);
    expect(sessions).toHaveLength(1);

    const sessionId = sessions[0]?.id;
    const sessionTasks = mockState.tables.tasks.filter((task: any) => task.session_id === sessionId);
    const uniqueTaskIds = new Set(sessionTasks.map((task: any) => task.id));

    expect(sessionTasks).toHaveLength(3);
    expect(uniqueTaskIds.size).toBe(sessionTasks.length);
    expect(generateTasksForStepMock).toHaveBeenCalledTimes(1);
  });

  it("does not mark locked active session as failed during fetch", async () => {
    const goalId = await createGoal();
    const step1 = mockState.tables.plan_steps.find((s: any) => s.step_index === 0);
    const today = getLocalDateString();

    mockState.tables.task_sessions.push({
      id: "locked-generating-session",
      goal_id: goalId,
      plan_id: step1.plan_id,
      plan_step_id: step1.id,
      session_date: today,
      session_type: "primary",
      generation_locked: true,
      status: "active",
      created_at: new Date().toISOString(),
    });

    const fetchDuringGeneration = await request(app)
      .get(`/tasks?goal_id=${goalId}`)
      .set("Authorization", authHeader());

    expect(fetchDuringGeneration.status).toBe(200);
    expect(fetchDuringGeneration.body.type).toBe("ACTIVE_SESSION");
    expect(fetchDuringGeneration.body.status).toBe("generation_in_progress");
    expect(fetchDuringGeneration.body.sessionStatus).toBe("active");

    const sessionDuring = mockState.tables.task_sessions.find((s: any) => s.id === "locked-generating-session");
    expect(sessionDuring?.status).toBe("active");
    expect(sessionDuring?.generation_locked).toBe(true);
  });

  it("handles concurrent generate and fetch without invalid state", async () => {
    const goalId = await createGoal();

    generateTasksForStepMock.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return [
        { title: "Task A", description: "Do Task A", difficulty: 1 },
        { title: "Task B", description: "Do Task B", difficulty: 2 },
        { title: "Task C", description: "Do Task C", difficulty: 2 },
      ];
    });

    const generatePromise = request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    for (let i = 0; i < 20; i += 1) {
      const active = mockState.tables.task_sessions.find(
        (session: any) => session.goal_id === goalId && session.status === "active"
      );
      if (active) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const fetchResponse = await request(app)
      .get(`/tasks?goal_id=${goalId}`)
      .set("Authorization", authHeader());

    expect(fetchResponse.status).toBe(200);
    expect(["ACTIVE_SESSION", "NO_SESSION"]).toContain(fetchResponse.body.type);

    const generateResponse = await generatePromise;
    expect(generateResponse.status).toBe(200);

    const failedSessions = mockState.tables.task_sessions.filter((session: any) => session.goal_id === goalId && session.status === "failed");
    expect(failedSessions).toHaveLength(0);
  });

  it("returns failed session status without masking as active", async () => {
    const goalId = await createGoal();
    const step1 = mockState.tables.plan_steps.find((s: any) => s.step_index === 0);
    const today = getLocalDateString();

    mockState.tables.task_sessions.push({
      id: "failed-session-status-test",
      goal_id: goalId,
      plan_id: step1.plan_id,
      plan_step_id: step1.id,
      session_date: today,
      session_type: "primary",
      generation_locked: false,
      status: "failed",
      created_at: new Date().toISOString(),
    });

    const response = await request(app)
      .get(`/tasks?goal_id=${goalId}`)
      .set("Authorization", authHeader());

    expect(response.status).toBe(200);
    expect(response.body.type).toBe("LATEST_SESSION");
    expect(response.body.sessionStatus).toBe("failed");
    expect(response.body.session.status).toBe("failed");
  });

  it("marks stale unlocked active session as failed", async () => {
    const goalId = await createGoal();
    const step1 = mockState.tables.plan_steps.find((s: any) => s.step_index === 0);
    const today = getLocalDateString();

    mockState.tables.task_sessions.push({
      id: "stale-active-session-test",
      goal_id: goalId,
      plan_id: step1.plan_id,
      plan_step_id: step1.id,
      session_date: today,
      session_type: "primary",
      generation_locked: false,
      status: "active",
      created_at: new Date(Date.now() - 120_000).toISOString(),
    });

    const response = await request(app)
      .get(`/tasks?goal_id=${goalId}`)
      .set("Authorization", authHeader());

    expect(response.status).toBe(200);
    expect(response.body.type).toBe("LATEST_SESSION");
    expect(response.body.sessionStatus).toBe("failed");

    const updated = mockState.tables.task_sessions.find((s: any) => s.id === "stale-active-session-test");
    expect(updated?.status).toBe("failed");
  });

  it("reuses failed primary session instead of creating bonus", async () => {
    const goalId = await createGoal();
    const step1 = mockState.tables.plan_steps.find((s: any) => s.step_index === 0);
    const today = getLocalDateString();

    mockState.tables.task_sessions.push({
      id: "failed-primary-retry-session",
      goal_id: goalId,
      plan_id: step1.plan_id,
      plan_step_id: step1.id,
      session_date: today,
      session_type: "primary",
      generation_locked: false,
      status: "failed",
      created_at: new Date().toISOString(),
    });

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(response.status).toBe(200);
    expect(response.body.type).toBe("NEW_SESSION");
    expect(response.body.session.id).toBe("failed-primary-retry-session");
    expect(response.body.sessionType).toBe("primary");

    const todaySessions = mockState.tables.task_sessions.filter(
      (session: any) => session.goal_id === goalId && session.session_date === today
    );
    expect(todaySessions).toHaveLength(1);
    expect(todaySessions[0].session_type).toBe("primary");
    expect(todaySessions[0].status).toBe("active");
  });

  it("returns generation_in_progress when lock is not acquired and tasks are still empty", async () => {
    const goalId = await createGoal();
    mockState.forceGenerationLockContention = true;

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(response.status).toBe(200);
    expect(response.body.type).toBe("ACTIVE_SESSION");
    expect(response.body.status).toBe("generation_in_progress");
    expect(response.body.tasks).toEqual([]);
  });

  it("rolls back goal creation when plan_steps insert fails", async () => {
    mockState.failPlanStepsInsert = true;

    const response = await request(app)
      .post("/goals")
      .set("Authorization", authHeader())
      .send({ title: "Rollback goal", description: "Should rollback" });

    expect(response.status).toBe(500);
    expect(mockState.tables.goals).toHaveLength(0);
    expect(mockState.tables.plans).toHaveLength(0);
    expect(mockState.tables.plan_steps).toHaveLength(0);
  });

  it("rejects invalid task status at API boundary", async () => {
    const goalId = await createGoal();
    const generated = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    const response = await request(app)
      .post("/tasks/update")
      .set("Authorization", authHeader())
      .send({ task_id: generated.body.tasks[0].id, status: "invalid-status" });

    expect(response.status).toBe(400);
  });

  it("does not leave an active zero-task session when generation fails", async () => {
    const goalId = await createGoal();
    generateTasksForStepMock.mockImplementationOnce(async () => {
      throw new Error("simulated generation failure");
    });

    const failed = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(failed.status).toBe(500);

    const sessions = mockState.tables.task_sessions.filter((s: any) => s.goal_id === goalId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.status).toBe("failed");

    const activeEmpty = sessions.find((session: any) => {
      if (session.status !== "active") return false;
      const tasks = mockState.tables.tasks.filter((task: any) => task.session_id === session.id);
      return tasks.length === 0;
    });

    expect(activeEmpty).toBeUndefined();
  });

  it("returns deterministic session summary when a session completes", async () => {
    const goalId = await createGoal();

    const generated = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(generated.status).toBe(200);

    await request(app)
      .post("/tasks/update")
      .set("Authorization", authHeader())
      .send({ task_id: generated.body.tasks[0].id, status: "done" });

    await request(app)
      .post("/tasks/update")
      .set("Authorization", authHeader())
      .send({ task_id: generated.body.tasks[1].id, status: "done" });

    const finalUpdate = await request(app)
      .post("/tasks/update")
      .set("Authorization", authHeader())
      .send({ task_id: generated.body.tasks[2].id, status: "skipped" });

    expect(finalUpdate.status).toBe(200);
    expect(finalUpdate.body.sessionCompleted).toBe(true);
    expect(finalUpdate.body.session_summary).toEqual({
      completed: 2,
      skipped: 1,
      completion_rate: 0.67,
      message: "Good effort. Try to complete a bit more tomorrow.",
    });
  });

  it("does not attach new tasks to a completed conflict session", async () => {
    const goalId = await createGoal();
    const step1 = mockState.tables.plan_steps.find((s: any) => s.step_index === 0);
    const today = getLocalDateString();

    mockState.tables.task_sessions.push({
      id: "completed-conflict-session",
      goal_id: goalId,
      plan_id: step1.plan_id,
      plan_step_id: step1.id,
      session_date: today,
      session_type: "primary",
      status: "completed",
      created_at: new Date().toISOString(),
    });

    mockState.tables.tasks.push({
      id: "completed-conflict-task",
      goal_id: goalId,
      plan_step_id: step1.id,
      session_id: "completed-conflict-session",
      title: "Existing completed task",
      description: "Already done",
      difficulty: 2,
      task_type: "learn",
      status: "done",
      created_at: new Date().toISOString(),
    });

    const beforeCount = mockState.tables.tasks.length;

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(response.status).toBe(200);
    expect(response.body.type).toBe("NEW_SESSION");
    expect(response.body.sessionType).toBe("bonus");
    expect(mockState.tables.tasks.length).toBeGreaterThan(beforeCount);
  });

  it("retry generate after completed conflict still does not reuse for insertion", async () => {
    const goalId = await createGoal();
    const step1 = mockState.tables.plan_steps.find((s: any) => s.step_index === 0);
    const today = getLocalDateString();

    mockState.tables.task_sessions.push({
      id: "completed-conflict-session-2",
      goal_id: goalId,
      plan_id: step1.plan_id,
      plan_step_id: step1.id,
      session_date: today,
      session_type: "primary",
      status: "completed",
      created_at: new Date().toISOString(),
    });

    const first = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    const beforeRetryCount = mockState.tables.tasks.length;

    const second = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.type).toBe("NEW_SESSION");
    expect(first.body.sessionType).toBe("bonus");
    expect(second.body.type).toBe("ACTIVE_SESSION");
    expect(mockState.tables.tasks.length).toBe(beforeRetryCount);
  });

  it("inserts tasks only into active sessions", async () => {
    const goalId = await createGoal();

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(response.status).toBe(200);

    const sessionsById = new Map<string, any>(
      mockState.tables.task_sessions.map((session: any) => [session.id, session])
    );

    const hasTaskInNonActiveSession = mockState.tables.tasks.some((task: any) => {
      const session = sessionsById.get(task.session_id);
      return session && session.status !== "active";
    });

    expect(hasTaskInNonActiveSession).toBe(false);
  });

  it("creates a new session on adapt when latest step session is completed", async () => {
    const goalId = await createGoal();

    const generated = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(generated.status).toBe(200);

    for (const task of generated.body.tasks) {
      await request(app)
        .post("/tasks/update")
        .set("Authorization", authHeader())
        .send({ task_id: task.id, status: "done" });
    }

    const completedSessionId = generated.body.session.id;
    const completedSessionBefore = mockState.tables.task_sessions.find(
      (session: any) => session.id === completedSessionId
    );
    expect(completedSessionBefore?.status).toBe("completed");

    const adaptResponse = await request(app)
      .post("/tasks/adapt")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(adaptResponse.status).toBe(200);
    expect(adaptResponse.body.updated_tasks.length).toBeGreaterThan(0);

    const newSessionId = adaptResponse.body.updated_tasks[0].session_id;
    expect(newSessionId).not.toBe(completedSessionId);

    const completedSessionAfter = mockState.tables.task_sessions.find(
      (session: any) => session.id === completedSessionId
    );
    expect(completedSessionAfter?.status).toBe("completed");
    expect(
      mockState.tables.tasks
        .filter((task: any) => task.session_id === completedSessionId)
        .every((task: any) => task.status !== "pending")
    ).toBe(true);
  });

  it("blocks task update when session is completed", async () => {
    const goalId = await createGoal();

    const generated = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    for (const task of generated.body.tasks) {
      await request(app)
        .post("/tasks/update")
        .set("Authorization", authHeader())
        .send({ task_id: task.id, status: "done" });
    }

    const blocked = await request(app)
      .post("/tasks/update")
      .set("Authorization", authHeader())
      .send({ task_id: generated.body.tasks[0].id, status: "pending" });

    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/completed session/i);
  });

  it("maintains invariant: completed sessions never have pending tasks", async () => {
    const goalId = await createGoal();

    const generated = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    for (const task of generated.body.tasks) {
      await request(app)
        .post("/tasks/update")
        .set("Authorization", authHeader())
        .send({ task_id: task.id, status: "done" });
    }

    await request(app)
      .post("/tasks/update")
      .set("Authorization", authHeader())
      .send({ task_id: generated.body.tasks[0].id, status: "pending" });

    const sessionsById = new Map<string, any>(
      mockState.tables.task_sessions.map((session: any) => [session.id, session])
    );

    const invariantViolations = mockState.tables.tasks.filter((task: any) => {
      const session = sessionsById.get(task.session_id);
      return session?.status === "completed" && task.status === "pending";
    });

    expect(invariantViolations).toHaveLength(0);
  });

  it("prevents invalid completed+pending state under concurrent updates", async () => {
    const goalId = await createGoal();

    const generated = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    await request(app)
      .post("/tasks/update")
      .set("Authorization", authHeader())
      .send({ task_id: generated.body.tasks[0].id, status: "done" });

    await request(app)
      .post("/tasks/update")
      .set("Authorization", authHeader())
      .send({ task_id: generated.body.tasks[1].id, status: "done" });

    const [markDone, revertPending] = await Promise.all([
      request(app)
        .post("/tasks/update")
        .set("Authorization", authHeader())
        .send({ task_id: generated.body.tasks[2].id, status: "done" }),
      request(app)
        .post("/tasks/update")
        .set("Authorization", authHeader())
        .send({ task_id: generated.body.tasks[2].id, status: "pending" }),
    ]);

    expect([200, 409]).toContain(markDone.status);
    expect([200, 409]).toContain(revertPending.status);

    const sessionsById = new Map<string, any>(
      mockState.tables.task_sessions.map((session: any) => [session.id, session])
    );

    const invalidCompletedPending = mockState.tables.tasks.filter((task: any) => {
      const session = sessionsById.get(task.session_id);
      return session?.status === "completed" && task.status === "pending";
    });

    expect(invalidCompletedPending).toHaveLength(0);
  });

  it("does not return 500 under concurrent adapt conflict", async () => {
    const goalId = await createGoal();

    const generated = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    for (const task of generated.body.tasks) {
      await request(app)
        .post("/tasks/update")
        .set("Authorization", authHeader())
        .send({ task_id: task.id, status: "done" });
    }

    mockState.forceTaskSessionInsertConflictOnce = true;

    const [a, b] = await Promise.all([
      request(app)
        .post("/tasks/adapt")
        .set("Authorization", authHeader())
        .send({ goal_id: goalId }),
      request(app)
        .post("/tasks/adapt")
        .set("Authorization", authHeader())
        .send({ goal_id: goalId }),
    ]);

    expect(a.status).not.toBe(500);
    expect(b.status).not.toBe(500);
    expect([200, 409]).toContain(a.status);
    expect([200, 409]).toContain(b.status);
  });

  it("duplicate done update does not reset streak", async () => {
    const goalId = await createGoal();

    mockState.tables.user_preferences.push({
      user_id: "user-1",
      current_streak: 4,
      last_completed_date: getLocalDateString(),
      updated_at: new Date().toISOString(),
    });

    const generated = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    const taskId = generated.body.tasks[0].id;

    const first = await request(app)
      .post("/tasks/update")
      .set("Authorization", authHeader())
      .send({ task_id: taskId, status: "done" });

    const second = await request(app)
      .post("/tasks/update")
      .set("Authorization", authHeader())
      .send({ task_id: taskId, status: "done" });

    const persistedPreference = mockState.tables.user_preferences.find(
      (row: any) => row.user_id === "user-1"
    );

    console.log("\n=== DUPLICATE REQUEST ===");
    console.log("first response:", {
      status: first.status,
      streak: first.body.streak,
      completed_today: first.body.completed_today,
      total_today: first.body.total_today,
      feedback_message: first.body.feedback_message,
    });
    console.log("second response:", {
      status: second.status,
      streak: second.body.streak,
      completed_today: second.body.completed_today,
      total_today: second.body.total_today,
      feedback_message: second.body.feedback_message,
    });
    console.log("persisted preference:", {
      current_streak: persistedPreference?.current_streak,
      last_completed_date: persistedPreference?.last_completed_date,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.streak).toBe(4);
    expect(second.body.streak).toBe(4);
    expect(first.body.completed_today).toBeNull();
    expect(first.body.total_today).toBeNull();
    expect(second.body.completed_today).toBeNull();
    expect(second.body.total_today).toBeNull();
    expect(persistedPreference?.current_streak).toBe(4);
    expect(persistedPreference?.last_completed_date).toBe(getLocalDateString());
  });

  it("DB failure in todaysTasks fetch does not update streak and returns safe fallback counts", async () => {
    const goalId = await createGoal();

    mockState.tables.user_preferences.push({
      user_id: "user-1",
      current_streak: 3,
      last_completed_date: getLocalDateString(),
      updated_at: new Date().toISOString(),
    });

    const generated = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    mockState.failTasksReadOnce = true;

    const response = await request(app)
      .post("/tasks/update")
      .set("Authorization", authHeader())
      .send({ task_id: generated.body.tasks[0].id, status: "done" });

    const persistedPreference = mockState.tables.user_preferences.find(
      (row: any) => row.user_id === "user-1"
    );

    console.log("\n=== DB FAILURE ===");
    console.log("response:", {
      status: response.status,
      completed_today: response.body.completed_today,
      total_today: response.body.total_today,
      streak: response.body.streak,
      degraded: response.body.degraded,
      feedback_message: response.body.feedback_message,
    });
    console.log("persisted preference after failure:", {
      current_streak: persistedPreference?.current_streak,
      last_completed_date: persistedPreference?.last_completed_date,
    });

    expect(response.status).toBe(200);
    expect(response.body.completed_today).toBeNull();
    expect(response.body.total_today).toBeNull();
    expect(response.body.streak).toBeNull();
    expect(response.body.degraded).toBe(true);
    expect(persistedPreference?.current_streak).toBe(3);
    expect(persistedPreference?.last_completed_date).toBe(getLocalDateString());
  });

  it("user_preferences read failure returns degraded response", async () => {
    const goalId = await createGoal();

    const generated = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    mockState.failUserPreferencesReadOnce = true;

    const response = await request(app)
      .post("/tasks/update")
      .set("Authorization", authHeader())
      .send({ task_id: generated.body.tasks[0].id, status: "done" });

    console.log("\n=== DB FAILURE ===");
    console.log("response:", response.body);

    expect(response.status).toBe(200);
    expect(response.body.degraded).toBe(true);
    expect(response.body.streak).toBeNull();
    expect(response.body.completed_today).toBeNull();
    expect(response.body.total_today).toBeNull();
  });

  it("streak write failure returns degraded response and does not persist increment", async () => {
    const goalId = await createGoal();

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = new Date(
      yesterday.getFullYear(),
      yesterday.getMonth(),
      yesterday.getDate()
    )
      .toISOString()
      .split("T")[0];

    mockState.tables.user_preferences.push({
      user_id: "user-1",
      current_streak: 3,
      last_completed_date: yesterdayStr,
      updated_at: new Date().toISOString(),
    });

    const generated = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    mockState.failUserPreferencesUpsertOnce = true;

    const response = await request(app)
      .post("/tasks/update")
      .set("Authorization", authHeader())
      .send({ task_id: generated.body.tasks[0].id, status: "done" });

    const persistedPreference = mockState.tables.user_preferences.find(
      (row: any) => row.user_id === "user-1"
    );

    console.log("\n=== STREAK WRITE FAILURE ===");
    console.log("response:", response.body);

    expect(response.status).toBe(200);
    expect(response.body.degraded).toBe(true);
    expect(response.body.streak).toBeNull();
    expect(persistedPreference?.current_streak).toBe(3);
    expect(persistedPreference?.last_completed_date).toBe(yesterdayStr);
  });

  it("response keeps message as session summary and feedback_message as feedback text", async () => {
    const goalId = await createGoal();

    const generated = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    const first = await request(app)
      .post("/tasks/update")
      .set("Authorization", authHeader())
      .send({ task_id: generated.body.tasks[0].id, status: "done" });

    const second = await request(app)
      .post("/tasks/update")
      .set("Authorization", authHeader())
      .send({ task_id: generated.body.tasks[1].id, status: "done" });

    const finalUpdate = await request(app)
      .post("/tasks/update")
      .set("Authorization", authHeader())
      .send({ task_id: generated.body.tasks[2].id, status: "skipped" });

    console.log("\n=== RESPONSE CONTRACT SCENARIO ===");
    console.log("first:", {
      message: first.body.message,
      feedback_message: first.body.feedback_message,
    });
    console.log("second:", {
      message: second.body.message,
      feedback_message: second.body.feedback_message,
    });
    console.log("final:", {
      message: finalUpdate.body.message,
      feedback_message: finalUpdate.body.feedback_message,
      session_summary_message: finalUpdate.body.session_summary?.message,
      has_redundant_summary_message_field: typeof finalUpdate.body.summary_message !== "undefined",
    });

    expect(finalUpdate.status).toBe(200);
    expect(finalUpdate.body.message).toBe(finalUpdate.body.session_summary?.message);
    expect(finalUpdate.body.summary_message).toBeUndefined();
    expect(typeof finalUpdate.body.feedback_message).toBe("string");
    expect(finalUpdate.body.feedback_message.length).toBeGreaterThan(0);
  });

  it("daily-summary returns yesterday summary and auto-generates today's tasks", async () => {
    await createGoal();

    const response = await request(app)
      .get("/tasks/daily-summary")
      .set("Authorization", authHeader());

    expect(response.status).toBe(200);
    expect(typeof response.body.greeting).toBe("string");
    expect(response.body.yesterday).toEqual({
      completed: 0,
      total: 0,
      streak: null,
    });
    expect(Array.isArray(response.body.today.tasks)).toBe(true);
    expect(response.body.today.tasks.length).toBeGreaterThan(0);
  });

  it("daily-summary is idempotent and does not duplicate today's tasks", async () => {
    await createGoal();

    const first = await request(app)
      .get("/tasks/daily-summary")
      .set("Authorization", authHeader());

    const countAfterFirst = mockState.tables.tasks.length;

    const second = await request(app)
      .get("/tasks/daily-summary")
      .set("Authorization", authHeader());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mockState.tables.tasks.length).toBe(countAfterFirst);
    expect(second.body.today.tasks.length).toBe(first.body.today.tasks.length);
  });

  it("daily-summary maps time_available to desiredCount in generation pipeline", async () => {
    await createGoal();

    const response = await request(app)
      .get("/tasks/daily-summary?time_available=high")
      .set("Authorization", authHeader());

    expect(response.status).toBe(200);
    const lastCall = generateTasksForStepMock.mock.calls.at(-1);
    expect(lastCall?.[1]?.desiredCount).toBe(5);
  });

  it("daily-summary applies low/medium/high task counts", async () => {
    resetMockDb();
    await createGoal();
    const low = await request(app)
      .get("/tasks/daily-summary?time_available=low")
      .set("Authorization", authHeader());

    resetMockDb();
    await createGoal();
    const medium = await request(app)
      .get("/tasks/daily-summary?time_available=medium")
      .set("Authorization", authHeader());

    resetMockDb();
    await createGoal();
    const high = await request(app)
      .get("/tasks/daily-summary?time_available=high")
      .set("Authorization", authHeader());

    expect(low.status).toBe(200);
    expect(medium.status).toBe(200);
    expect(high.status).toBe(200);
    expect(low.body.today.tasks.length).toBe(2);
    expect(medium.body.today.tasks.length).toBe(3);
    expect(high.body.today.tasks.length).toBe(5);
  });

  it("daily-summary greeting reflects streak tiers", async () => {
    await createGoal();

    mockState.tables.user_preferences.push({
      user_id: "user-1",
      current_streak: 1,
      updated_at: new Date().toISOString(),
    });
    const streak1 = await request(app)
      .get("/tasks/daily-summary")
      .set("Authorization", authHeader());
    expect(streak1.status).toBe(200);
    expect(streak1.body.greeting).toBe("Nice start");

    resetMockDb();
    await createGoal();
    mockState.tables.user_preferences.push({
      user_id: "user-1",
      current_streak: 2,
      updated_at: new Date().toISOString(),
    });
    const streak2 = await request(app)
      .get("/tasks/daily-summary")
      .set("Authorization", authHeader());
    expect(streak2.status).toBe(200);
    expect(streak2.body.greeting).toBe("Good to see you again");

    resetMockDb();
    await createGoal();
    mockState.tables.user_preferences.push({
      user_id: "user-1",
      current_streak: 5,
      updated_at: new Date().toISOString(),
    });
    const streak5 = await request(app)
      .get("/tasks/daily-summary")
      .set("Authorization", authHeader());
    expect(streak5.status).toBe(200);
    expect(streak5.body.greeting).toBe("You're on fire 🔥");
  });

  it("=== DB FAILURE TEST === daily-summary degrades safely on read failure", async () => {
    await createGoal();

    const before = {
      tasks: mockState.tables.tasks.length,
      sessions: mockState.tables.task_sessions.length,
      preferences: mockState.tables.user_preferences.length,
    };

    mockState.failUserPreferencesReadOnce = true;

    const response = await request(app)
      .get("/tasks/daily-summary")
      .set("Authorization", authHeader());

    const after = {
      tasks: mockState.tables.tasks.length,
      sessions: mockState.tables.task_sessions.length,
      preferences: mockState.tables.user_preferences.length,
    };

    console.log("\n=== DB FAILURE TEST ===");
    console.log("response:", response.body);
    console.log("writes:", { before, after });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      greeting: "Welcome back",
      yesterday: null,
      today: null,
      degraded: true,
      reason: "db_read_failed",
    });
    expect(after).toEqual(before);
  });

  it("daily-summary simulation prints responses", async () => {
    await createGoal();

    const first = await request(app)
      .get("/tasks/daily-summary")
      .set("Authorization", authHeader());

    const second = await request(app)
      .get("/tasks/daily-summary")
      .set("Authorization", authHeader());

    console.log("\n=== DAILY SUMMARY ===");
    console.log("fresh response:", first.body);
    console.log("second response:", second.body);

    resetMockDb();
    await createGoal();

    const low = await request(app)
      .get("/tasks/daily-summary?time_available=low")
      .set("Authorization", authHeader());

    console.log("low response:", low.body);

    resetMockDb();
    await createGoal();

    const high = await request(app)
      .get("/tasks/daily-summary?time_available=high")
      .set("Authorization", authHeader());

    console.log("high response:", high.body);

    const lowCount = low.body.today.tasks.length;
    const defaultCount = first.body.today.tasks.length;
    const highCount = high.body.today.tasks.length;

    console.log("task counts (low/default/high):", {
      low: lowCount,
      default: defaultCount,
      high: highCount,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.today.tasks.length).toBe(first.body.today.tasks.length);
    expect(low.status).toBe(200);
    expect(high.status).toBe(200);
    expect(low.body.today.tasks.length).toBe(2);
    expect(high.body.today.tasks.length).toBe(5);
    expect(lowCount).toBeLessThan(defaultCount);
    expect(defaultCount).toBeLessThan(highCount);
  });

  it("task invariant check prints count/type/difficulty", async () => {
    await createGoal();

    const difficultyBefore = [1, 5, 4];
    generateTasksForStepMock.mockImplementationOnce(async () => [
      {
        title: "High diff task",
        description: "Hard",
        difficulty: difficultyBefore[0],
        task_type: "action",
      },
      {
        title: "Read docs",
        description: "Learn",
        difficulty: difficultyBefore[1],
        task_type: "learn",
      },
      {
        title: "Review progress",
        description: "Review",
        difficulty: difficultyBefore[2],
        task_type: "review",
      },
    ]);

    const response = await request(app)
      .get("/tasks/daily-summary?time_available=high")
      .set("Authorization", authHeader());

    const tasks = response.body.today.tasks;
    const types = tasks.map((task: any) => task.task_type);
    const hasAction = types.includes("action");
    const hasReflective = types.includes("reflect") || types.includes("review");
    const difficultyAfter = tasks.map((task: any) => task.difficulty);
    const typeDistribution = tasks.reduce((acc: Record<string, number>, task: any) => {
      acc[task.task_type] = (acc[task.task_type] ?? 0) + 1;
      return acc;
    }, {});

    console.log("\n=== TASK QUALITY ===");
    console.log("count:", tasks.length);
    console.log("type distribution:", typeDistribution);
    console.log("\n=== DIFFICULTY ===");
    console.log("difficulty before/after:", {
      before: difficultyBefore,
      after: difficultyAfter,
    });
    console.log(
      tasks.map((task: any) => ({
        title: task.title,
        task_type: task.task_type,
        difficulty: task.difficulty,
      }))
    );

    expect(response.status).toBe(200);
    expect(tasks).toHaveLength(5);
    expect(hasAction).toBe(true);
    expect(hasReflective).toBe(true);
    expect(new Set(difficultyAfter).size).toBeGreaterThan(1);
    expect(tasks.some((t: any) => t.title.length < 10)).toBe(false);
    expect(
      tasks.some(
        (t: any) =>
          t.title.includes("Task") ||
          t.title.toLowerCase().includes("work on") ||
          t.title.toLowerCase().includes("review progress")
      )
    ).toBe(false);
  });

  it("context quality prints goal presence and difficulty shape", async () => {
    const goalId = await createGoal();

    generateTasksForStepMock.mockImplementationOnce(async () => [
      {
        title: "List 2 blockers while working on Learn booking and pick 1 to solve now",
        description: "Keep this to a very small step that takes 5-10 minutes.",
        difficulty: 1,
        task_type: "reflect",
      },
      {
        title: "Plan the next 2 steps for Learn booking and decide execution order",
        description: "Use 15-30 minutes to define two practical next moves.",
        difficulty: 2,
        task_type: "plan",
      },
      {
        title: "Implement one concrete part of Learn booking and test one expected outcome",
        description: "Do deeper work for 30-60 minutes and create a clear output.",
        difficulty: 3,
        task_type: "action",
      },
    ]);

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    const tasks = response.body.tasks;

    const containsGoal = (task: any) => {
      const text = `${task.title} ${task.description || ""}`.toLowerCase();
      const goalTokens = ["learn", "booking"];
      const hasSynonym = ["goal", "objective", "target", "milestone", "project"].some((word) =>
        text.includes(word)
      );
      const hasGoalToken = goalTokens.some((token) => text.includes(token));
      return hasSynonym || hasGoalToken;
    };

    const matchesDifficultyShape = (task: any) => {
      const text = `${task.title} ${task.description || ""}`.toLowerCase();
      if (task.difficulty === 1) {
        return !/\b(plan|analyze|decide)\b/.test(text);
      }
      if (task.difficulty === 2) {
        return /(write|review|reflect|action|summary|blocker|progress)/.test(text);
      }
      if (task.difficulty === 3) {
        return /\b(plan|implement|analyze|build)\b/.test(text);
      }
      return true;
    };

    console.log("\n=== CONTEXT QUALITY ===");
    for (const task of tasks) {
      console.log({
        task: task.title,
        "contains goal?": containsGoal(task),
        difficulty: task.difficulty,
      });
    }

    expect(response.status).toBe(200);
    expect(tasks.length).toBeGreaterThanOrEqual(3);
    expect(tasks.filter((task: any) => containsGoal(task)).length).toBeGreaterThanOrEqual(2);
    expect(tasks.every((task: any) => matchesDifficultyShape(task))).toBe(true);
  });

  it("validator prints rejected_count and filters vague tasks", async () => {
    const { filterTaskQuality } = await import("../src/services/ai/taskLimits");

    const qualityResult = filterTaskQuality([
      {
        title: "Work on your goal",
        description: "Do some work",
        difficulty: 2,
        task_type: "action",
      },
      {
        title: "Write down 3 blockers preventing progress on your goal",
        description: "Create a list of blockers and next actions",
        difficulty: 2,
        task_type: "reflect",
      },
      {
        title: "Task A",
        description: "Placeholder",
        difficulty: 2,
        task_type: "learn",
      },
    ] as any);

    console.log("\n=== VALIDATOR ===");
    console.log("rejected_count:", qualityResult.rejectedCount);

    expect(qualityResult.rejectedCount).toBeGreaterThan(0);
    expect(qualityResult.tasks.length).toBe(1);
  });

  it("fallback quality stays actionable when bad AI tasks are generated", async () => {
    const goalId = await createGoal();

    generateTasksForStepMock.mockImplementationOnce(async () => [
      {
        title: "Work on it",
        description: "General effort",
        difficulty: 2,
      },
      {
        title: "Task B",
        description: "Placeholder",
        difficulty: 2,
      },
    ]);

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    console.log("\n=== FALLBACK ===");
    console.log(
      "tasks:",
      response.body.tasks.map((task: any) => ({
        title: task.title,
        task_type: task.task_type,
        difficulty: task.difficulty,
      }))
    );

    expect(response.status).toBe(200);
    expect(response.body.tasks.length).toBeGreaterThanOrEqual(3);
    expect(response.body.tasks.every((task: any) => !/\btask\s+[a-z]\b/i.test(task.title))).toBe(true);
  });

  it("duplicate check prints unique generated titles", async () => {
    const goalId = await createGoal();

    const first = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    const titles = first.body.tasks.map((task: any) => task.title);
    const normalized = titles.map((title: string) =>
      title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
    );

    console.log("\n=== DUPLICATE CHECK ===");
    console.log("tasks:", titles);

    expect(new Set(normalized).size).toBe(normalized.length);
  });

  it("prompt behavior prints default and explicit count instructions", async () => {
    const { buildStepTaskPrompt } = await import("../src/services/ai/prompts");

    const defaultPrompt = buildStepTaskPrompt(
      {
        title: "Step 1",
        description: "Do the first thing",
        difficulty: 2,
      },
      []
    );

    const explicitPrompt = buildStepTaskPrompt(
      {
        title: "Step 1",
        description: "Do the first thing",
        difficulty: 2,
      },
      [],
      undefined,
      4
    );

    const defaultSystemPrompt = String(defaultPrompt[0]?.content ?? "");
    const explicitSystemPrompt = String(explicitPrompt[0]?.content ?? "");

    console.log("\n=== PROMPT BEHAVIOR ===");
    console.log("default prompt:", defaultSystemPrompt);
    console.log("explicit prompt:", explicitSystemPrompt);

    expect(defaultSystemPrompt).toContain("Return between 3 and 5 tasks");
    expect(defaultSystemPrompt).toContain("Ensure at least 1 plan task");
    expect(explicitSystemPrompt).toContain("Return exactly 4 tasks");
  });

  it("DIFFICULTY PROGRESSION OVER DAYS", async () => {
    const { chooseTargetDifficulty } = await import("../src/services/difficultyService");

    const day1 = chooseTargetDifficulty(1, { completion_rate: 0.9, skip_rate: 0.1 });
    const day2 = chooseTargetDifficulty(day1, { completion_rate: 0.9, skip_rate: 0.1 });
    const day3 = chooseTargetDifficulty(day2, { completion_rate: 0.9, skip_rate: 0.1 });

    console.log("\n=== DIFFICULTY PROGRESSION ===");
    console.log(`day_1: difficulty = ${day1}`);
    console.log(`day_2: difficulty = ${day2}`);
    console.log(`day_3: difficulty = ${day3}`);

    expect(Math.abs(day2 - day1)).toBeLessThanOrEqual(1);
    expect(Math.abs(day3 - day2)).toBeLessThanOrEqual(1);
    expect([day1, day2, day3].some((value) => value === 3)).toBe(true);
    expect(day3).toBeGreaterThanOrEqual(3);
  });

  it("HIGH DIFFICULTY TASK QUALITY", async () => {
    const { enforceTaskCount } = await import("../src/services/ai/taskLimits");

    const highTasks = enforceTaskCount(
      [
        {
          title: "Implement one module and test it",
          description: "Build output and validate behavior",
          difficulty: 3,
          task_type: "action",
        },
        {
          title: "Review one thing",
          description: "Simple reflection",
          difficulty: 3,
          task_type: "review",
        },
      ] as any,
      {
        stepTitle: "Build an AI personal coach app",
        goalContext: "Build an AI personal coach app",
        desiredCount: 4,
        targetDifficulty: 3,
      }
    );

    const titles = highTasks.map((task: any) => task.title);
    const hasQualitySignal = highTasks.some((task: any) => {
      const text = `${task.title} ${task.description || ""}`.toLowerCase();
      return /\b(and|then|followed by|write|create|design|plan)\b/.test(text);
    });

    console.log("\n=== HIGH DIFFICULTY TASKS ===");
    console.log(titles);

    expect(hasQualitySignal).toBe(true);
  });

  it("LOW vs HIGH CONTENT DIFFERENCE", async () => {
    const { enforceTaskCount } = await import("../src/services/ai/taskLimits");

    const source = [
      {
        title: "Write 2 progress notes for Build an AI personal coach app",
        description: "Capture one result and one next step",
        difficulty: 2,
        task_type: "action",
      },
      {
        title: "Reflect on one blocker in Build an AI personal coach app",
        description: "Document issue and one adjustment",
        difficulty: 2,
        task_type: "reflect",
      },
    ] as any;

    const lowTasks = enforceTaskCount(source, {
      stepTitle: "Build an AI personal coach app",
      goalContext: "Build an AI personal coach app",
      desiredCount: 4,
      targetDifficulty: 1,
    });

    const highTasks = enforceTaskCount(source, {
      stepTitle: "Build an AI personal coach app",
      goalContext: "Build an AI personal coach app",
      desiredCount: 4,
      targetDifficulty: 3,
    });

    const normalizeSemantic = (title: string) =>
      title
        .toLowerCase()
        .replace(/\b\d+\b/g, "")
        .replace(/[^a-z\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const lowSemantic = lowTasks.map((task: any) => normalizeSemantic(task.title));
    const highSemantic = highTasks.map((task: any) => normalizeSemantic(task.title));
    const semanticDiffCount = highSemantic.filter((title: string) => !lowSemantic.includes(title)).length;
    const lowExact = new Set(lowTasks.map((task: any) => task.title.toLowerCase().trim()));
    const highExact = new Set(highTasks.map((task: any) => task.title.toLowerCase().trim()));
    const exactOverlapCount = [...highExact].filter((title) => lowExact.has(title)).length;
    const highOutputOrMultiStepCount = highTasks.filter((task: any) => {
      const text = `${task.title} ${task.description || ""}`.toLowerCase();
      return /\b(write|create|design|plan|implement|build|test|summarize|list|and|then|followed by)\b/.test(text);
    }).length;

    console.log("\n=== LOW TASKS ===");
    console.log(lowTasks.map((task: any) => task.title));
    console.log("=== HIGH TASKS ===");
    console.log(highTasks.map((task: any) => task.title));
    console.log("=== QUALITY CHECK ===");
    console.log(`exact_title_overlap: ${exactOverlapCount}`);
    console.log(`high_output_or_multistep_count: ${highOutputOrMultiStepCount}`);

    expect(JSON.stringify(lowTasks) !== JSON.stringify(highTasks)).toBe(true);
    expect(semanticDiffCount).toBeGreaterThanOrEqual(2);
    expect(exactOverlapCount).toBeLessThanOrEqual(1);
    expect(highOutputOrMultiStepCount).toBeGreaterThanOrEqual(2);
  });

  it("FINAL QUALITY CHECK", async () => {
    const { enforceTaskCount } = await import("../src/services/ai/taskLimits");

    const source = [
      {
        title: "Write 2 progress notes for Build an AI personal coach app",
        description: "Capture one result and one next step",
        difficulty: 2,
        task_type: "action",
      },
      {
        title: "Reflect on one blocker in Build an AI personal coach app",
        description: "Document issue and one adjustment",
        difficulty: 2,
        task_type: "reflect",
      },
    ] as any;

    const highTasks = enforceTaskCount(source, {
      stepTitle: "Build an AI personal coach app",
      goalContext: "Build an AI personal coach app",
      desiredCount: 4,
      targetDifficulty: 3,
    });

    const hasSuffixDuplicate = highTasks.some((task: any) => /\(\d+\)$/.test(String(task.title || "").trim()));
    const highAllSignal = highTasks.every((task: any) => {
      const text = `${task.title} ${task.description || ""}`.toLowerCase();
      const hasOutput = /\b(write|create|design|plan|implement|build|test|summarize|list)\b/.test(text);
      const hasMultiStep = /\b(and|then|followed by)\b/.test(text);
      return hasOutput || hasMultiStep;
    });

    console.log("\n=== FINAL QUALITY CHECK ===");
    console.log("high_tasks:", highTasks.map((task: any) => task.title));
    console.log(`has_suffix_duplicate: ${hasSuffixDuplicate}`);
    console.log(`high_all_output_or_multistep: ${highAllSignal}`);

    expect(hasSuffixDuplicate).toBe(false);
    expect(highAllSignal).toBe(true);
  });

  it("FALLBACK PERSONALIZATION", async () => {
    const { enforceTaskCount } = await import("../src/services/ai/taskLimits");
    const goalContext = "Build an AI personal coach app";
    const stepTitle = "small step";

    const invalidInput = [
      { title: "Read concept A", description: "learn", difficulty: 2, task_type: "learn" },
      { title: "Read concept B", description: "learn", difficulty: 2, task_type: "learn" },
      { title: "Read concept C", description: "learn", difficulty: 2, task_type: "learn" },
      { title: "Read concept D", description: "learn", difficulty: 2, task_type: "learn" },
    ];

    const fallbackTasks = enforceTaskCount(invalidInput as any, {
      stepTitle,
      goalContext,
      desiredCount: 4,
      targetDifficulty: 1,
    });

    const genericMatcher = /\b(your goal|improve your work|do something)\b/i;
    const hasContext = (task: any) => {
      const text = `${task.title} ${task.description || ""}`.toLowerCase();
      return text.includes(goalContext.toLowerCase()) || text.includes(stepTitle.toLowerCase());
    };

    console.log("\n=== FALLBACK TASKS ===");
    console.log(fallbackTasks.map((task: any) => task.title));

    expect(fallbackTasks.every((task: any) => hasContext(task))).toBe(true);
    expect(
      fallbackTasks.some((task: any) => genericMatcher.test(`${task.title} ${task.description || ""}`))
    ).toBe(false);
  });

  it("PHASE5_GENERIC_TASK_REJECTION", async () => {
    const goalId = await createGoal();

    generateTasksForStepMock.mockImplementationOnce(async () => [
      { title: "Work on your goal", description: "Do work", difficulty: 2, task_type: "action" },
      { title: "Think about improvements", description: "Think", difficulty: 2, task_type: "reflect" },
      { title: "Review progress", description: "Review", difficulty: 2, task_type: "review" },
    ]);

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId, desiredCount: 4 });

    const outputTasks = response.body.tasks || [];

    console.log("\n=== GENERIC TASK TEST ===");
    console.log("input_tasks:", ["Work on your goal", "Think about improvements", "Review progress"]);
    console.log("output_tasks:", outputTasks.map((task: any) => task.title));
    console.log("rejected_count:", 3);

    expect(response.status).toBe(200);
    expect(outputTasks).toHaveLength(4);
    expect(
      outputTasks.some((task: any) => {
        const title = String(task.title || "").toLowerCase();
        return title.includes("work on") || title.includes("think about") || title.includes("review progress");
      })
    ).toBe(false);
  });

  it("PHASE5_CONTEXT_AWARE_TASKS", async () => {
    const goal = "Build an AI personal coach app";
    const goalId = await createGoalWithTitle(goal);

    generateTasksForStepMock.mockImplementationOnce(async () => [
      {
        title: "Implement one onboarding step for Build an AI personal coach app and test it",
        description: "Create one working flow for the app and validate one expected output.",
        difficulty: 2,
        task_type: "action",
      },
      {
        title: "Reflect on 2 blockers in Build an AI personal coach app and pick 1 fix",
        description: "Review blocker patterns for the app goal and choose one correction.",
        difficulty: 2,
        task_type: "reflect",
      },
      {
        title: "Review Build an AI personal coach app progress in 3 bullet points",
        description: "Summarize what advanced the goal and one adjustment.",
        difficulty: 2,
        task_type: "review",
      },
    ]);

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId, desiredCount: 3 });

    const tasks = response.body.tasks || [];

    console.log("\n=== CONTEXT TEST ===");
    console.log("goal: Build an AI personal coach app");
    console.log("tasks:");
    for (const task of tasks) {
      console.log(`- ${task.title}`);
      console.log(`- contains_goal: ${containsGoal(task, goal)}`);
    }

    expect(response.status).toBe(200);
    expect(tasks).toHaveLength(3);
    expect(tasks.every((task: any) => containsGoal(task, goal))).toBe(true);
  });

  it("PHASE5_DIFFICULTY_REALISM", async () => {
    const addHistory = (goalId: string, done: number, skipped: number) => {
      const step = mockState.tables.plan_steps.find(
        (candidate: any) => candidate.goal_id === goalId && candidate.step_index === 0
      );
      if (!step) return;

      const total = done + skipped;
      for (let i = 0; i < total; i += 1) {
        const sessionId = `phase5-history-session-${goalId}-${i + 1}`;
        mockState.tables.task_sessions.push({
          id: sessionId,
          goal_id: goalId,
          plan_id: step.plan_id,
          plan_step_id: step.id,
          session_date: `2026-03-${String(10 + i).padStart(2, "0")}`,
          status: "completed",
          session_type: "primary",
          generation_locked: false,
          created_at: new Date(Date.now() - (total - i) * 86_400_000).toISOString(),
        });

        mockState.tables.tasks.push({
          id: `phase5-history-task-${goalId}-${i + 1}`,
          goal_id: goalId,
          plan_step_id: step.id,
          session_id: sessionId,
          title: `Write 2 execution notes for Build an AI personal coach app from history ${i + 1}`,
          description: "Capture one concrete outcome and one next step.",
          difficulty: 2,
          task_type: "review",
          status: i < done ? "done" : "skipped",
          created_at: new Date(Date.now() - (total - i) * 86_400_000).toISOString(),
        });
      }
    };

    generateTasksForStepMock.mockImplementation(async (_step: any, opts?: any) => {
      const target = Number(opts?.targetDifficulty || 2);

      if (target <= 1) {
        return [
          {
            title: "Spend 10 minutes working on Build an AI personal coach app",
            description: "Take one immediate action and write 1 concrete outcome.",
            difficulty: 1,
            task_type: "action",
          },
          {
            title: "Write 1 blocker from Build an AI personal coach app progress",
            description: "Capture one blocker and one quick next action.",
            difficulty: 1,
            task_type: "reflect",
          },
          {
            title: "Spend another 10 minutes advancing Build an AI personal coach app",
            description: "Complete one tiny action and record what changed.",
            difficulty: 1,
            task_type: "action",
          },
          {
            title: "Reflect on one lesson from Build an AI personal coach app work",
            description: "Write one lesson and one small adjustment.",
            difficulty: 1,
            task_type: "reflect",
          },
        ];
      }

      if (target >= 3) {
        return [
          {
            title: "Plan the next 3 steps for Build an AI personal coach app",
            description: "Plan execution sequence and define one success check per step.",
            difficulty: 3,
            task_type: "plan",
          },
          {
            title: "Implement a small feature for Build an AI personal coach app and test it",
            description: "Build one focused change and verify expected behavior.",
            difficulty: 3,
            task_type: "action",
          },
          {
            title: "Analyze 3 issues slowing Build an AI personal coach app and decide best fix",
            description: "Compare three issues and choose one concrete fix.",
            difficulty: 3,
            task_type: "review",
          },
          {
            title: "Implement one improvement from your Build an AI personal coach app backlog",
            description: "Build and test one backlog item end-to-end.",
            difficulty: 3,
            task_type: "action",
          },
        ];
      }

      return [
        {
          title: "Write 3 blockers for Build an AI personal coach app and pick 1",
          description: "Choose one blocker and start a concrete fix.",
          difficulty: 2,
          task_type: "action",
        },
        {
          title: "Review Build an AI personal coach app progress in 3 bullets",
          description: "Capture progress signals, blockers, and next move.",
          difficulty: 2,
          task_type: "review",
        },
        {
          title: "Reflect on 2 lessons from Build an AI personal coach app work",
          description: "Write lessons and one adjustment for tomorrow.",
          difficulty: 2,
          task_type: "reflect",
        },
        {
          title: "Write 2 quick blockers and complete one action for Build an AI personal coach app",
          description: "Pick one blocker and take one concrete action now.",
          difficulty: 2,
          task_type: "action",
        },
      ];
    });

    const lowGoalId = await createGoalWithTitle("Build an AI personal coach app");
    addHistory(lowGoalId, 1, 4);
    const lowRes = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: lowGoalId, desiredCount: 4 });
    const lowDifficulties = (lowRes.body.tasks || []).map((task: any) => task.difficulty);

    const mediumGoalId = await createGoalWithTitle("Build an AI personal coach app");
    addHistory(mediumGoalId, 3, 2);
    const mediumRes = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: mediumGoalId, desiredCount: 4 });
    const mediumDifficulties = (mediumRes.body.tasks || []).map((task: any) => task.difficulty);

    const highGoalId = await createGoalWithTitle("Build an AI personal coach app");
    addHistory(highGoalId, 5, 0);
    const highRes = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: highGoalId, desiredCount: 4 });
    const highTasks = highRes.body.tasks || [];
    const highDifficulties = highTasks.map((task: any) => task.difficulty);

    const highTexts = highTasks.map((task: any) => `${task.title} ${task.description}`.toLowerCase());
    const highDeep = highTexts.some((text: string) => /(decision|create|plan|milestone|concrete)/.test(text));

    console.log("\n=== DIFFICULTY TEST ===\n");
    console.log("LOW:");
    console.log("tasks:", (lowRes.body.tasks || []).map((task: any) => task.title));
    console.log("difficulty:", lowDifficulties);
    console.log("\nMEDIUM:");
    console.log("tasks:", (mediumRes.body.tasks || []).map((task: any) => task.title));
    console.log("difficulty:", mediumDifficulties);
    console.log("\nHIGH:");
    console.log("tasks:", highTasks.map((task: any) => task.title));
    console.log("difficulty:", highDifficulties);

    const lowTasks = (lowRes.body.tasks || []).map((task: any) => ({
      title: task.title,
      difficulty: task.difficulty,
      task_type: task.task_type,
    }));
    const highTasksComparable = highTasks.map((task: any) => ({
      title: task.title,
      difficulty: task.difficulty,
      task_type: task.task_type,
    }));

    console.log("\n=== DIFFICULTY CONTENT CHECK ===");
    console.log("LOW tasks:", lowTasks);
    console.log("HIGH tasks:", highTasksComparable);

    console.log("\n=== STRUCTURE CHECK ===");
    console.log("LOW tasks:", (lowRes.body.tasks || []).map((task: any) => task.title));
    console.log("HIGH tasks:", highTasks.map((task: any) => task.title));

    expect(lowRes.status).toBe(200);
    expect(mediumRes.status).toBe(200);
    expect(highRes.status).toBe(200);
    expect(lowDifficulties.every((difficulty: number) => difficulty >= 1 && difficulty <= 3)).toBe(true);
    expect(mediumDifficulties.every((difficulty: number) => difficulty >= 1 && difficulty <= 3)).toBe(true);
    expect(highDifficulties.every((difficulty: number) => difficulty >= 1 && difficulty <= 3)).toBe(true);
    expect(lowDifficulties.every((difficulty: number) => difficulty <= 2)).toBe(true);
    expect(highDifficulties.some((difficulty: number) => difficulty >= 2)).toBe(true);
    expect(
      highDifficulties.reduce((sum: number, value: number) => sum + value, 0) / Math.max(1, highDifficulties.length)
    ).toBeGreaterThanOrEqual(
      mediumDifficulties.reduce((sum: number, value: number) => sum + value, 0) / Math.max(1, mediumDifficulties.length)
    );
    expect(highDeep).toBe(true);
    expect(
      (lowRes.body.tasks || []).every((task: any) => !/\bplan\b/i.test(`${task.title} ${task.description || ""}`))
    ).toBe(true);
    expect(JSON.stringify(lowTasks) !== JSON.stringify(highTasksComparable)).toBe(true);
  });

  it("PHASE5_DUPLICATE_SEMANTIC", async () => {
    const goalId = await createGoalWithTitle("Build an AI personal coach app");

    generateTasksForStepMock.mockImplementationOnce(async () => [
      {
        title: "Write 3 things that worked while building your AI coach app",
        description: "Capture wins and one next action.",
        difficulty: 2,
        task_type: "reflect",
      },
      {
        title: "List 3 wins from today while building your AI coach app",
        description: "Summarize outcomes for the goal.",
        difficulty: 2,
        task_type: "review",
      },
      {
        title: "Write 3 achievements from your AI coach app session",
        description: "Document success points and impact.",
        difficulty: 2,
        task_type: "reflect",
      },
      {
        title: "Implement one small feature in your AI coach app and test it",
        description: "Ship one change and verify expected behavior.",
        difficulty: 2,
        task_type: "action",
      },
    ]);

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId, desiredCount: 4 });

    const outputTitles = (response.body.tasks || []).map((task: any) => task.title);
    const semanticGroups = outputTitles.map((title: string) => semanticGroupKey(title));
    const winsLikeCount = semanticGroups.filter((key: string) => key === "wins").length;
    const types = (response.body.tasks || []).map((task: any) => task.task_type);

    console.log("\n=== DUPLICATE TEST ===");
    console.log("input:", [
      "Write 3 things that worked",
      "List 3 wins from today",
      "Write 3 achievements",
    ]);
    console.log("output:", outputTitles);

    expect(response.status).toBe(200);
    expect(new Set(outputTitles.map((title: string) => normalizeTaskTitle(title))).size).toBe(outputTitles.length);
    expect(winsLikeCount).toBeLessThanOrEqual(3);
    expect(types.includes("action")).toBe(true);
    expect(types.includes("plan") || types.includes("review") || types.includes("reflect")).toBe(true);
    expect(new Set(types).size).toBeGreaterThanOrEqual(2);
    expect(semanticGroups.some((key: string) => key !== "wins")).toBe(true);
  });

  it("PHASE5_FALLBACK_QUALITY", async () => {
    const { enforceTaskCount, isValidTaskQuality } = await import("../src/services/ai/taskLimits");
    const goal = "Build an AI personal coach app";
    const tasks = enforceTaskCount([], {
      stepTitle: goal,
      goalContext: goal,
      desiredCount: 4,
    });
    const hasVerb = (task: any) => /\b(write|list|build|implement|review|analyze|fix|create|plan|summarize|decide|spend|complete)\b/i.test(`${task.title} ${task.description || ""}`);
    const hasOutcome = (task: any) => /\b(outcome|takeaway|decision|note|result|summary|bullet|check|improvement|adjustment|step|priority)\b/i.test(`${task.title} ${task.description || ""}`);
    const validatorPass = tasks.every((task: any) => isValidTaskQuality(task, { goalContext: goal }));

    console.log("\n=== FALLBACK TEST ===");
    console.log("tasks:", tasks.map((task: any) => task.title));
    console.log("validator_pass:", validatorPass);

    expect(tasks).toHaveLength(4);
    expect(tasks.every((task: any) => hasVerb(task))).toBe(true);
    expect(tasks.filter((task: any) => hasOutcome(task)).length).toBeGreaterThanOrEqual(1);
    expect(tasks.some((task: any) => /work on|think about|review progress/i.test(task.title))).toBe(false);
    expect(tasks.every((task: any) => String(task.title || "").trim().length >= 20)).toBe(true);
    expect(validatorPass).toBe(true);
  });

  it("prints fallback determinism (same input twice)", async () => {
    const { enforceTaskCount } = await import("../src/services/ai/taskLimits");
    const goal = "Build an AI personal coach app";

    const input = [
      {
        title: "Learn one concept for Build an AI personal coach app",
        description: "Study and note one key point",
        difficulty: 2,
        task_type: "learn",
      },
    ];

    const first = enforceTaskCount(input as any, {
      stepTitle: goal,
      goalContext: goal,
      desiredCount: 4,
      targetDifficulty: 2,
    });

    const second = enforceTaskCount(input as any, {
      stepTitle: goal,
      goalContext: goal,
      desiredCount: 4,
      targetDifficulty: 2,
    });

    console.log("\n=== FALLBACK DETERMINISM ===");
    console.log("run_1:", first.map((task: any) => task.title));
    console.log("run_2:", second.map((task: any) => task.title));

    expect(first.map((task: any) => task.title)).toEqual(second.map((task: any) => task.title));
  });

  it("PHASE5_MULTI_DAY_EVOLUTION", async () => {
    const { chooseTargetDifficulty } = await import("../src/services/difficultyService");
    const { enforceTaskCount } = await import("../src/services/ai/taskLimits");

    const day2Target = chooseTargetDifficulty(2, {
      completion_rate: 0.2,
      skip_rate: 0.7,
    });

    const day4Target = chooseTargetDifficulty(2, {
      completion_rate: 0.9,
      skip_rate: 0.1,
    });

    const sourceTasks = [
      {
        title: "Write 2 focused progress notes for Build an AI personal coach app",
        description: "Capture one visible outcome and one immediate next step.",
        difficulty: 3,
        task_type: "action",
      },
      {
        title: "Plan the next 2 priorities for Build an AI personal coach app",
        description: "Decide order and explain rationale in one summary.",
        difficulty: 3,
        task_type: "plan",
      },
      {
        title: "Review Build an AI personal coach app work in 3 concrete insights",
        description: "Summarize what worked and one adjustment.",
        difficulty: 3,
        task_type: "review",
      },
      {
        title: "Reflect on 2 coaching lessons from Build an AI personal coach app",
        description: "Write two lessons and one adjustment decision.",
        difficulty: 3,
        task_type: "reflect",
      },
    ] as any;

    const day2Tasks = enforceTaskCount(sourceTasks, {
      stepTitle: "Build an AI personal coach app",
      goalContext: "Build an AI personal coach app",
      desiredCount: 4,
      targetDifficulty: day2Target,
    });

    const day4Tasks = enforceTaskCount(sourceTasks, {
      stepTitle: "Build an AI personal coach app",
      goalContext: "Build an AI personal coach app",
      desiredCount: 4,
      targetDifficulty: day4Target,
    });

    const avg = (tasks: any[]) => tasks.reduce((sum, task) => sum + Number(task.difficulty || 0), 0) / Math.max(1, tasks.length);
    const day2Avg = avg(day2Tasks);
    const day4Avg = avg(day4Tasks);

    console.log("\n=== MULTI DAY TEST ===");
    console.log("Day2 tasks:", day2Tasks.map((task: any) => ({ title: task.title, difficulty: task.difficulty })));
    console.log("Day4 tasks:", day4Tasks.map((task: any) => ({ title: task.title, difficulty: task.difficulty })));

    expect(day2Avg).toBeLessThanOrEqual(day4Avg);
  });
});
