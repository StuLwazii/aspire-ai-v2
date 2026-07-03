import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { callAIWithRetry } from "@/lib/ai-retry.server";

const InputSchema = z.object({
  summary: z.string().min(1).max(8000),
});

async function callAI(body: unknown) {
  return (await callAIWithRetry(body, { fnName: "generatePredictiveRecommendations" })) as {
    choices: Array<{ message: { content?: string } }>;
  };
}

export const generatePredictiveRecommendations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ data }) => {
    const json = await callAI({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content:
            "You are an operations analyst for an employee support platform. Given a short statistical forecast summary, return 4-6 concise, actionable recommendations for managers. Each recommendation should be a single short sentence, business-tone, ideally referencing concrete percentages or departments from the summary. Respond as a JSON array of strings only.",
        },
        { role: "user", content: data.summary },
      ],
    });
    const raw = json.choices?.[0]?.message?.content ?? "[]";
    try {
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const arr = JSON.parse(cleaned);
      if (Array.isArray(arr)) return { recommendations: arr.filter((s) => typeof s === "string").slice(0, 6) };
    } catch {
      // fallback: split lines
    }
    return {
      recommendations: String(raw)
        .split(/\n+/)
        .map((s: string) => s.replace(/^[-*\d.\s]+/, "").trim())
        .filter(Boolean)
        .slice(0, 6),
    };
  });
