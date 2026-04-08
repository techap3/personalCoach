import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import type supertest from "supertest";
import { normalizeTaskTitle } from "../services/ai/taskDedup";

const { aiCreateMock } = vi.hoisted(() => ({
  aiCreateMock: vi.fn(),
}));

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

vi.mock("../services/ai/provider", () => ({
  getAIClient: () => ({
    chat: {
      completions: {
        create: aiCreateMock,
      },
    },
  }),
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

const authHeader = () => {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: "user-1" })).toString("base64url");
  const signature = Buffer.from("signature").toString("base64url");
  return `Bearer ${header}.${payload}.${signature}`;
};

const makeTasks = (count: number) => {
  const variants = [
    {
      title: "Implement one small part of Task cap goal and test 1 expected result",
      description: "Ship one concrete change for Task cap goal and record the observed output.",
      task_type: "action",
    },
    {
      title: "Analyze one example for Task cap goal and list 2 practical takeaways",
      description: "Read one focused reference related to Task cap goal and note two useful lessons.",
      task_type: "learn",
    },
    {
      title: "Write 2 wins and 1 blocker from Task cap goal progress",
      description: "Write two concrete wins and one blocker found while working on Task cap goal.",
      task_type: "reflect",
    },
    {
      title: "Review Task cap goal output and summarize 3 quality checks",
      description: "Summarize three checks you completed for Task cap goal and one next decision.",
      task_type: "review",
    },
    {
      title: "Plan the next 2 implementation steps to move Task cap goal forward",
      description: "Define two next steps for Task cap goal and set one success signal for each.",
      task_type: "plan",
    },
    {
      title: "Create a focused debug checklist for Task cap goal with 3 checks",
      description: "Create three concrete debug checks tied to Task cap goal behavior.",
      task_type: "action",
    },
    {
      title: "Summarize one architecture tradeoff in Task cap goal and pick 1 approach",
      description: "Write one tradeoff summary and choose the approach for Task cap goal.",
      task_type: "learn",
    },
    {
      title: "List 2 mistakes while building Task cap goal and 1 correction",
      description: "Document two mistakes from Task cap goal work and one correction for next run.",
      task_type: "reflect",
    },
    {
      title: "Decide tomorrow's first 2 priorities for Task cap goal",
      description: "Pick two priorities for Task cap goal and justify the order in one sentence.",
      task_type: "plan",
    },
  ];

  return Array.from({ length: count }, (_, i) => ({
    title: variants[i]?.title ?? variants[0].title,
    description: variants[i]?.description ?? variants[0].description,
    difficulty: 2,
    task_type: (variants[i]?.task_type ?? "action") as any,
  }));
};

const mockAiTasks = (count: number) => {
  aiCreateMock.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ tasks: makeTasks(count) }) } }],
  });
};

const mockAiRaw = (content: string) => {
  aiCreateMock.mockResolvedValue({
    choices: [{ message: { content } }],
  });
};

async function createGoal() {
  const response = await request(app)
    .post("/goals")
    .set("Authorization", authHeader())
    .send({ title: "Task cap goal", description: "Task cap regression" });

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
});

beforeEach(() => {
  resetMockDb();
  aiCreateMock.mockReset();
});

