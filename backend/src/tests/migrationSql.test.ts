import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

describe("task_type migration safety", () => {
  it("normalizes null and invalid task_type values before applying constraint", () => {
    const migrationPath = path.resolve(
      process.cwd(),
      "db/migrations/20260406_add_task_type_to_tasks.sql"
    );

    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/set\s+task_type\s*=\s*'learn'/i);
    expect(sql).toMatch(/task_type\s+is\s+null/i);
    expect(sql).toMatch(/task_type\s+not\s+in\s*\('action',\s*'learn',\s*'reflect',\s*'review'\)/i);
    expect(sql).toMatch(/to_regclass\('tasks'\)\s+is\s+not\s+null/i);
  });
});

describe("task_sessions uniqueness migration", () => {
  it("enforces uniqueness on goal_id + plan_step_id + session_date", () => {
    const migrationPath = path.resolve(
      process.cwd(),
      "db/migrations/20260406_add_unique_task_session_per_step_day.sql"
    );

    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/unique\s*\(\s*goal_id\s*,\s*plan_step_id\s*,\s*session_date\s*\)/i);
  });
});

describe("task_sessions summary migration", () => {
  it("adds summary_json to task_sessions", () => {
    const migrationPath = path.resolve(
      process.cwd(),
      "db/migrations/20260406_add_task_session_summary.sql"
    );

    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/alter\s+table\s+if\s+exists\s+task_sessions/i);
    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+summary_json\s+jsonb/i);
  });
});
