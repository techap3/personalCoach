import "dotenv/config";
import express from "express";
import cors from "cors";

import testRoutes from "./routes/test";
import goalRoutes from "./routes/goals";
import taskRoutes from "./routes/tasks";
import adaptRoutes from "./routes/adapt";
import { runMigrations } from "./scripts/migrationRunner";
import { traceMiddleware } from "./middleware/trace";
import logger from "./logger";

const app = express();

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
  res.send("OK");
});

// routes
app.use("/goals", goalRoutes);
app.use("/test", testRoutes);
app.use("/tasks", taskRoutes);
app.use("/adapt", adaptRoutes);

const PORT = process.env.PORT || 3001;

async function startServer() {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  try {
    const summary = await runMigrations(process.env);
    if (summary.skippedRun) {
      logger.warn({ event: "migrate.startup.skipped" }, "Startup migrations skipped");
    } else {
      logger.info(
        {
          event: "migrate.startup.finished",
          executed: summary.executed,
          skipped: summary.skipped,
        },
        "Startup migrations finished"
      );
    }
  } catch (error) {
    logger.error({ event: "migrate.startup.failed", error }, "Startup migration failed");
    if (process.env.NODE_ENV === "production") {
      throw error;
    }
    logger.warn({ event: "migrate.startup.continue" }, "Continuing startup despite migration failure");
  }

  logger.info({ event: "server.starting", port: PORT }, "Starting server");
  const server = app.listen(PORT, () => {
    logger.info({ event: "server.started", port: PORT }, "Server running and listening");
  });

  return server;
}

startServer().catch((error) => {
  logger.error({ event: "startup.unexpected_error", error }, "Unexpected startup error");
  if (process.env.NODE_ENV === "production") {
    process.exit(1);
  }
});

export { app };