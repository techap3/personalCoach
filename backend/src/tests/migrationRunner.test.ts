import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const connectMock = vi.fn();
const endMock = vi.fn();
const readdirMock = vi.fn();
const readFileMock = vi.fn();

vi.mock("pg", () => {
  class Client {
    connect = connectMock;
    query = queryMock;
    end = endMock;
  }

  return { Client };
});

vi.mock("fs/promises", () => ({
  readdir: readdirMock,
  readFile: readFileMock,
}));

describe("migration runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    connectMock.mockResolvedValue(undefined);
    endMock.mockResolvedValue(undefined);
  });

  it("runs migrations when DATABASE_URL exists", async () => {
    readdirMock.mockResolvedValue(["20260406_add_task_type_to_tasks.sql"]);
    readFileMock.mockResolvedValue("select 1;");

    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { runMigrations } = await import("../scripts/migrationRunner");

    const result = await runMigrations({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://postgres:secret@localhost:5432/postgres",
    } as NodeJS.ProcessEnv);

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalled();
    expect(result.executed).toBe(1);
    expect(result.skippedRun).toBe(false);
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Skipping migrations")
    );

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("skips migrations with warning when only SUPABASE_URL exists", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { runMigrations } = await import("../scripts/migrationRunner");

    const result = await runMigrations({
      NODE_ENV: "development",
      SUPABASE_URL: "https://example.supabase.co",
    } as NodeJS.ProcessEnv);

    expect(result.skippedRun).toBe(true);
    expect(connectMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[migrate] SUPABASE_URL is not a Postgres connection string. Migrations cannot run."
    );

    warnSpy.mockRestore();
  });

  it("handles missing env gracefully in development", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { runMigrations } = await import("../scripts/migrationRunner");

    const result = await runMigrations({
      NODE_ENV: "development",
    } as NodeJS.ProcessEnv);

    expect(result.skippedRun).toBe(true);
    expect(connectMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[migrate] No database connection string found. Set DATABASE_URL or SUPABASE_DB_URL."
    );

    warnSpy.mockRestore();
  });

  it("throws in production when no valid DB url exists", async () => {
    const { runMigrations } = await import("../scripts/migrationRunner");

    await expect(
      runMigrations({ NODE_ENV: "production" } as NodeJS.ProcessEnv)
    ).rejects.toThrow(/No valid Postgres connection string/i);

    expect(connectMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });
});
