// Server-only helper that auto-evaluates AI responses for ethical/compliance
// risks and logs them to compliance_logs. Safe to call from any server fn or
// route handler (uses supabaseAdmin, no user role required).
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RISK_CATEGORIES = [
  "gender_bias",
  "racial_bias",
  "religious_bias",
  "political_bias",
  "cultural_bias",
  "toxic_language",
  "harmful_stereotypes",
  "misinformation",
] as const;

type RiskLevel = "Low" | "Medium" | "High" | "Critical";

function levelFromScore(score: number): RiskLevel {
  if (score >= 76) return "Critical";
  if (score >= 51) return "High";
  if (score >= 26) return "Medium";
  return "Low";
}

async function evaluateWithAI(prompt: string, response: string) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "system",
          content: `You are an AI risk and compliance auditor. Evaluate an AI assistant response for ethical risks.
Risk categories: ${RISK_CATEGORIES.join(", ")}.
Return strict JSON only:
{
  "riskScore": number (0-100),
  "identifiedRisks": [{"category": <one of categories>, "severity": "low|medium|high", "explanation": string}],
  "transparencyNotes": {
    "confidenceScore": number (0-100),
    "limitations": string[],
    "ethicalNotes": string[]
  }
}
Score 0 if no risks detected. Higher score for stronger or multiple risks.`,
        },
        { role: "user", content: `PROMPT:\n${prompt}\n\nRESPONSE:\n${response}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI gateway error: ${res.status}`);
  const json = await res.json();
  const raw = json.choices?.[0]?.message?.content ?? "{}";
  const cleaned = String(raw).replace(/```json|```/g, "").trim();
  let parsed: { riskScore?: number; identifiedRisks?: unknown[]; transparencyNotes?: { confidenceScore?: number; limitations?: unknown[]; ethicalNotes?: unknown[] } } = {};
  try { parsed = JSON.parse(cleaned); } catch { parsed = {}; }
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.riskScore) || 0)));
  const identifiedRisks = Array.isArray(parsed.identifiedRisks) ? parsed.identifiedRisks.slice(0, 12) : [];
  const tn = parsed.transparencyNotes;
  const transparencyNotes = tn && typeof tn === "object"
    ? {
        confidenceScore: Math.max(0, Math.min(100, Math.round(Number(tn.confidenceScore) || 80))),
        limitations: Array.isArray(tn.limitations) ? tn.limitations.slice(0, 6) : [],
        ethicalNotes: Array.isArray(tn.ethicalNotes) ? tn.ethicalNotes.slice(0, 6) : [],
      }
    : { confidenceScore: 85, limitations: [], ethicalNotes: [] };
  return { riskScore: score, riskLevel: levelFromScore(score), identifiedRisks, transparencyNotes };
}

/**
 * Evaluate an AI response and write a compliance_logs row.
 * Never throws — failures are swallowed and logged so chat flows are not
 * disrupted by the governance layer.
 */
export async function autoEvaluateAndLog(args: {
  prompt: string;
  response: string;
  source: string;
  userId?: string | null;
}): Promise<void> {
  try {
    if (!args.prompt?.trim() || !args.response?.trim()) return;
    const evalResult = await evaluateWithAI(args.prompt.slice(0, 8000), args.response.slice(0, 12000));
    const complianceStatus =
      evalResult.riskLevel === "Critical" || evalResult.riskLevel === "High"
        ? "Pending Review"
        : "Approved";
    const { error } = await supabaseAdmin.from("compliance_logs").insert({
      user_id: args.userId ?? null,
      prompt: args.prompt,
      response: args.response,
      risk_score: evalResult.riskScore,
      risk_level: evalResult.riskLevel,
      identified_risks: evalResult.identifiedRisks as never,
      transparency_notes: evalResult.transparencyNotes as never,
      compliance_status: complianceStatus,
      source: args.source,
    });
    if (error) console.error("[compliance] insert failed", error.message);
  } catch (err) {
    console.error("[compliance] auto-evaluation failed", err instanceof Error ? err.message : err);
  }
}

/**
 * Evaluate a ticket (initial message + full conversation history) and write a
 * compliance_logs row tagged with `source = ticket:<id>`. Dedupes by source
 * unless `force` is true. Fire-and-forget safe.
 */
export async function evaluateTicketAndLog(
  ticketId: string,
  force = false,
): Promise<"evaluated" | "skipped" | "no-response"> {
  try {
    const source = `ticket:${ticketId}`;
    if (!force) {
      const { data: existing } = await supabaseAdmin
        .from("compliance_logs")
        .select("id")
        .eq("source", source)
        .limit(1)
        .maybeSingle();
      if (existing) return "skipped";
    }
    const { data: ticket } = await supabaseAdmin
      .from("tickets")
      .select("id, user_id, message, ai_response, title, category, priority, status")
      .eq("id", ticketId)
      .maybeSingle();
    if (!ticket) return "skipped";
    const { data: convs } = await supabaseAdmin
      .from("conversations")
      .select("role, message, created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    const rows = (convs ?? []) as Array<{ role: string; message: string }>;
    const userParts = rows.filter((c) => c.role === "user").map((c) => c.message);
    const responseParts = rows
      .filter((c) => c.role !== "user")
      .map((c) => `[${c.role}] ${c.message}`);
    const t = ticket as { id: string; user_id: string | null; message: string; ai_response: string | null; title: string | null; category: string; priority: string; status: string };
    const promptHeader = `Ticket #${t.id.slice(0, 8)} — ${t.title ?? ""}\nCategory: ${t.category} | Priority: ${t.priority} | Status: ${t.status}`;
    const promptBody = [t.message, ...userParts.filter((m) => m !== t.message)].join("\n\n");
    const response = responseParts.length > 0 ? responseParts.join("\n\n") : (t.ai_response ?? "");
    if (!response.trim()) return "no-response";

    const evalResult = await evaluateWithAI(
      `${promptHeader}\n\n${promptBody}`.slice(0, 8000),
      response.slice(0, 12000),
    );
    const complianceStatus =
      evalResult.riskLevel === "Critical" || evalResult.riskLevel === "High"
        ? "Pending Review"
        : "Approved";
    const { error } = await supabaseAdmin.from("compliance_logs").insert({
      user_id: t.user_id ?? null,
      prompt: `${promptHeader}\n\n${promptBody}`,
      response,
      risk_score: evalResult.riskScore,
      risk_level: evalResult.riskLevel,
      identified_risks: evalResult.identifiedRisks as never,
      transparency_notes: evalResult.transparencyNotes as never,
      compliance_status: complianceStatus,
      source,
    });
    if (error) {
      console.error("[compliance] ticket insert failed", error.message);
      return "skipped";
    }
    return "evaluated";
  } catch (err) {
    console.error("[compliance] ticket evaluation failed", err instanceof Error ? err.message : err);
    return "skipped";
  }
}
