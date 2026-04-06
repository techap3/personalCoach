export async function runProgressionEngine(supabase: any, goalId: string): Promise<boolean> {
  console.log("⚙️ ENGINE START", { goalId });
  console.log("RUNNING PROGRESSION ENGINE:", goalId);

  const { data: activeStep } = await supabase
    .from("plan_steps")
    .select("*")
    .eq("goal_id", goalId)
    .eq("status", "active")
    .maybeSingle();

  console.log("🧩 ACTIVE STEP:", activeStep);

  if (!activeStep) {
    throw new Error("NO ACTIVE STEP FOUND");
  }

  const { data: sessions } = await supabase
    .from("task_sessions")
    .select("*")
    .eq("plan_step_id", activeStep.id)
    .order("created_at", { ascending: false })
    .limit(3);

  console.log("📦 SESSIONS:", sessions);

  if (!sessions || sessions.length === 0) {
    console.log("NO SESSIONS YET");
    return false;
  }

  const sessionIds = sessions.map((s: any) => s.id);

  const { data: tasks } = await supabase
    .from("tasks")
    .select("*")
    .in("session_id", sessionIds);

  console.log("📋 TASKS:", tasks);

  if (!tasks || tasks.length === 0) {
    console.log("NO TASKS FOUND");
    return false;
  }

  const pendingTasks = tasks.filter((t: any) => t.status === "pending");

  console.log("📊 TASK STATUS:", {
    total: tasks.length,
    done: tasks.filter((t: any) => t.status === "done").length,
    skipped: tasks.filter((t: any) => t.status === "skipped").length,
    pending: pendingTasks.length,
  });

  if (pendingTasks.length > 0) {
    console.log("⛔ STEP NOT COMPLETE (pending tasks exist)");
    return false;
  }

  console.log("✅ ALL TASKS RESOLVED → COMPLETE STEP");

  console.log("✅ STEP COMPLETED", activeStep.id);
  console.log("COMPLETING STEP:", activeStep.id);

  await supabase
    .from("plan_steps")
    .update({ status: "completed" })
    .eq("id", activeStep.id);

  const { data: nextStep } = await supabase
    .from("plan_steps")
    .select("*")
    .eq("goal_id", goalId)
    .gt("step_index", activeStep.step_index)
    .order("step_index", { ascending: true })
    .limit(1)
    .maybeSingle();

  console.log("➡️ NEXT STEP:", nextStep);

  if (nextStep) {
    await supabase
      .from("plan_steps")
      .update({ status: "active" })
      .eq("id", nextStep.id);

    console.log("NEXT STEP ACTIVATED:", nextStep.id);
  } else {
    console.log("PLAN COMPLETE");
  }

  return true;
}
