import { z } from "zod";

const AdaptSchema = z.object({
  updated_plan: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      difficulty: z.number(),
    })
  ),
});

function extractJSON(raw: string) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start === -1 || end === -1) {
    throw new Error("No JSON found in response");
  }

  return raw.slice(start, end + 1);
}

// 🔥 enforce system constraints
function enforceDifficulty(plan: any[], metrics: any) {
  return plan.map((step) => {
    if (metrics.completionRate > 0.8) {
      return {
        ...step,
        difficulty: Math.max(step.difficulty, 3),
      };
    }

    if (metrics.completionRate < 0.4) {
      return {
        ...step,
        difficulty: Math.min(step.difficulty, 2),
      };
    }

    return step;
  });
}

export function parseAdaptedPlan(raw: string, metrics: any) {
  try {
    const jsonString = extractJSON(raw);

    const parsed = AdaptSchema.parse(JSON.parse(jsonString));

    parsed.updated_plan = enforceDifficulty(
      parsed.updated_plan,
      metrics
    );

    return parsed;
  } catch (err) {
    console.error("❌ Adapt parse failed:", raw);
    throw new Error("Invalid adaptation response");
  }
}