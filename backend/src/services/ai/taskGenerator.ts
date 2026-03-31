import { getAIClient } from "./provider";
import { buildTaskPrompt } from "./prompts";
import { PlanResponse } from "./parser";

export async function generateTasks(plan: PlanResponse) {
  const client = getAIClient();

  const model =
    process.env.AI_MODEL || "meta-llama/llama-3-8b-instruct";

  const response = await client.chat.completions.create({
    model,
    messages: buildTaskPrompt(plan),
  });

  const raw = response.choices[0]?.message?.content || "";

  console.log("🧠 TASK GEN RAW:", raw);

  // ✅ PARSE HERE (CRITICAL FIX)
  try {
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");

    const clean = raw.slice(jsonStart, jsonEnd + 1);

    const parsed = JSON.parse(clean);

    console.log("✅ Parsed Tasks:", parsed);

    return parsed.tasks || [];
  } catch (err) {
    console.error("❌ Task parse failed:", err);

    // fallback (very important for stability)
    return [
      {
        title: "Start small",
        description: "Take the first step toward your goal",
        difficulty: 1,
      },
    ];
  }
}