import { getAIClient } from "./provider";
import { buildTaskPrompt } from "./prompts";
import { PlanResponse } from "./parser";

export async function generateTasks(plan: PlanResponse) {
  const client = getAIClient();

  const response = await client.chat.completions.create({
    model: process.env.AI_MODEL!,
    messages: buildTaskPrompt(plan),
  });

  const raw = response.choices[0]?.message?.content || "";

  return raw; // we’ll parse later
}