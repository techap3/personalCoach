import "dotenv/config";
import express from "express";
import cors from "cors";

import testRoutes from "./routes/test";
import goalRoutes from "./routes/goals";
import taskRoutes from "./routes/tasks";
import adaptRoutes from "./routes/adapt";
import { runMigrations } from "./scripts/migrationRunner";

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
      console.warn("[migrate] Startup migrations skipped");
    } else {
      console.log(
        `[migrate] Startup migrations finished (executed=${summary.executed}, skipped=${summary.skipped})`
      );
    }
  } catch (error) {
    console.error("[migrate] Startup migration failed", error);
    if (process.env.NODE_ENV === "production") {
      throw error;
    }
    console.warn("[migrate] Continuing startup despite migration failure");
  }

  console.log("Starting server...");
  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log("Server is alive and listening...");
  });

  return server;
}

startServer().catch((error) => {
  console.error("[startup] Unexpected startup error", error);
  if (process.env.NODE_ENV === "production") {
    process.exit(1);
  }
});

export { app };