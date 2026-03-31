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

export function buildTaskPrompt(plan: PlanResponse): ChatCompletionMessageParam[]  {
  return [
    {
      role: "system",
      content: `
You are an intelligent personal coach.

Convert a long-term plan into 2-3 SMALL, actionable tasks for TODAY.

RULES:
- Tasks must be doable in 30-60 minutes
- Be SPECIFIC (avoid vague wording)
- DO NOT repeat plan steps directly
- Focus on execution, not planning
- Keep tasks realistic for a beginner

Return ONLY JSON:

{
  "tasks": [
    {
      "title": "string",
      "description": "string",
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
}: any) {
  return [
    {
      role: "system" as const,
      content: `
You are an intelligent AI personal coach.

CRITICAL:
- Return ONLY JSON
- No explanation, no extra text
- Output must start with { and end with }

CORE GOAL:
Adapt today's tasks to maximize chances of completion while keeping them meaningful.

---

TASK RULES:
- Return EXACTLY the same number of tasks as input
- Max 3 tasks
- Tasks must be specific, actionable, and time-bound
- Each task should take ~10–45 minutes (avoid trivial tasks under 5 minutes)
- DO NOT repeat tasks from history
- DO NOT rephrase the same task — change the approach if needed

---

BEHAVIOR RULES:

1. FIRST-TIME USER (IMPORTANT)
If tasks_done == 0:
- DO NOT over-simplify
- Keep tasks beginner-friendly but meaningful
- Focus on "starting momentum", not trivial actions

2. LOW COMPLETION (< 0.4 AND tasks_done > 0):
- Reduce complexity slightly
- Break tasks into smaller chunks
- Change approach if tasks were skipped repeatedly

3. HIGH COMPLETION (> 0.8):
- Increase difficulty
- Add depth or longer duration

4. REPEATED SKIPS:
- If similar tasks appear in history → CHANGE TYPE of task
  (e.g. not just "watch" → switch to "do", "write", "try")

---

QUALITY RULES:
- Avoid generic tasks like "think", "explore", "research"
- Prefer action verbs: write, build, try, list, practice
- Tasks should feel like real progress, not filler

---

FORMAT:
{
  "updated_tasks": [
    {
      "title": "string",
      "description": "string",
      "difficulty": number (1-5)
    }
  ]
}
      `,
    },
    {
      role: "user" as const,
      content: `
Metrics:
${JSON.stringify(metrics)}

Current Tasks:
${JSON.stringify(tasks)}

Recent History:
${JSON.stringify(history)}
      `,
    },
  ];
}