import { z } from "zod";

const Schema = z.object({
  updated_tasks: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      difficulty: z.number().min(1).max(5),
    })
  ),
});

// 🧠 smarter JSON extraction
function extractJSON(raw: string) {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON found");
    return match[0];
  } catch {
    throw new Error("JSON extraction failed");
  }
}

// 🔒 semantic + structural enforcement
function enforceTaskConstraints(
  adapted: any[],
  original: any[],
  metrics: any
) {
  if (!Array.isArray(adapted) || adapted.length === 0) {
    console.warn("⚠️ Invalid adapted tasks → fallback");
    return original;
  }

  // 🔥 enforce SAME LENGTH strictly
  let finalTasks = [...adapted];

  if (finalTasks.length !== original.length) {
    console.warn("⚠️ Length mismatch → correcting");

    finalTasks = finalTasks.slice(0, original.length);

    while (finalTasks.length < original.length) {
      finalTasks.push(original[finalTasks.length]);
    }
  }

  // 🔥 sanitize each task
  finalTasks = finalTasks.map((task, i) => {
    const fallback = original[i];

    let difficulty = task.difficulty;

    if (typeof difficulty !== "number") {
      difficulty = fallback.difficulty;
    }

    // 🔥 controlled adaptation (NOT too aggressive)
    if (metrics.done === 0) {
      difficulty = Math.max(difficulty, fallback.difficulty);
    } else if (metrics.completionRate > 0.8) {
      difficulty = Math.max(difficulty, 3);
    } else if (metrics.completionRate < 0.4) {
      difficulty = Math.min(difficulty, 2);
    }

    return {
      title:
        typeof task.title === "string" && task.title.length > 3
          ? task.title
          : fallback.title,

      description:
        typeof task.description === "string"
          ? task.description
          : fallback.description,

      difficulty,
    };
  });

  return finalTasks;
}

export function parseAdaptedTasks(
  raw: string,
  originalTasks: any[],
  metrics: any
) {
  console.log("🧠 RAW INPUT:", raw);

  try {
    const jsonStr = extractJSON(raw);

    let parsed;

    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.warn("⚠️ JSON.parse failed → attempting recovery");

      // 🧠 recovery attempt: remove trailing commas
      const cleaned = jsonStr.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
      parsed = JSON.parse(cleaned);
    }

    const safe = Schema.safeParse(parsed);

    if (!safe.success) {
      console.warn("⚠️ Zod validation failed → partial fallback");
      return {
        updated_tasks: originalTasks,
      };
    }

    const finalTasks = enforceTaskConstraints(
      safe.data.updated_tasks,
      originalTasks,
      metrics
    );

    return {
      updated_tasks: finalTasks,
    };
  } catch (err) {
    console.error("❌ HARD FALLBACK:", err);

    return {
      updated_tasks: originalTasks.map((t) => ({
        title: t.title,
        description: t.description,
        difficulty: t.difficulty,
      })),
    };
  }
}