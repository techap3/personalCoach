import fs from "fs/promises";
import path from "path";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const dbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "";
const describeIfDb = dbUrl ? describe : describe.skip;

const migrationsDir = path.resolve(process.cwd(), "db/migrations");

describeIfDb("migration ordering integrity", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  beforeEach(async () => {
    await client.query("begin");

    await client.query(`
      create table task_sessions (
        id uuid primary key,
        goal_id text not null,
        plan_id text,
        plan_step_id text,
        session_date date not null,
        status text not null default 'active',
        created_at timestamptz not null default now()
      )
    `);

    await client.query(`
      create table tasks (
        id uuid primary key,
        goal_id text,
        session_id uuid not null references task_sessions(id),
        title text not null,
        description text,
        difficulty int,
        status text,
        created_at timestamptz not null default now()
      )
    `);
  });

  afterEach(async () => {
    await client.query("rollback");
  });

  it("applies all migrations and ends with unique(goal_id, session_date, session_type)", async () => {
    const allFiles = await fs.readdir(migrationsDir);
    const migrationFiles = allFiles
      .filter((name) => name.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));

    for (const filename of migrationFiles) {
      const sql = await fs.readFile(path.join(migrationsDir, filename), "utf8");
      await client.query(sql);
    }

    const uniqueCols = await client.query(`
      select kcu.column_name
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on tc.constraint_name = kcu.constraint_name
       and tc.table_schema = kcu.table_schema
      where tc.table_name = 'task_sessions'
        and tc.constraint_type = 'UNIQUE'
        and tc.constraint_name = 'task_sessions_goal_session_date_type_key'
      order by kcu.ordinal_position asc
    `);

    expect(uniqueCols.rows.map((row) => row.column_name)).toEqual([
      "goal_id",
      "session_date",
      "session_type",
    ]);

    const oldConstraint = await client.query(`
      select 1
      from information_schema.table_constraints
      where table_name = 'task_sessions'
        and constraint_name = 'task_sessions_goal_session_date_key'
      limit 1
    `);

    expect(oldConstraint.rowCount).toBe(0);
  });

  it("allows primary and bonus sessions to coexist for same goal/date", async () => {
    const allFiles = await fs.readdir(migrationsDir);
    const migrationFiles = allFiles
      .filter((name) => name.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b));

    for (const filename of migrationFiles) {
      const sql = await fs.readFile(path.join(migrationsDir, filename), "utf8");
      await client.query(sql);
    }

    await client.query(`
      insert into task_sessions (id, goal_id, session_date, session_type, status)
      values
        ('00000000-0000-0000-0000-00000000a001', 'goal-a', '2026-04-06', 'primary', 'completed'),
        ('00000000-0000-0000-0000-00000000a002', 'goal-a', '2026-04-06', 'bonus', 'active')
    `);

    const rows = await client.query(`
      select id::text as id, session_type
      from task_sessions
      where goal_id = 'goal-a' and session_date = '2026-04-06'
      order by session_type asc
    `);

    expect(rows.rows).toEqual([
      { id: '00000000-0000-0000-0000-00000000a002', session_type: 'bonus' },
      { id: '00000000-0000-0000-0000-00000000a001', session_type: 'primary' },
    ]);
  });
});
