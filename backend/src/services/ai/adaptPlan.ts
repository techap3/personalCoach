import { getAIClient } from "./provider";
import { buildAdaptationPrompt } from "./prompts";

interface AdaptationInput {
  plan: any;
  tasks: any[];
  metrics: any;
}

export async function generateAdaptedPlan(input: AdaptationInput) {
  const client = getAIClient();

  const model =
    process.env.AI_MODEL || "meta-llama/llama-3-8b-instruct";

  const response = await client.chat.completions.create({
    model,
    messages: buildAdaptationPrompt(input),
  });

  const raw = response.choices[0]?.message?.content || "";

  console.log("🧠 Adapt RAW:", raw);

  return raw;
}