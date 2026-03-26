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

function extractJSON(raw: string) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start === -1 || end === -1) {
    throw new Error("No JSON found in AI response");
  }

  return raw.slice(start, end + 1);
}

// 🔥 enforce task safety and preserve maximum original size
function enforceTaskConstraints(
  adapted: any[],
  original: any[],
  metrics: any
) {
  // if adapted isn't a valid non-empty array, fallback
  if (!Array.isArray(adapted) || adapted.length === 0) {
    console.warn("⚠️ Task adaptation output invalid/empty; using original tasks as fallback.");

    return original.map((t) => ({
      title: t.title,
      description: t.description,
      difficulty: t.difficulty,
    }));
  }

  // Use at most original length; allow flexible count
  const effective = adapted.slice(0, original.length);

  return effective.map((task, index) => {
    let difficulty = task.difficulty;

    if (metrics.completionRate > 0.8) {
      difficulty = Math.max(difficulty, 3);
    } else if (metrics.completionRate < 0.4) {
      difficulty = Math.min(difficulty, 2);
    }

    const fallback = original[index] || { title: "", description: "", difficulty: 1 };

    return {
      title: task.title || fallback.title,
      description: task.description || fallback.description,
      difficulty,
    };
  });
}

export function parseAdaptedTasks(
  raw: string,
  originalTasks: any[],
  metrics: any
) {
  try {
    const json = extractJSON(raw);

    const parsed = Schema.parse(JSON.parse(json));

    const safeTasks = enforceTaskConstraints(
      parsed.updated_tasks,
      originalTasks,
      metrics
    );

    return {
      updated_tasks: safeTasks,
    };
  } catch (err) {
    console.error("❌ Task Adapt parse failed:", raw);

    // 🔥 hard fallback
    return {
      updated_tasks: originalTasks.map((t) => ({
        title: t.title,
        description: t.description,
        difficulty: t.difficulty,
      })),
    };
  }
}