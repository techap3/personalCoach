import dotenv from "dotenv";
import testRoutes from "./routes/test";
import express from "express";
import cors from "cors";
import goalRoutes from "./routes/goals";
import taskRoutes from "./routes/tasks";
import adaptRoutes from "./routes/adapt";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_, res) => {
  res.send("OK");
});

app.use("/goals", goalRoutes);

app.listen(3001, () => {
  console.log("Server running on 3001");
});

app.use("/test", testRoutes);

app.use("/tasks", taskRoutes);

app.use("/adapt", adaptRoutes);