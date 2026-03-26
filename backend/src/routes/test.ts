import { Router } from "express";
import { generatePlan } from "../services/ai";

const router = Router();

router.get("/plan", async (_, res) => {
  try {
    const plan = await generatePlan("Get fit in 30 days");
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: "AI failed" });
  }
});

export default router;