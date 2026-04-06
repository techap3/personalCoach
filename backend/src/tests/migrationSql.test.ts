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

describe("task_sessions session_type migration", () => {
  it("adds and constrains session_type while enabling two tiers per day", () => {
    const migrationPath = path.resolve(
      process.cwd(),
      "db/migrations/20260406_add_session_type_to_task_sessions.sql"
    );

    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+session_type\s+text/i);
    expect(sql).toMatch(/set\s+session_type\s*=\s*'primary'/i);
    expect(sql).toMatch(/check\s*\(session_type\s+in\s*\('primary',\s*'bonus'\)\)/i);
    expect(sql).toMatch(/drop\s+constraint\s+if\s+exists\s+task_sessions_goal_session_date_key/i);
    expect(sql).toMatch(/unique\s*\(goal_id,\s*session_date,\s*session_type\)/i);
  });
});

describe("task_sessions generation lock migration", () => {
  it("adds non-null generation_locked with default false", () => {
    const migrationPath = path.resolve(
      process.cwd(),
      "db/migrations/20260406_add_task_session_generation_lock.sql"
    );

    const sql = fs.readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/add\s+column\s+if\s+not\s+exists\s+generation_locked\s+boolean/i);
    expect(sql).toMatch(/set\s+generation_locked\s*=\s*false/i);
    expect(sql).toMatch(/alter\s+column\s+generation_locked\s+set\s+default\s+false/i);
    expect(sql).toMatch(/alter\s+column\s+generation_locked\s+set\s+not\s+null/i);
  });
});

describe("task_sessions dedup safety ordering", () => {
  it("uses status-priority canonical ordering in all dedup migrations", () => {
    const migrationPaths = [
      path.resolve(
        process.cwd(),
        "db/migrations/20260406_add_unique_task_session_per_step_day.sql"
      ),
      path.resolve(
        process.cwd(),
        "db/migrations/20260406_add_session_type_to_task_sessions.sql"
      ),
      path.resolve(
        process.cwd(),
        "db/migrations/20260406_enforce_one_session_per_goal_per_day.sql"
      ),
    ];

    for (const migrationPath of migrationPaths) {
      const sql = fs.readFileSync(migrationPath, "utf8");
      expect(sql).toMatch(/when\s+status\s*=\s*'active'\s+then\s+0/i);
      expect(sql).toMatch(/when\s+status\s*=\s*'failed'\s+then\s+1/i);
      expect(sql).toMatch(/when\s+status\s*=\s*'completed'\s+then\s+2/i);
      expect(sql).toMatch(/created_at\s+asc/i);
      expect(sql).toMatch(/id\s+asc/i);
    }
  });

  it("repairs completed sessions that still contain pending tasks after dedup", () => {
    const enforceSql = fs.readFileSync(
      path.resolve(process.cwd(), "db/migrations/20260406_enforce_one_session_per_goal_per_day.sql"),
      "utf8"
    );
    const sessionTypeSql = fs.readFileSync(
      path.resolve(process.cwd(), "db/migrations/20260406_add_session_type_to_task_sessions.sql"),
      "utf8"
    );

    for (const sql of [enforceSql, sessionTypeSql]) {
      expect(sql).toMatch(/set\s+status\s*=\s*'active'/i);
      expect(sql).toMatch(/where\s+s\.status\s*=\s*'completed'/i);
      expect(sql).toMatch(/t\.status\s*=\s*'pending'/i);
    }
  });
});
