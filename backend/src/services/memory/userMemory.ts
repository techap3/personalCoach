import { getSupabaseClient } from "../../db/supabase";

export async function updateUserMemory(
  token: string,
  userId: string,
  metrics: any
) {
  const supabase = getSupabaseClient(token);

  const { data: existing } = await supabase
    .from("user_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  const done = metrics.done || 0;
  const skipped = metrics.skipped || 0;
  const total = metrics.total || 1;

  const completionRate = done / total;
  const skipRate = skipped / total;

  if (!existing) {
    await supabase.from("user_preferences").insert({
      user_id: userId,
      avg_completion_rate: completionRate,
      skip_rate: skipRate,
      preferred_difficulty: 2,
      total_tasks: total,
      total_completed: done,
      total_skipped: skipped,
    });

    return;
  }

  // 🔥 rolling averages
  const newTotalTasks = existing.total_tasks + total;
  const newCompleted = existing.total_completed + done;
  const newSkipped = existing.total_skipped + skipped;

  const newCompletionRate = newCompleted / newTotalTasks;
  const newSkipRate = newSkipped / newTotalTasks;

  // 🔥 derive difficulty preference
  let preferredDifficulty = existing.preferred_difficulty;

  if (newCompletionRate > 0.8) {
    preferredDifficulty = Math.min(preferredDifficulty + 0.5, 5);
  } else if (newCompletionRate < 0.4) {
    preferredDifficulty = Math.max(preferredDifficulty - 0.5, 1);
  }

  await supabase
    .from("user_preferences")
    .update({
      avg_completion_rate: newCompletionRate,
      skip_rate: newSkipRate,
      preferred_difficulty: preferredDifficulty,
      total_tasks: newTotalTasks,
      total_completed: newCompleted,
      total_skipped: newSkipped,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
}

export async function getUserMemory(token: string, userId: string) {
  const supabase = getSupabaseClient(token);

  const { data } = await supabase
    .from("user_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  return data;
}