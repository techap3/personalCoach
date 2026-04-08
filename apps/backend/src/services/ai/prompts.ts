import { ChatCompletionMessageParam } from "openai/resources/chat";
import { PlanResponse } from "./parser";

function getTopSkipCategories(memory: any, limit = 2) {
  const pattern = (memory?.skip_pattern || {}) as Record<string, number>;
  return Object.entries(pattern)
    .filter(([category, count]) => category !== "general" && Number(count) > 0)
    .sort((left, right) => Number(right[1]) - Number(left[1]))
    .slice(0, limit)
    .map(([category]) => category);
}

function getConsistencyLabel(score: unknown) {
  if (score === null || score === undefined) return "medium";
  const value = Number(score);
  if (!Number.isFinite(value)) return "medium";
  if (value < 0.34) return "low";
  if (value < 0.67) return "medium";
  return "high";
}

function hasFiniteMemorySignal(memory: any, field: string) {
  if (!memory || typeof memory !== "object") return false;
  const value = memory[field];
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

export function buildTendencySummary(memory: any) {
  if (!memory || typeof memory !== "object") {
    return "";
  }

  const hasCompletionRate = hasFiniteMemorySignal(memory, "avg_completion_rate");
  const hasPreferredDifficulty = hasFiniteMemorySignal(memory, "preferred_difficulty");
  const hasConsistency = hasFiniteMemorySignal(memory, "consistency_score");
  const topSkipCategories = getTopSkipCategories(memory, 2);
  const hasSkipSignal = topSkipCategories.length > 0;

  if (!hasCompletionRate && !hasPreferredDifficulty && !hasConsistency && !hasSkipSignal) {
    return "";
  }

  const lines: string[] = [];
  if (hasCompletionRate) {
    const completionRate = Number(memory.avg_completion_rate);
    lines.push(`- Avg completion rate: ${(completionRate * 100).toFixed(0)}%`);
  }

  if (hasPreferredDifficulty) {
    const preferredDifficulty = Number(memory.preferred_difficulty);
    lines.push(`- Preferred difficulty (1=easy, 2=medium, 3=hard): ${preferredDifficulty}`);
  }

  if (hasSkipSignal) {
    lines.push(`- High skip categories: ${topSkipCategories.join(", ")}`);
  }

  if (hasConsistency) {
    const consistency = getConsistencyLabel(memory.consistency_score);
    lines.push(`- Consistency: ${consistency}`);
  }

  if (!lines.length) {
    return "";
  }

  return lines.join("\n");
}

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

Convert a long-term plan into 3-5 SMALL, actionable tasks for TODAY.

RULES:
- Return between 3 and 5 tasks
- Tasks must be doable in 30-60 minutes
- Be SPECIFIC (avoid vague wording)
- DO NOT repeat plan steps directly
- Focus on execution, not planning
- Keep tasks realistic for a beginner
- Prioritize quality over quantity
- Each task MUST explicitly reference the user goal or a goal synonym (goal/objective/target/milestone/project)
- Assign each task a task_type from: action, learn, reflect, review, plan
- Ensure at least 1 action task
- Ensure at least 1 reflect OR review task
- Ensure at least 1 plan task
- Avoid clustering all tasks into the same task_type

Return ONLY JSON:

{
  "tasks": [
    {
      "title": "string",
      "description": "string",
      "difficulty": number (1-5),
      "task_type": "action" | "learn" | "reflect" | "review" | "plan"
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

export function buildStepTaskPrompt(step: {
  title: string;
  description: string;
  difficulty: number;
}, previousTasks: string[] = [], memory?: any, desiredCount?: number, goalContext?: string, difficultyMode: "easy" | "medium" | "hard" = "medium"): ChatCompletionMessageParam[] {
  const hasExplicitDesiredCount =
    typeof desiredCount === "number" && Number.isFinite(desiredCount);
  const targetCount = hasExplicitDesiredCount
    ? Math.max(1, Math.round(desiredCount))
    : 3;
  const priorTasksContext = previousTasks.length
    ? previousTasks.map((task) => `- ${task}`).join("\n")
    : "- none";

  const tendencySummary = buildTendencySummary(memory);
  const tendencyBlock = tendencySummary
    ? `\n\nUser tendencies:\n${tendencySummary}`
    : "";
  const desiredCountHint =
    typeof desiredCount === "number" && Number.isFinite(desiredCount)
      ? `\nPreferred task count for this request: ${Math.round(desiredCount)}`
      : "";
  const safeGoalContext = (goalContext || "your goal").trim() || "your goal";
  const modeRules =
    difficultyMode === "easy"
      ? `
DIFFICULTY MODE: EASY
- Each task MUST be exactly 1 step
- Each task MUST be completable in 5-10 minutes
- Do NOT use planning words: plan, analyze, decide
- Keep thinking load low and execution immediate

EASY EXAMPLES:
- "Write 1 blocker for [goal]"
- "Spend 10 minutes working on [goal]"
`
      : difficultyMode === "hard"
      ? `
DIFFICULTY MODE: HARD
- Tasks can be 2-3 steps
- Each task should target deeper work (30-60 minutes)
- Every task MUST include at least one of:
  decision making OR
  creation OR
  multi-step execution

HARD EXAMPLES:
- "Implement a small feature for [goal] and test it"
- "Analyze 3 issues and decide the best fix"
`
      : `
DIFFICULTY MODE: MEDIUM
- Tasks may include 1-2 steps
- Each task should use moderate thinking (10-30 minutes)
- Keep scope practical and concrete

MEDIUM EXAMPLES:
- "Write 3 blockers and pick 1 to solve"
- "Plan next 2 steps for [goal]"
`;

  return [
    {
      role: "system",
      content: `
You are an intelligent personal coach.

Convert ONE plan step into ${hasExplicitDesiredCount ? `exactly ${targetCount}` : "between 3 and 5"} SMALL, actionable tasks for TODAY.

RULES:
- Return ${hasExplicitDesiredCount ? `exactly ${targetCount}` : "between 3 and 5"} tasks
- Each task MUST be specific and actionable
- Each task MUST include a clear action the user can start immediately
- Each task MUST be completable in 10-60 minutes
- Each task MUST produce a visible outcome (written note, code change, decision, list, summary)
- Each task MUST explicitly reference the user goal or a goal synonym (goal/objective/target/milestone/project)
- If a specific goal context is provided, include it naturally in each task title or description
- Focus entirely on executing THIS step
- Keep tasks realistic for a beginner
- Prioritize quality over quantity
- Do not repeat or closely resemble previous tasks provided by the user context
- Assign each task a task_type from: action, learn, reflect, review, plan
- Ensure at least 1 action task
- Ensure at least 1 reflect OR review task
- Ensure at least 1 plan task
- Avoid clustering all tasks into the same task_type
- Do NOT generate vague tasks like "Work on X", "Think about X", or "Explore X"
- Do NOT use placeholders like "Task A" or "Task B"
- Prefer concrete verbs: write, list, build, implement, review, analyze, fix, create, plan, summarize

${modeRules}

EXAMPLES:
BAD: "Work on your goal"
BAD: "Think about improvements"
GOOD: "Write down 3 blockers preventing progress on your goal"
GOOD: "Implement one small feature and test it locally"
GOOD: "Write 3 blockers stopping progress on [goal] and pick 1 to solve"
GOOD: "Implement a small part of [goal] and test it"
GOOD: "List 2 mistakes made while working on [goal] and how to fix them"
GOOD: "Plan the next 2 steps needed to move forward in [goal]"

Return ONLY JSON:

{
  "tasks": [
    {
      "title": "string",
      "description": "string",
      "difficulty": number (1-5),
      "task_type": "action" | "learn" | "reflect" | "review" | "plan"
    }
  ]
}
      `,
    },
    {
      role: "user",
      content: `Goal context: ${safeGoalContext}\nStep: ${step.title}\nDescription: ${step.description}\nTarget difficulty: ${step.difficulty} (1-5 scale)${tendencyBlock}${desiredCountHint}\n\nPrevious tasks to avoid repeating:\n${priorTasksContext}`,
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

OUTPUT FORMAT (NON-NEGOTIABLE):
- Return ONLY valid JSON.
- Do NOT include explanations.
- Do NOT include markdown.
- Do NOT include backticks.
- Output must start with { and end with }.

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
- Modify step titles to reflect improvements
- Ensure changes are noticeable to the user

STRICT DIFFICULTY RULES:
- If completionRate > 0.8 → difficulty MUST be between 3–5
- If completionRate < 0.4 → difficulty MUST be between 1–2
- Otherwise → difficulty MUST be between 2–3

Do NOT ignore these rules.

Return ONLY valid JSON in this exact shape:

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
  memory,
}: any) {
  const tendencySummary = buildTendencySummary(memory);
  const tendencyBlock = tendencySummary
    ? `User tendencies:\n${tendencySummary}\n\n`
    : "";

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
- Tasks must be specific, actionable, and time-bound
- Avoid vague or generic suggestions
- Each task should take ~10–45 minutes
- DO NOT repeat tasks from history
- DO NOT rephrase the same task — change approach

---

PERSONALIZATION (VERY IMPORTANT):
- Use user memory to guide decisions
- preferred_difficulty = target difficulty level
- skip_rate > 0.5 → significantly reduce effort
- avg_completion_rate > 0.8 → increase challenge
- If user skips often → change TYPE of task (not just difficulty)

---

BEHAVIOR RULES:

1. FIRST-TIME USER (tasks_done == 0):
- Keep tasks meaningful but beginner-friendly
- Focus on momentum, not triviality

2. LOW COMPLETION (< 0.4):
- Reduce complexity slightly
- Break tasks into smaller chunks

3. HIGH COMPLETION (> 0.8):
- Increase difficulty
- Add depth or duration

---

QUALITY RULES:
- Avoid generic tasks like "think", "explore"
- Prefer action verbs: write, build, try, list, practice
- Tasks should feel like real progress

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
${tendencyBlock}Metrics:
${JSON.stringify(metrics)}

Current Tasks:
${JSON.stringify(tasks)}

Recent History:
${JSON.stringify(history)}
      `,
    },
  ];
}