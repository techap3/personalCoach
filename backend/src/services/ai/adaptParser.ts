import { z } from "zod";

const AdaptSchema = z.object({
  updated_plan: z.array(
    z.object({
      title: z.string().trim().min(1),
      description: z.string().trim().min(1),
      difficulty: z.coerce.number().int().min(1).max(5).optional().default(2),
    })
  ).min(1),
});

function stripCodeFences(raw: string) {
  return raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function extractJsonObjectCandidates(raw: string): string[] {
  const cleaned = stripCodeFences(raw);
  const candidates = new Set<string>();

  if (!cleaned) {
    return [];
  }

  candidates.add(cleaned);

  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        candidates.add(cleaned.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return Array.from(candidates);
}

function parseFirstValidJson(raw: string) {
  const candidates = extractJsonObjectCandidates(raw);

  if (!candidates.length) {
    throw new Error("No JSON candidate found in adaptation response");
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const validated = AdaptSchema.safeParse(parsed);
      if (validated.success) {
        return validated.data;
      }
    } catch {
      // Try next candidate.
    }
  }

  throw new Error("No valid adapted plan JSON found");
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
    const parsed = parseFirstValidJson(raw);
    const adjustedPlan = enforceDifficulty(parsed.updated_plan, metrics);

    return {
      updated_plan: adjustedPlan,
    };
  } catch (err) {
    console.error("❌ Adapt parse failed. Raw AI response follows:");
    console.error(raw);
    throw new Error("Invalid adaptation response");
  }
}