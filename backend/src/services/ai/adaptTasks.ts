import { getAIClient } from "./provider";
import { buildTaskAdaptationPrompt } from "./prompts";

export async function generateAdaptedTasks(input: {
  tasks: any[];
  metrics: any;
  history: any[];
}) {
  const client = getAIClient();

  const model =
    process.env.AI_MODEL || "meta-llama/llama-3-8b-instruct";

  const response = await client.chat.completions.create({
    model,
    messages: buildTaskAdaptationPrompt(input),
  });

  const raw = response.choices[0]?.message?.content || "";

  console.log("🧠 Task Adapt RAW:", raw);

  return raw;
}