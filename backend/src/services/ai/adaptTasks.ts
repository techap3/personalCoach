import { getAIClient } from "./provider";
import { buildTaskAdaptationPrompt } from "./prompts";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export async function generateAdaptedTasks(input: {
  tasks: any[];
  metrics: {
    completionRate: number;
    done: number;
    skipped: number;
  };
  history: any[];
}) {
  const client = getAIClient();

  const model =
    process.env.AI_MODEL || "meta-llama/llama-3-8b-instruct";

  const messages: ChatCompletionMessageParam[] =
    buildTaskAdaptationPrompt(input);

  const response = await client.chat.completions.create({
    model,
    messages,
    temperature: 0.7,
  });

  const raw = response.choices[0]?.message?.content || "";

  console.log("🧠 Task Adapt RAW:", raw);

  // 🔥 ROBUST JSON EXTRACTION
  const parsed = extractJSON(raw);

  console.log("✅ Parsed JSON:", parsed);

  return parsed;
}

// ✅ BULLETPROOF JSON EXTRACTOR
function extractJSON(text: string) {
  try {
    // find first {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");

    if (start === -1 || end === -1) {
      throw new Error("No JSON found in response");
    }

    let jsonString = text.slice(start, end + 1);

    // 🔥 Fix common LLM issues
    jsonString = jsonString
      .replace(/[\u201C\u201D]/g, '"') // smart quotes
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\n/g, " ")
      .trim();

    return JSON.parse(jsonString);
  } catch (err) {
    console.error("❌ JSON extraction failed");
    console.error("RAW:", text);
    throw err;
  }
}