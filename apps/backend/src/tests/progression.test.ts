import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import type supertest from "supertest";

vi.mock("../services/ai", () => ({
  generatePlan: async () => ({
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
  }),
}));

vi.mock("../services/ai/taskGenerator", () => ({
  generateTasksForStep: async () => [
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
  ],
}));

vi.mock("../db/supabase", () => {
  type Row = Record<string, any>;

  const state = {
    id: 1,
    tables: {
      goals: [] as Row[],
      plans: [] as Row[],
      plan_steps: [] as Row[],
      task_sessions: [] as Row[],
      tasks: [] as Row[],
    },
  };

  const nextId = (prefix: string) => `${prefix}-${state.id++}`;

  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

  const reset = () => {
    state.id = 1;
    state.tables.goals = [];
    state.tables.plans = [];
    state.tables.plan_steps = [];
    state.tables.task_sessions = [];
    state.tables.tasks = [];
  };

  class QueryBuilder {
    private action: "select" | "insert" | "update" = "select";
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

    update(values: Row) {
      this.action = "update";
      this.updateValues = values;
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

      if (this.action === "insert") {
        if (this.table === "task_sessions") {
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
        const updated = filtered.map((row) => {
          Object.assign(row, this.updateValues);
          return clone(row);
        });

        return {
          data: this.returnMutatedRows ? updated : null,
          error: null,
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
let getSupabaseClient: () => any;

const authHeader = () => {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: "user-1" })).toString("base64url");
  const signature = Buffer.from("signature").toString("base64url");
  return `Bearer ${header}.${payload}.${signature}`;
};

const getToday = () => {
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
    .send({ title: "Progression test goal", description: "Regression tests" });

  expect(response.status).toBe(200);
  return response.body.goal.id as string;
}

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  request = (await import("supertest")).default;
  ({ app } = await import("../index"));

  const supabaseModule = (await import("../db/supabase")) as any;
  mockState = supabaseModule.__mockState;
  resetMockDb = supabaseModule.__resetMockDb;
  getSupabaseClient = supabaseModule.getSupabaseClient;
});

beforeEach(() => {
  resetMockDb();
});

describe("Progression regression tests", () => {
  it("TEST 1 — step completes correctly", async () => {
    const { runProgressionEngine } = await import("../services/progressionEngine");
    const goalId = await createGoal();

    const step1 = mockState.tables.plan_steps.find((s: any) => s.step_index === 0);
    const step2 = mockState.tables.plan_steps.find((s: any) => s.step_index === 1);

    const sessionId = "session-1";
    const today = getToday();

    mockState.tables.task_sessions.push({
      id: sessionId,
      goal_id: goalId,
      plan_id: step1.plan_id,
      plan_step_id: step1.id,
      session_date: today,
      status: "completed",
      created_at: new Date().toISOString(),
    });

    mockState.tables.tasks.push(
      {
        id: "task-1",
        goal_id: goalId,
        plan_step_id: step1.id,
        session_id: sessionId,
        status: "done",
        title: "Task 1",
        description: "",
        difficulty: 1,
        created_at: new Date().toISOString(),
      },
      {
        id: "task-2",
        goal_id: goalId,
        plan_step_id: step1.id,
        session_id: sessionId,
        status: "skipped",
        title: "Task 2",
        description: "",
        difficulty: 1,
        created_at: new Date().toISOString(),
      }
    );

    await runProgressionEngine(getSupabaseClient(), goalId);

    expect(step1.status).toBe("completed");
    expect(step2.status).toBe("active");
  });

  it("TEST 2 — bonus session can start after primary completion on same day", async () => {
    const goalId = await createGoal();

    const first = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(first.status).toBe(200);

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

    const today = getToday();
    const step2 = mockState.tables.plan_steps.find((s: any) => s.step_index === 1);
    const step2Sessions = mockState.tables.task_sessions.filter(
      (s: any) => s.goal_id === goalId && s.plan_step_id === step2.id && s.session_date === today
    );

    expect(step2Sessions.length).toBe(1);
    expect(step2Sessions[0].session_type).toBe("bonus");
  });

  it("TEST 3 — no duplicate session tier for goal/day", async () => {
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

    const today = getToday();
    const dailySessions = mockState.tables.task_sessions.filter(
      (s: any) => s.goal_id === goalId && s.session_date === today
    );

    expect(dailySessions.length).toBe(1);
    expect(dailySessions[0].session_type).toBe("primary");
  });

  it("TEST 4 — tasks not regenerated if session active", async () => {
    const goalId = await createGoal();

    const first = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    const tasksBefore = mockState.tables.tasks.length;

    const second = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    const tasksAfter = mockState.tables.tasks.length;

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.type).toBe("ACTIVE_SESSION");
    expect(tasksAfter).toBe(tasksBefore);
  });

  it("TEST 5 — step completion threshold (2 done, 1 skipped)", async () => {
    const { runProgressionEngine } = await import("../services/progressionEngine");
    const goalId = await createGoal();

    const step1 = mockState.tables.plan_steps.find((s: any) => s.step_index === 0);

    const sessionId = "session-threshold";
    const today = getToday();

    mockState.tables.task_sessions.push({
      id: sessionId,
      goal_id: goalId,
      plan_id: step1.plan_id,
      plan_step_id: step1.id,
      session_date: today,
      status: "completed",
      created_at: new Date().toISOString(),
    });

    mockState.tables.tasks.push(
      {
        id: "task-a",
        goal_id: goalId,
        plan_step_id: step1.id,
        session_id: sessionId,
        status: "done",
        title: "Task A",
        description: "",
        difficulty: 1,
        created_at: new Date().toISOString(),
      },
      {
        id: "task-b",
        goal_id: goalId,
        plan_step_id: step1.id,
        session_id: sessionId,
        status: "done",
        title: "Task B",
        description: "",
        difficulty: 1,
        created_at: new Date().toISOString(),
      },
      {
        id: "task-c",
        goal_id: goalId,
        plan_step_id: step1.id,
        session_id: sessionId,
        status: "skipped",
        title: "Task C",
        description: "",
        difficulty: 1,
        created_at: new Date().toISOString(),
      }
    );

    await runProgressionEngine(getSupabaseClient(), goalId);

    expect(step1.status).toBe("completed");
  });
});
