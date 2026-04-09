import "dotenv/config";
import express from "express";
import cors from "cors";
import { setDefaultResultOrder } from "node:dns";
import { Client } from "pg";

import testRoutes from "./routes/test";
import goalRoutes from "./routes/goals";
import taskRoutes from "./routes/tasks";
import adaptRoutes from "./routes/adapt";
import { resolveMigrationDbUrl, runMigrations } from "./scripts/migrationRunner";
import { traceMiddleware } from "./middleware/trace";
import logger from "./logger";

try {
  setDefaultResultOrder("ipv4first");
} catch (error) {
  logger.warn({ event: "network.dns.result_order_failed", error }, "Failed to set DNS result order");
}

const app = express();
let isDbReady = false;

// ✅ CORS MUST BE FIRST
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ❌ REMOVE THIS (breaks in express 5)
// app.options("*", cors());

app.use(express.json());
app.use(traceMiddleware);

// health
app.get("/health", (_, res) => {
  if (isDbReady) {
    return res.status(200).json({ status: "ok", db: "ready" });
  }

  return res.status(503).json({ status: "degraded", db: "not_ready" });
});

// routes
app.use("/goals", goalRoutes);
app.use("/test", testRoutes);
app.use("/tasks", taskRoutes);
app.all("/daily-summary", (req, res) => {
  const queryIndex = req.originalUrl.indexOf("?");
  const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";
  return res.redirect(307, `/tasks/daily-summary${query}`);
});
app.use("/adapt", adaptRoutes);

const PORT = process.env.PORT || 3001;

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function retryWithExponentialBackoff<T>(
  fn: () => Promise<T>,
  options?: {
    retries?: number;
    initialDelayMs?: number;
    onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
  }
): Promise<T> {
  const retries = options?.retries ?? 5;
  const initialDelayMs = options?.initialDelayMs ?? 2000;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= retries) {
        throw error;
      }

      const delayMs = initialDelayMs * 2 ** (attempt - 1);
      options?.onRetry?.(attempt, delayMs, error);
      await sleep(delayMs);
    }
  }

  throw new Error("Retry loop terminated unexpectedly");
}

async function checkDbConnection() {
  const resolution = resolveMigrationDbUrl(process.env);

  if (!resolution.connectionString) {
    throw new Error(
      resolution.warning || "No valid Postgres connection string found for startup DB check"
    );
  }

  const client = new Client({
    connectionString: resolution.connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  try {
    await client.query("select 1");
  } finally {
    await client.end();
  }

  return {
    source: resolution.source,
  };
}

async function initializeDbReadiness() {
  logger.info({ event: "db.connect.start" }, "Checking database connectivity");

  try {
    const result = await retryWithExponentialBackoff(checkDbConnection, {
      retries: 5,
      initialDelayMs: 2000,
      onRetry: (attempt, delayMs, error) => {
        logger.warn(
          {
            event: "db.connect.retry",
            attempt,
            next_delay_ms: delayMs,
            error: toErrorMessage(error),
          },
          "Database connectivity check failed, retrying"
        );
      },
    });

    isDbReady = true;
    logger.info({ event: "db.connect.success", source: result.source }, "Database connectivity confirmed");
  } catch (error) {
    isDbReady = false;
    logger.error(
      { event: "db.connect.failed", error: toErrorMessage(error) },
      "Database connectivity check failed after retries"
    );
  }
}

function shouldRunMigrations() {
  return String(process.env.RUN_MIGRATIONS || "").toLowerCase() === "true";
}

async function initializeMigrations() {
  if (!shouldRunMigrations()) {
    logger.info({ event: "migrate.start.skipped", run_migrations: false }, "Startup migrations disabled");
    return;
  }

  logger.info({ event: "migrate.start" }, "Starting startup migrations");

  try {
    const summary = await retryWithExponentialBackoff(() => runMigrations(process.env), {
      retries: 5,
      initialDelayMs: 2000,
      onRetry: (attempt, delayMs, error) => {
        logger.warn(
          {
            event: "migrate.retry",
            attempt,
            next_delay_ms: delayMs,
            error: toErrorMessage(error),
          },
          "Migration execution failed, retrying"
        );
      },
    });

    logger.info(
      {
        event: "migrate.success",
        executed: summary.executed,
        skipped: summary.skipped,
        total: summary.total,
        skipped_run: summary.skippedRun,
      },
      "Startup migrations finished"
    );
    isDbReady = true;
  } catch (error) {
    logger.error(
      { event: "migrate.failed", error: toErrorMessage(error) },
      "Startup migrations failed after retries"
    );
  }
}

async function initializeBackgroundServices() {
  await initializeDbReadiness();
  await initializeMigrations();
}

async function startServer() {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  logger.info({ event: "server.starting", port: PORT }, "Starting server");
  const server = app.listen(PORT, () => {
    logger.info({ event: "server.started", port: PORT }, "Server running and listening");
  });

  void initializeBackgroundServices();

  return server;
}

startServer().catch((error) => {
  logger.error({ event: "startup.unexpected_error", error }, "Unexpected startup error");
  if (process.env.NODE_ENV === "production") {
    process.exit(1);
  }
});

export { app };