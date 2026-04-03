import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import type supertest from "supertest";

vi.mock("../src/services/ai", () => ({
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

vi.mock("../src/services/ai/taskGenerator", () => ({
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

vi.mock("../src/db/supabase", () => {
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
        const inserted = this.insertValues.map((item) => {
          const row: Row = { ...item };
          if (!row.id) row.id = nextId(this.table.slice(0, -1) || "row");
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
});

describe("Flow tests", () => {
  it("should generate tasks for active step", async () => {
    const goalId = await createGoal();

    const response = await request(app)
      .post("/tasks/generate")
      .set("Authorization", authHeader())
      .send({ goal_id: goalId });

    expect(response.status).toBe(200);
    expect(response.body.tasks).toHaveLength(2);
    expect(mockState.tables.task_sessions).toHaveLength(1);
    expect(mockState.tables.task_sessions[0].status).toBe("active");
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

  it("should generate new tasks if session completed", async () => {
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
    expect(second.body.tasks).toHaveLength(2);

    const firstIds = first.body.tasks.map((t: any) => t.id);
    const secondIds = second.body.tasks.map((t: any) => t.id);
    expect(secondIds).not.toEqual(firstIds);
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

    await request(app)
      .post("/tasks/update")
      .set("Authorization", authHeader())
      .send({ task_id: generated.body.tasks[0].id, status: "done" });

    await request(app)
      .post("/tasks/update")
      .set("Authorization", authHeader())
      .send({ task_id: generated.body.tasks[1].id, status: "skipped" });

    const nextStep = mockState.tables.plan_steps.find((s: any) => s.step_index === 1);
    expect(nextStep?.status).toBe("active");
  });
});
