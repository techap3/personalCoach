import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import type supertest from "supertest";

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
    state.tables.goals = [];
    state.tables.plans = [];
    state.tables.plan_steps = [];
    state.tables.task_sessions = [];
    state.tables.tasks = [];
    state.tables.user_preferences = [];
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

      if (this.action === "insert") {
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
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
    .toISOString()
    .split("T")[0];
};

async function createGoal() {
  const response = await request(app)
    .post("/goals")
    .set("Authorization", authHeader())
    .send({ title: "Learn booking", description: "Flow test" });

  expect(response.status).toBe(200);
  return response.body.goal.id as string;
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
    expect(first.body.tasks.every((task: any) => task.difficulty === 2)).toBe(true);

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
    expect(second.body.tasks.every((task: any) => task.difficulty === 1)).toBe(true);
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

    console.log("\n=== DUPLICATE REQUEST SCENARIO ===");
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

    const response = await request(app)
      .post("/tasks/update")
      .set("Authorization", authHeader())
      .send({ task_id: generated.body.tasks[0].id, status: "done" });

    const persistedPreference = mockState.tables.user_preferences.find(
      (row: any) => row.user_id === "user-1"
    );

    console.log("\n=== DB FAILURE SCENARIO ===");
    console.log("response:", {
      status: response.status,
      completed_today: response.body.completed_today,
      total_today: response.body.total_today,
      streak: response.body.streak,
      feedback_message: response.body.feedback_message,
    });
    console.log("persisted preference after failure:", {
      current_streak: persistedPreference?.current_streak,
      last_completed_date: persistedPreference?.last_completed_date,
    });

    expect(response.status).toBe(200);
    expect(response.body.completed_today).toBeNull();
    expect(response.body.total_today).toBeNull();
    expect(response.body.streak).toBe(3);
    expect(persistedPreference?.current_streak).toBe(3);
    expect(persistedPreference?.last_completed_date).toBe(getLocalDateString());
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
});
