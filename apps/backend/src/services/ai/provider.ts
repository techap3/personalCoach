import OpenAI from "openai";

export function getAIClient() {
  const provider = process.env.AI_PROVIDER;

  if (provider === "openrouter") {
    return new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });
  }

  // fallback (future: OpenAI)
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}