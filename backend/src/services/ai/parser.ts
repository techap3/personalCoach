import { z } from "zod";

const PlanStepSchema = z.object({
  title: z.string(),
  description: z.string(),
  difficulty: z.number().min(1).max(5),
});

export type PlanStep = z.infer<typeof PlanStepSchema>;

const PlanResponseSchema = z.object({
  plan: z.array(PlanStepSchema),
});

export type PlanResponse = z.infer<typeof PlanResponseSchema>;

// 🔥 Extract JSON from messy LLM output
function extractJSON(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start === -1 || end === -1) {
    throw new Error("No JSON found in response");
  }

  return raw.slice(start, end + 1);
}

export function parsePlanResponse(rawResponse: string): PlanResponse {
  try {
    const jsonString = extractJSON(rawResponse);

    const parsed = JSON.parse(jsonString);

    const validated = PlanResponseSchema.parse(parsed);

    if (validated.plan.length === 0) {
      throw new Error("Empty plan");
    }

    return validated;
  } catch (error) {
    console.error("❌ Parse failed:", {
      rawResponse,
    });

    throw new Error("Invalid AI response format");
  }
}