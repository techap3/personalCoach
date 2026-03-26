import { ChatCompletionMessageParam } from "openai/resources/chat";
import { PlanResponse } from "./parser";

export function buildPlanPrompt(goal: string): ChatCompletionMessageParam[] {
  return [
    {
      role: "system",
      content: `
You are an expert personal coach.

Break goals into small, actionable steps.

Return ONLY valid JSON in this format:
{
  "plan": [
    {
      "title": string,
      "description": string,
      "difficulty": number (1-5)
    }
  ]
}
      `,
    },
    {
      role: "user",
      content: `Goal: ${goal}`,
    },
  ];
}

export function buildTaskPrompt(plan: PlanResponse): ChatCompletionMessageParam[] {
  return [
    {
      role: "system",
      content: `
You are a personal coach.

Convert a plan into TODAY's actionable tasks.

Return ONLY JSON:
{
  "tasks": [
    {
      "title": string,
      "description": string,
      "difficulty": number (1-5)
    }
  ]
}
      `,
    },
    {
      role: "user",
      content: JSON.stringify(plan),
    },
  ];
}

export function buildAdaptationPrompt({
  plan,
  tasks,
  metrics,
}: {
  plan: any;
  tasks: any[];
  metrics: any;
}): ChatCompletionMessageParam[] {
  return [
    {
      role: "system",
      content: `
You are an adaptive personal coach.

CRITICAL RULES (MUST FOLLOW):

1. DO NOT change the original goal.
2. DO NOT create a completely new plan.
3. ONLY MODIFY the existing plan.
4. Keep the SAME number of steps as the original plan.

You must:
- Keep the same structure and intent
- Adjust difficulty and intensity
- Slightly refine wording if needed
- Stay aligned to the original goal

STRICT DIFFICULTY RULES:
- If completionRate > 0.8 → difficulty MUST be between 3–5
- If completionRate < 0.4 → difficulty MUST be between 1–2
- Otherwise → difficulty MUST be between 2–3

Do NOT ignore these rules.

Return ONLY valid JSON:

{
  "updated_plan": [
    {
      "title": string,
      "description": string,
      "difficulty": number (1-5)
    }
  ]
}
`,
    },
    {
      role: "user",
      content: `
Metrics:
- completionRate: ${metrics.completionRate}
- tasks_done: ${metrics.done}
- tasks_skipped: ${metrics.skipped}

Existing Plan:
${JSON.stringify(plan)}

Recent Tasks:
${JSON.stringify(tasks)}
`,
    },
  ];
}

export function buildTaskAdaptationPrompt({
  tasks,
  metrics,
  history,
}: {
  tasks: any[];
  metrics: any;
  history: any[];
}): ChatCompletionMessageParam[] {
  return [
   {
      role: "system",
      content: `
You are an adaptive personal coach.

CRITICAL RULES:

1. DO NOT create new tasks
2. DO NOT remove tasks
3. MODIFY existing tasks ONLY
4. The number of updated_tasks MUST be exactly equal to input tasks

ADAPTATION RULES:

- If completionRate > 0.8:
  → increase intensity (more time, reps, depth)
  → difficulty must be between 3–5

- If completionRate < 0.4:
  → reduce effort (simpler, shorter)
  → difficulty must be between 1–2

- Otherwise:
  → keep moderate (2–3)

Return ONLY JSON:

{
  "updated_tasks": [
    {
      "title": string,
      "description": string,
      "difficulty": number (1-5)
    }
  ]
}
`,
    },
    {
      role: "user",
      content: `
Metrics:
- completionRate: ${metrics.completionRate}
- tasks_done: ${metrics.done}
- tasks_skipped: ${metrics.skipped}

Current Tasks:
${JSON.stringify(tasks)}

Recent History (latest 10 tasks, include skipped):
${JSON.stringify(history)}

Instructions:
- Avoid returning tasks that are identical to recent history.
- If a task has been skipped repeatedly, simplify the task or propose a different approach.
- Keep task count same as current tasks.
- Keep tasks actionable and varied.
`,
    },
  ];
}