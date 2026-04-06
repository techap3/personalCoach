import * as fs from "fs/promises";
import path from "path";
import { Client } from "pg";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "db/migrations");

type MigrationEnv = NodeJS.ProcessEnv;

type DbUrlResolution = {
  connectionString: string | null;
  source: "DATABASE_URL" | "SUPABASE_DB_URL" | null;
  warning?: string;
};

export type MigrationRunSummary = {
  executed: number;
  skipped: number;
  total: number;
  skippedRun: boolean;
};

function maskDbUrl(connectionString: string) {
  try {
    const parsed = new URL(connectionString);
    if (parsed.password) {
      parsed.password = "****";
    }
    return parsed.toString();
  } catch {
    return connectionString.replace(/:\/\/([^:@/]+):([^@/]+)@/, "://$1:****@");
  }
}

export function resolveMigrationDbUrl(env: MigrationEnv = process.env): DbUrlResolution {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl) {
    return {
      connectionString: databaseUrl,
      source: "DATABASE_URL",
    };
  }

  const supabaseDbUrl = env.SUPABASE_DB_URL?.trim();
  if (supabaseDbUrl) {
    return {
      connectionString: supabaseDbUrl,
      source: "SUPABASE_DB_URL",
    };
  }

  if (env.SUPABASE_URL?.trim()) {
    return {
      connectionString: null,
      source: null,
      warning:
        "SUPABASE_URL is not a Postgres connection string. Migrations cannot run.",
    };
  }

  return {
    connectionString: null,
    source: null,
    warning:
      "No database connection string found. Set DATABASE_URL or SUPABASE_DB_URL.",
  };
}

function getMigrationFiles(files: string[]) {
  return files
    .filter((file) => file.toLowerCase().endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
}

export async function runMigrations(env: MigrationEnv = process.env): Promise<MigrationRunSummary> {
  const nodeEnv = env.NODE_ENV || "development";
  const resolution = resolveMigrationDbUrl(env);

  if (!resolution.connectionString) {
    if (resolution.warning) {
      console.warn(`[migrate] ${resolution.warning}`);
    }

    if (nodeEnv === "production") {
      throw new Error(
        "No valid Postgres connection string for migrations. Configure DATABASE_URL or SUPABASE_DB_URL."
      );
    }

    console.warn("[migrate] Skipping migrations (no valid Postgres connection string)");
    return {
      executed: 0,
      skipped: 0,
      total: 0,
      skippedRun: true,
    };
  }

  const connectionString = resolution.connectionString;
  console.log(
    `[migrate] Using DB URL from ${resolution.source}: ${maskDbUrl(connectionString)}`
  );
  console.log("[migrate] Running migrations");

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    console.log("[migrate] Preparing migration tracker table");

    await client.query(`
      create table if not exists migrations (
        id text primary key,
        executed_at timestamptz not null default now()
      )
    `);

    const files = await fs.readdir(MIGRATIONS_DIR);
    const migrationFiles = getMigrationFiles(files);

    if (!migrationFiles.length) {
      console.log("[migrate] No SQL migration files found");
      return {
        executed: 0,
        skipped: 0,
        total: 0,
        skippedRun: false,
      };
    }

    let executedCount = 0;
    let skippedCount = 0;

    for (const filename of migrationFiles) {
      const filePath = path.join(MIGRATIONS_DIR, filename);
      const sql = await fs.readFile(filePath, "utf8");

      try {
        await client.query("begin");

        const claim = await client.query(
          `
            insert into migrations (id, executed_at)
            values ($1, now())
            on conflict (id) do nothing
            returning id
          `,
          [filename]
        );

        if ((claim.rowCount ?? 0) === 0) {
          await client.query("rollback");
          console.log(`[migrate] Skipping already executed: ${filename}`);
          skippedCount += 1;
          continue;
        }

        console.log(`[migrate] Running migration: ${filename}`);
        await client.query(sql);
        await client.query("commit");
        console.log(`[migrate] Migration complete: ${filename}`);
        executedCount += 1;
      } catch (error) {
        await client.query("rollback");
        console.error(`[migrate] Failed migration: ${filename}`);
        throw error;
      }
    }

    console.log(
      `[migrate] Summary: executed=${executedCount} skipped=${skippedCount} total=${migrationFiles.length}`
    );
    console.log("[migrate] All pending migrations executed");
    return {
      executed: executedCount,
      skipped: skippedCount,
      total: migrationFiles.length,
      skippedRun: false,
    };
  } finally {
    await client.end();
  }
}
