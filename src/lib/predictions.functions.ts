import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  summary: z.string().min(1).max(8000),
});

async function callAI(body: unknown) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");
  const maxRetries = 4;
  let delay = 1500;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "manual-fetch",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      if (attempt === maxRetries - 1) return { limited: true as const, message: "AI rate limit reached. Using forecast-only recommendations." };
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
      continue;
    }
    if (res.status === 402) return { limited: true as const, message: "AI credits exhausted. Using forecast-only recommendations." };
    if (!res.ok) throw new Error(`AI gateway error: ${res.status}`);
    return res.json();
  }
  return { limited: true as const, message: "AI rate limit reached. Using forecast-only recommendations." };
}

function extractNumber(summary: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = summary.match(new RegExp(`${escaped}:\\s*([0-9]+)`, "i"));
  return match ? Number(match[1]) : null;
}

function buildForecastRecommendations(summary: string) {
  const next7 = extractNumber(summary, "Next 7 days forecast");
  const next30 = extractNumber(summary, "Next 30 days forecast");
  const busiestMatch = summary.match(/Busiest predicted department:\s*([^(.]+).*?~([0-9]+)/i);
  const peakMatch = summary.match(/Peak day-of-week:\s*([A-Za-z]+)/i);
  const risingMatch = summary.match(/Rising categories:\s*([^.]*)\./i);
  const surgeMatch = summary.match(/Surge days predicted:\s*([0-9]+)/i);

  const recs: string[] = [];
  if (next7 != null) recs.push(`Staff for approximately ${next7} tickets over the next 7 days.`);
  if (next30 != null) recs.push(`Plan monthly support capacity around roughly ${next30} forecasted tickets.`);
  if (busiestMatch) recs.push(`Prioritize ${busiestMatch[1].trim()} coverage because it is forecasted at about ${busiestMatch[2]} tickets next month.`);
  if (risingMatch && !/no major/i.test(risingMatch[0])) recs.push(`Review workload drivers in rising categories: ${risingMatch[1].trim()}.`);
  if (peakMatch) recs.push(`Schedule extra triage coverage on ${peakMatch[1]} based on historical seasonality.`);
  if (surgeMatch && Number(surgeMatch[1]) > 0) recs.push(`Prepare a surge response plan for ${surgeMatch[1]} predicted high-volume day${Number(surgeMatch[1]) === 1 ? "" : "s"}.`);

  return recs.slice(0, 6);
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
    if ("limited" in json) {
      return { recommendations: buildForecastRecommendations(data.summary), warning: json.message };
    }
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