describe("task cap flow regression", () => {
  it("stores only 5 tasks when AI returns excessive tasks", async () => {
    const goalId = await createGoal();
    mockAiTasks(9);

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(response.status).toBe(200);
    expect(response.body.tasks.length).toBeGreaterThanOrEqual(3);
    expect(response.body.tasks.length).toBeLessThanOrEqual(5);
    expect(mockState.tables.tasks).toHaveLength(response.body.tasks.length);
  });

  it("fills to minimum when AI returns too few tasks", async () => {
    const goalId = await createGoal();
    mockAiTasks(1);

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(response.status).toBe(200);
    expect(response.body.tasks.length).toBeGreaterThanOrEqual(3);
    expect(response.body.tasks.length).toBeLessThanOrEqual(5);
  });

  it("keeps valid AI task count unchanged", async () => {
    const goalId = await createGoal();
    mockAiTasks(4);

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(response.status).toBe(200);
    expect(response.body.tasks.length).toBeGreaterThanOrEqual(3);
    expect(response.body.tasks.length).toBeLessThanOrEqual(4);
    expect(response.body.tasks[0].title).toBe("Implement one small part of Task cap goal and test 1 expected result");
  });

  it("uses fallback tasks for empty AI response", async () => {
    const goalId = await createGoal();
    mockAiRaw(JSON.stringify({ tasks: [] }));

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(response.status).toBe(200);
    expect(response.body.tasks.length).toBeGreaterThanOrEqual(3);
    expect(response.body.tasks.length).toBeLessThanOrEqual(5);
    expect(response.body.tasks.every((task: any) => typeof task.title === "string" && task.title.trim().length >= 10)).toBe(true);
    expect(response.body.tasks.every((task: any) => !/^task\s+[a-z0-9]+$/i.test(task.title.trim()))).toBe(true);
  });

  it("does not crash and avoids duplicate persistence on invalid AI output", async () => {
    const goalId = await createGoal();
    mockAiRaw("not-json");

    const first = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    const tasksAfterFirstCall = mockState.tables.tasks.length;
    const sessionsAfterFirstCall = mockState.tables.task_sessions.length;

    const second = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.tasks.length).toBeGreaterThanOrEqual(3);
    expect(first.body.tasks.length).toBeLessThanOrEqual(5);
    expect(mockState.tables.tasks.length).toBe(tasksAfterFirstCall);
    expect(mockState.tables.task_sessions.length).toBe(sessionsAfterFirstCall);
  });

  it("removes tasks that were done recently", async () => {
    const goalId = await createGoal();
    const step = mockState.tables.plan_steps.find((s: any) => s.step_index === 0);

    mockState.tables.task_sessions.push({
      id: "recent-session-1",
      goal_id: goalId,
      plan_id: step.plan_id,
      plan_step_id: step.id,
      session_date: "2026-04-04",
      status: "completed",
      created_at: new Date(Date.now() - 60_000).toISOString(),
    });

    mockState.tables.tasks.push({
      id: "recent-task-1",
      goal_id: goalId,
      plan_step_id: step.id,
      session_id: "recent-session-1",
      title: "Go for a run",
      description: "Already done",
      difficulty: 2,
      status: "done",
      created_at: new Date(Date.now() - 50_000).toISOString(),
    });

    mockAiRaw(
      JSON.stringify({
        tasks: [
          { title: "Go for a run!", description: "Duplicate", difficulty: 2 },
          { title: "Plan tomorrow", description: "Unique", difficulty: 2 },
          { title: "Reflect on progress", description: "Unique", difficulty: 1 },
        ],
      })
    );

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(response.status).toBe(200);
    const titles = response.body.tasks.map((task: any) => task.title.toLowerCase().trim());
    expect(titles).not.toContain("go for a run!");
    expect(response.body.tasks.length).toBeGreaterThanOrEqual(3);
    expect(response.body.tasks.length).toBeLessThanOrEqual(5);
  });

  it("fills fallback after duplicate removal drops below minimum", async () => {
    const goalId = await createGoal();
    const step = mockState.tables.plan_steps.find((s: any) => s.step_index === 0);

    mockState.tables.task_sessions.push({
      id: "recent-session-2",
      goal_id: goalId,
      plan_id: step.plan_id,
      plan_step_id: step.id,
      session_date: "2026-04-04",
      status: "completed",
      created_at: new Date(Date.now() - 60_000).toISOString(),
    });

    mockState.tables.tasks.push(
      {
        id: "recent-task-2",
        goal_id: goalId,
        plan_step_id: step.id,
        session_id: "recent-session-2",
        title: "Task A",
        description: "Already done",
        difficulty: 2,
        status: "done",
        created_at: new Date(Date.now() - 50_000).toISOString(),
      },
      {
        id: "recent-task-3",
        goal_id: goalId,
        plan_step_id: step.id,
        session_id: "recent-session-2",
        title: "Task B",
        description: "Already done",
        difficulty: 2,
        status: "done",
        created_at: new Date(Date.now() - 50_000).toISOString(),
      }
    );

    mockAiRaw(
      JSON.stringify({
        tasks: [
          { title: "Task A", description: "Duplicate", difficulty: 2 },
          { title: "Task B", description: "Duplicate", difficulty: 2 },
          { title: "Unique Task", description: "One unique", difficulty: 2 },
        ],
      })
    );

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(response.status).toBe(200);
    expect(response.body.tasks.length).toBeGreaterThanOrEqual(3);
    expect(response.body.tasks.length).toBeLessThanOrEqual(5);
  });

  it("keeps unique AI tasks without unnecessary filtering", async () => {
    const goalId = await createGoal();

    mockAiRaw(
      JSON.stringify({
        tasks: [
          {
            title: "Build one focused utility for Task cap goal and list 2 edge cases",
            description: "A",
            difficulty: 2,
            task_type: "action",
          },
          {
            title: "Summarize one architecture section in Task cap goal in 3 bullet points",
            description: "B",
            difficulty: 2,
            task_type: "learn",
          },
          {
            title: "Review Task cap goal progress and write 2 concrete adjustments",
            description: "C",
            difficulty: 2,
            task_type: "reflect",
          },
        ],
      })
    );

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(response.status).toBe(200);
    const titles = response.body.tasks.map((task: any) => task.title);
    expect(titles).toContain("Build one focused utility for Task cap goal and list 2 edge cases");
    expect(titles.some((title: string) => /Task cap goal/i.test(title))).toBe(true);
    expect(new Set(titles.map((title: string) => normalizeTaskTitle(title))).size).toBe(titles.length);
  });

  it("removes repeated tasks within same AI response before storage", async () => {
    const goalId = await createGoal();

    mockAiRaw(
      JSON.stringify({
        tasks: [
          { title: "Repeat me", description: "A", difficulty: 2 },
          { title: "repeat me!", description: "B", difficulty: 2 },
          { title: "Unique Task", description: "C", difficulty: 2 },
          { title: "Unique Task 2", description: "D", difficulty: 2 },
        ],
      })
    );

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(response.status).toBe(200);

    const normalized = response.body.tasks.map((task: any) => normalizeTaskTitle(task.title));
    expect(new Set(normalized).size).toBe(normalized.length);
    expect(response.body.tasks.length).toBeGreaterThanOrEqual(3);
    expect(response.body.tasks.length).toBeLessThanOrEqual(5);
  });

  it("injects action and reflect when AI returns only learn tasks", async () => {
    const goalId = await createGoal();

    mockAiRaw(
      JSON.stringify({
        tasks: [
          { title: "Read concept A", description: "Learn", difficulty: 2, task_type: "learn" },
          { title: "Read concept B", description: "Learn", difficulty: 2, task_type: "learn" },
          { title: "Read concept C", description: "Learn", difficulty: 2, task_type: "learn" },
        ],
      })
    );

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(response.status).toBe(200);
    const types = response.body.tasks.map((task: any) => task.task_type);
    expect(types).toContain("action");
    expect(types.some((type: string) => type === "reflect" || type === "review")).toBe(true);
  });

  it("keeps valid task type mix unchanged", async () => {
    const goalId = await createGoal();

    mockAiRaw(
      JSON.stringify({
        tasks: [
          {
            title: "Ship one feature slice for Task cap goal and list 2 acceptance checks",
            description: "Implement one small change and verify two expected outputs.",
            difficulty: 2,
            task_type: "action",
          },
          {
            title: "Read one implementation example for Task cap goal and summarize 3 takeaways",
            description: "Capture three concrete lessons and one follow-up question.",
            difficulty: 2,
            task_type: "learn",
          },
          {
            title: "Summarize Task cap goal outcomes in 3 bullet points and 1 adjustment",
            description: "Write a short review with one concrete adjustment for tomorrow.",
            difficulty: 1,
            task_type: "review",
          },
        ],
      })
    );

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(response.status).toBe(200);
    const types = response.body.tasks.map((task: any) => task.task_type);
    expect(types).toContain("action");
    expect(types.every((type: string) => ["action", "reflect", "review"].includes(type))).toBe(true);
    expect(types.some((type: string) => type === "reflect" || type === "review")).toBe(true);
  });

  it("adds fallback reflect when reflect/review type is missing", async () => {
    const goalId = await createGoal();

    mockAiRaw(
      JSON.stringify({
        tasks: [
          { title: "Execute small coding task", description: "Do", difficulty: 2, task_type: "action" },
          { title: "Read official docs", description: "Learn", difficulty: 2, task_type: "learn" },
          { title: "Watch one walkthrough", description: "Learn", difficulty: 2, task_type: "learn" },
        ],
      })
    );

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(response.status).toBe(200);
    expect(response.body.tasks.some((task: any) => task.task_type === "reflect" || task.task_type === "review")).toBe(true);
  });

  it("decreases target difficulty when recent skip rate is high", async () => {
    const goalId = await createGoal();
    const step = mockState.tables.plan_steps.find((s: any) => s.step_index === 0);
    step.difficulty = 3;

    mockState.tables.task_sessions.push(
      {
        id: "skip-session-1",
        goal_id: goalId,
        plan_id: step.plan_id,
        plan_step_id: step.id,
        session_date: "2026-04-01",
        status: "completed",
        created_at: new Date(Date.now() - 300_000).toISOString(),
      },
      {
        id: "skip-session-2",
        goal_id: goalId,
        plan_id: step.plan_id,
        plan_step_id: step.id,
        session_date: "2026-04-02",
        status: "completed",
        created_at: new Date(Date.now() - 240_000).toISOString(),
      },
      {
        id: "skip-session-3",
        goal_id: goalId,
        plan_id: step.plan_id,
        plan_step_id: step.id,
        session_date: "2026-04-03",
        status: "completed",
        created_at: new Date(Date.now() - 180_000).toISOString(),
      }
    );

    mockState.tables.tasks.push(
      { id: "skip-task-1", goal_id: goalId, plan_step_id: step.id, session_id: "skip-session-1", title: "A", description: "A", difficulty: 4, status: "skipped", created_at: new Date().toISOString() },
      { id: "skip-task-2", goal_id: goalId, plan_step_id: step.id, session_id: "skip-session-1", title: "B", description: "B", difficulty: 4, status: "skipped", created_at: new Date().toISOString() },
      { id: "skip-task-3", goal_id: goalId, plan_step_id: step.id, session_id: "skip-session-2", title: "C", description: "C", difficulty: 4, status: "skipped", created_at: new Date().toISOString() },
      { id: "skip-task-4", goal_id: goalId, plan_step_id: step.id, session_id: "skip-session-2", title: "D", description: "D", difficulty: 4, status: "done", created_at: new Date().toISOString() },
      { id: "skip-task-5", goal_id: goalId, plan_step_id: step.id, session_id: "skip-session-3", title: "E", description: "E", difficulty: 4, status: "skipped", created_at: new Date().toISOString() }
    );

    mockAiRaw(
      JSON.stringify({
        tasks: [
          { title: "Hard Task 1", description: "A", difficulty: 5, task_type: "action" },
          { title: "Hard Task 2", description: "B", difficulty: 5, task_type: "learn" },
          { title: "Hard Task 3", description: "C", difficulty: 5, task_type: "reflect" },
        ],
      })
    );

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(response.status).toBe(200);
    expect(response.body.tasks.every((task: any) => task.difficulty >= 1 && task.difficulty <= 3)).toBe(true);
  });

  it("increases target difficulty when recent completion rate is high", async () => {
    const goalId = await createGoal();
    const step = mockState.tables.plan_steps.find((s: any) => s.step_index === 0);
    step.difficulty = 3;

    mockState.tables.task_sessions.push(
      {
        id: "done-session-1",
        goal_id: goalId,
        plan_id: step.plan_id,
        plan_step_id: step.id,
        session_date: "2026-04-01",
        status: "completed",
        created_at: new Date(Date.now() - 300_000).toISOString(),
      },
      {
        id: "done-session-2",
        goal_id: goalId,
        plan_id: step.plan_id,
        plan_step_id: step.id,
        session_date: "2026-04-02",
        status: "completed",
        created_at: new Date(Date.now() - 240_000).toISOString(),
      }
    );

    mockState.tables.tasks.push(
      { id: "done-task-1", goal_id: goalId, plan_step_id: step.id, session_id: "done-session-1", title: "A", description: "A", difficulty: 2, status: "done", created_at: new Date().toISOString() },
      { id: "done-task-2", goal_id: goalId, plan_step_id: step.id, session_id: "done-session-1", title: "B", description: "B", difficulty: 2, status: "done", created_at: new Date().toISOString() },
      { id: "done-task-3", goal_id: goalId, plan_step_id: step.id, session_id: "done-session-2", title: "C", description: "C", difficulty: 2, status: "done", created_at: new Date().toISOString() },
      { id: "done-task-4", goal_id: goalId, plan_step_id: step.id, session_id: "done-session-2", title: "D", description: "D", difficulty: 2, status: "done", created_at: new Date().toISOString() },
      { id: "done-task-5", goal_id: goalId, plan_step_id: step.id, session_id: "done-session-2", title: "E", description: "E", difficulty: 2, status: "done", created_at: new Date().toISOString() }
    );

    mockAiRaw(
      JSON.stringify({
        tasks: [
          { title: "Task 1", description: "A", difficulty: 1, task_type: "action" },
          { title: "Task 2", description: "B", difficulty: 1, task_type: "learn" },
          { title: "Task 3", description: "C", difficulty: 1, task_type: "review" },
        ],
      })
    );

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(response.status).toBe(200);
    expect(response.body.tasks.every((task: any) => task.difficulty >= 2 && task.difficulty <= 4)).toBe(true);
  });

  it("uses default difficulty when no history exists", async () => {
    const goalId = await createGoal();
    const step = mockState.tables.plan_steps.find((s: any) => s.step_index === 0);
    step.difficulty = 5;

    mockAiRaw(
      JSON.stringify({
        tasks: [
          { title: "Task 1", description: "A", difficulty: 5, task_type: "action" },
          { title: "Task 2", description: "B", difficulty: 5, task_type: "learn" },
          { title: "Task 3", description: "C", difficulty: 5, task_type: "reflect" },
        ],
      })
    );

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(response.status).toBe(200);
    expect(response.body.tasks.every((task: any) => task.difficulty >= 1 && task.difficulty <= 3)).toBe(true);
  });
});
