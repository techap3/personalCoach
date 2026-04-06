import { z } from "zod";

const TaskSchema = z.object({
  tasks: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      difficulty: z.number(),
      task_type: z.enum(["action", "learn", "reflect", "review"]).optional(),
    })
  ),
});

export function parseTasks(raw: string) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  const json = raw.slice(start, end + 1);

  return TaskSchema.parse(JSON.parse(json));
}