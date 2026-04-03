import dotenv from "dotenv";
import express from "express";
import cors from "cors";

import testRoutes from "./routes/test";
import goalRoutes from "./routes/goals";
import taskRoutes from "./routes/tasks";
import adaptRoutes from "./routes/adapt";

dotenv.config();

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

app.listen(PORT, () => {});