import fs from "fs";
import path from "path";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const dbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "";
const describeIfDb = dbUrl ? describe : describe.skip;

const migrationSql = fs.readFileSync(
  path.resolve(process.cwd(), "db/migrations/20260406_enforce_one_session_per_goal_per_day.sql"),
  "utf8"
);

describeIfDb("session dedup migration execution", () => {
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
        session_id uuid not null references task_sessions(id),
        status text not null default 'pending',
        title text not null
      )
    `);
  });

  afterEach(async () => {
    await client.query("rollback");
  });

  it("merges duplicates and preserves FK integrity", async () => {
    await client.query(`
      insert into task_sessions (id, goal_id, session_date, created_at)
      values
        ('00000000-0000-0000-0000-000000000001', 'g1', '2026-04-06', '2026-04-06T08:00:00Z'),
        ('00000000-0000-0000-0000-000000000002', 'g1', '2026-04-06', '2026-04-06T09:00:00Z')
    `);

    await client.query(`
      insert into tasks (id, session_id, title)
      values
        ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Task 1'),
        ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'Task 2')
    `);

    await client.query(migrationSql);

    const sessions = await client.query(
      "select id from task_sessions where goal_id = 'g1' and session_date = '2026-04-06' order by created_at asc"
    );
    const tasks = await client.query("select id::text as id, session_id::text as session_id from tasks order by id asc");
    const fkOrphans = await client.query(`
      select count(*)::int as count
      from tasks t
      left join task_sessions s on s.id = t.session_id
      where s.id is null
    `);

    expect(sessions.rows).toHaveLength(1);
    expect(sessions.rows[0]?.id).toBe("00000000-0000-0000-0000-000000000001");
    expect(tasks.rows).toEqual([
      {
        id: "10000000-0000-0000-0000-000000000001",
        session_id: "00000000-0000-0000-0000-000000000001",
      },
      {
        id: "10000000-0000-0000-0000-000000000002",
        session_id: "00000000-0000-0000-0000-000000000001",
      },
    ]);
    expect(fkOrphans.rows[0]?.count).toBe(0);
  });

  it("does nothing when no duplicates exist", async () => {
    await client.query(`
      insert into task_sessions (id, goal_id, session_date, created_at)
      values ('00000000-0000-0000-0000-000000000001', 'g1', '2026-04-06', '2026-04-06T08:00:00Z')
    `);

    await client.query(`
      insert into tasks (id, session_id, title)
      values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Task 1')
    `);

    await client.query(migrationSql);

    const sessions = await client.query("select id::text as id from task_sessions order by id asc");
    const tasks = await client.query("select id::text as id, session_id::text as session_id from tasks order by id asc");

    expect(sessions.rows).toEqual([{ id: "00000000-0000-0000-0000-000000000001" }]);
    expect(tasks.rows).toEqual([
      {
        id: "10000000-0000-0000-0000-000000000001",
        session_id: "00000000-0000-0000-0000-000000000001",
      },
    ]);
  });

  it("is idempotent on repeated execution", async () => {
    await client.query(`
      insert into task_sessions (id, goal_id, session_date, created_at)
      values
        ('00000000-0000-0000-0000-000000000001', 'g1', '2026-04-06', '2026-04-06T08:00:00Z'),
        ('00000000-0000-0000-0000-000000000002', 'g1', '2026-04-06', '2026-04-06T09:00:00Z')
    `);

    await client.query(`
      insert into tasks (id, session_id, title)
      values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'Task 1')
    `);

    await client.query(migrationSql);
    await client.query(migrationSql);

    const sessions = await client.query("select id::text as id from task_sessions order by id asc");
    const tasks = await client.query("select id::text as id, session_id::text as session_id from tasks order by id asc");

    expect(sessions.rows).toEqual([{ id: "00000000-0000-0000-0000-000000000001" }]);
    expect(tasks.rows).toEqual([
      {
        id: "10000000-0000-0000-0000-000000000001",
        session_id: "00000000-0000-0000-0000-000000000001",
      },
    ]);
  });

  it("merges multiple duplicate groups independently", async () => {
    await client.query(`
      insert into task_sessions (id, goal_id, session_date, created_at)
      values
        ('00000000-0000-0000-0000-000000000011', 'g1', '2026-04-06', '2026-04-06T08:00:00Z'),
        ('00000000-0000-0000-0000-000000000012', 'g1', '2026-04-06', '2026-04-06T09:00:00Z'),
        ('00000000-0000-0000-0000-000000000021', 'g2', '2026-04-06', '2026-04-06T07:00:00Z'),
        ('00000000-0000-0000-0000-000000000022', 'g2', '2026-04-06', '2026-04-06T10:00:00Z')
    `);

    await client.query(`
      insert into tasks (id, session_id, title)
      values
        ('10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000011', 'Task 1'),
        ('10000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000012', 'Task 2'),
        ('10000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000021', 'Task 3'),
        ('10000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000022', 'Task 4')
    `);

    await client.query(migrationSql);

    const sessions = await client.query(
      "select goal_id, id::text as id from task_sessions order by goal_id asc, created_at asc"
    );
    const tasks = await client.query("select id::text as id, session_id::text as session_id from tasks order by id asc");

    expect(sessions.rows).toEqual([
      { goal_id: "g1", id: "00000000-0000-0000-0000-000000000011" },
      { goal_id: "g2", id: "00000000-0000-0000-0000-000000000021" },
    ]);
    expect(tasks.rows).toEqual([
      {
        id: "10000000-0000-0000-0000-000000000011",
        session_id: "00000000-0000-0000-0000-000000000011",
      },
      {
        id: "10000000-0000-0000-0000-000000000012",
        session_id: "00000000-0000-0000-0000-000000000011",
      },
      {
        id: "10000000-0000-0000-0000-000000000021",
        session_id: "00000000-0000-0000-0000-000000000021",
      },
      {
        id: "10000000-0000-0000-0000-000000000022",
        session_id: "00000000-0000-0000-0000-000000000021",
      },
    ]);
  });

  it("prefers active canonical session and prevents completed+pending mismatch", async () => {
    await client.query(`
      insert into task_sessions (id, goal_id, session_date, status, created_at)
      values
        ('00000000-0000-0000-0000-000000000101', 'g-mixed', '2026-04-06', 'completed', '2026-04-06T08:00:00Z'),
        ('00000000-0000-0000-0000-000000000102', 'g-mixed', '2026-04-06', 'active', '2026-04-06T09:00:00Z')
    `);

    await client.query(`
      insert into tasks (id, session_id, status, title)
      values
        ('10000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000102', 'pending', 'Task A'),
        ('10000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000102', 'pending', 'Task B')
    `);

    await client.query(migrationSql);

    const sessions = await client.query(`
      select id::text as id, status
      from task_sessions
      where goal_id = 'g-mixed' and session_date = '2026-04-06'
      order by id asc
    `);
    const tasks = await client.query(`
      select id::text as id, session_id::text as session_id, status
      from tasks
      where id in ('10000000-0000-0000-0000-000000000101', '10000000-0000-0000-0000-000000000102')
      order by id asc
    `);
    const completedWithPending = await client.query(`
      select count(*)::int as count
      from task_sessions s
      where s.status = 'completed'
        and exists (
          select 1
          from tasks t
          where t.session_id = s.id
            and t.status = 'pending'
        )
    `);

    expect(sessions.rows).toEqual([
      { id: "00000000-0000-0000-0000-000000000102", status: "active" },
    ]);
    expect(tasks.rows).toEqual([
      {
        id: "10000000-0000-0000-0000-000000000101",
        session_id: "00000000-0000-0000-0000-000000000102",
        status: "pending",
      },
      {
        id: "10000000-0000-0000-0000-000000000102",
        session_id: "00000000-0000-0000-0000-000000000102",
        status: "pending",
      },
    ]);
    expect(completedWithPending.rows[0]?.count).toBe(0);
  });
});
