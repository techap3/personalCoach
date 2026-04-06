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
  });
});
