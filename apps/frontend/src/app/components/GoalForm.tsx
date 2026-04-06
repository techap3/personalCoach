"use client";

import { useState } from "react";
import { PlanResponse } from "@/types/plan";

export default function GoalForm({
  onPlanGenerated,
  token,
}: {
  onPlanGenerated: (data: PlanResponse) => void;
  token: string | undefined;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

  const createGoal = async () => {
    if (!title || !BASE_URL || !token) {
      console.warn("Missing data", { title, BASE_URL, token });
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${BASE_URL}/goals`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title, description }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error("❌ Backend error:", err);
        return;
      }

      const data = await res.json();

      onPlanGenerated(data.plan);

    } catch (err) {
      console.error("❌ Goal creation failed:", err);
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return <div className="text-center mt-10">Waiting for auth...</div>;
  }

  return (
    <div className="max-w-md mx-auto mt-10 border p-4 rounded bg-white shadow">
      <h2 className="text-xl font-semibold mb-2">Create a Goal</h2>

      <input
        data-testid="goal-title-input"
        className="border p-2 rounded w-full mb-2"
        placeholder="Goal (e.g. Get fit)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <textarea
        data-testid="goal-description-input"
        className="border p-2 rounded w-full mb-2"
        placeholder="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <button
        data-testid="generate-plan-button"
        className="bg-blue-600 text-white p-2 rounded w-full mb-2"
        onClick={createGoal}
        disabled={loading}
      >
        {loading ? "Generating..." : "Generate Plan"}
      </button>

      {/* {(goalId || localGoalId) && (
        <button
          className="bg-green-600 text-white p-2 rounded w-full"
          onClick={generateTasks}
          disabled={loading}
        >
          {loading ? "Generating..." : "Generate Tasks (once)"}
        </button>
      )} */}
    </div>
  );
}