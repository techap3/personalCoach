import { buildPlanPrompt } from "./prompts";
import { getAIClient } from "./provider";
import { parsePlanResponse, PlanResponse } from "./parser";

export async function generatePlan(goal: string): Promise<PlanResponse> {
  const client = getAIClient();
  const messages = buildPlanPrompt(goal);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log(`🤖 Attempt ${attempt}: Generating plan for "${goal}"`);

      const response = await client.chat.completions.create({
        model: "meta-llama/llama-3-8b-instruct",
        messages,
      });

      const rawOutput = response.choices[0]?.message?.content;
      if (!rawOutput) {
        throw new Error("No content in AI response");
      }

      console.log(`📄 Attempt ${attempt}: Received ${rawOutput.length} chars`);

      const parsed = parsePlanResponse(rawOutput);

      // Validate plan is not empty
      if (!parsed.plan || parsed.plan.length === 0) {
        throw new Error("AI returned empty plan");
      }

      console.log(`✅ Attempt ${attempt}: Generated ${parsed.plan.length} steps`);
      return parsed;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.warn(`❌ Attempt ${attempt} failed: ${errorMsg}`);

      if (attempt === 2) {
        throw new Error(`Failed to generate plan after ${attempt} attempts: ${errorMsg}`);
      }
    }
  }

  throw new Error("Failed to generate plan");
}
