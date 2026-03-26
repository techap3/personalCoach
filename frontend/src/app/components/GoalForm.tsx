"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { PlanResponse } from "@/types/plan";

export default function GoalForm({
  goalId,
  fetchTasks,
  onPlanGenerated,
  onTasksGenerated,
}: {
  goalId: string | null;
  fetchTasks: (goalId: string) => void;
  onPlanGenerated: (data: PlanResponse) => void;
  onTasksGenerated: (goalId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [localGoalId, setLocalGoalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ✅ Step 1: Create goal + generate plan
  const createGoal = async () => {
    if (!title) return;

    setLoading(true);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const res = await fetch("http://localhost:3001/goals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title, description }),
      });

      const data = await res.json();

      console.log("GOAL RESPONSE:", data);

      // store goalId locally (internal, for task generation path)
      setLocalGoalId(data.goal.id);

      // send plan to parent
      onPlanGenerated(data.plan);
    } catch (err) {
      console.error("Goal creation failed:", err);
    } finally {
      setLoading(false);
    }
  };

  // ✅ Step 2: Generate today's tasks
  const generateTasks = async () => {
    const effectiveGoalId = goalId || localGoalId;
    if (!effectiveGoalId) return;

    setLoading(true);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const res = await fetch("http://localhost:3001/tasks/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ goal_id: effectiveGoalId }),
      });

      await res.json(); // Ensure request completes

      // notify parent to fetch tasks from DB
      if (!effectiveGoalId) throw new Error("Goal ID missing after generation");

      onTasksGenerated(effectiveGoalId);
    } catch (err) {
      console.error("Task generation failed:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 max-w-md mx-auto mt-10">
      <h2 className="text-xl font-semibold">Create a Goal</h2>

      <input
        className="border p-2 rounded"
        placeholder="Goal (e.g. Get fit)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <textarea
        className="border p-2 rounded"
        placeholder="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <button
        className="bg-blue-600 text-white p-2 rounded disabled:opacity-50"
        onClick={createGoal}
        disabled={loading}
      >
        {loading ? "Generating..." : "Generate Plan"}
      </button>

      {(goalId || localGoalId) && (
        <button
          className="bg-green-600 text-white p-2 rounded disabled:opacity-50"
          onClick={generateTasks}
          disabled={loading}
        >
          {loading ? "Generating..." : "Generate Today's Tasks"}
        </button>
      )}

      {(goalId || localGoalId) && (
        <button
          className="bg-yellow-600 text-white p-2 rounded disabled:opacity-50 mt-2"
          onClick={() => {
            const effectiveGoalId = goalId || localGoalId;
            if (!effectiveGoalId) return;
            fetchTasks(effectiveGoalId);
          }}
          disabled={loading}
        >
          Refresh Tasks
        </button>
      )}
    </div>
  );
}