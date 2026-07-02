// Server-only helper that auto-evaluates every message (user, AI, admin) for
// ethical/compliance risks and writes a row into compliance_logs. All chat
// surfaces remain untouched — governance data is visible only inside the
// AI Governance & Compliance page.
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
  "privacy_violation",
  "policy_violation",
] as const;

type RiskLevel = "Low" | "Medium" | "High" | "Critical";
type StatusLabel = "Safe" | "Warning" | "High Risk" | "Critical";
type ActionTaken = "Passed" | "Flagged" | "Escalated" | "Blocked";
export type Sender = "User" | "AI" | "Admin";

function levelFromScore(score: number): RiskLevel {
  if (score >= 76) return "Critical";
  if (score >= 51) return "High";
  if (score >= 26) return "Medium";
  return "Low";
}

function statusFromScore(score: number): StatusLabel {
  if (score >= 76) return "Critical";
  if (score >= 51) return "High Risk";
  if (score >= 26) return "Warning";
  return "Safe";
}

function actionFromScore(score: number): ActionTaken {
  if (score >= 90) return "Blocked";
  if (score >= 60) return "Escalated";
  if (score >= 26) return "Flagged";
  return "Passed";
}

type Evaluation = {
  riskScore: number;
  riskLevel: RiskLevel;
  identifiedRisks: Array<{ category?: string; severity?: string; explanation?: string }>;
  transparencyNotes: { confidenceScore: number; limitations: string[]; ethicalNotes: string[] };
  sentiment: string;
  piiDetected: string[];
  explanation: string;
};

async function evaluateWithAI(sender: Sender, message: string, contextText: string): Promise<Evaluation> {
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
          content: `You are an AI risk & compliance auditor for an enterprise ticketing system.
Analyze the single MESSAGE below (written by ${sender}) inside the given CONTEXT.
Analyse every message, even completely safe ones.
Return STRICT JSON only, no prose, no markdown fences:
{
  "riskScore": number 0-100,
  "identifiedRisks": [ { "category": one of [${RISK_CATEGORIES.join(", ")}], "severity": "low"|"medium"|"high", "explanation": string } ],
  "sentiment": "positive" | "neutral" | "negative" | "frustrated" | "angry" | "professional",
  "piiDetected": array of strings such as "email","phone","ssn","credit_card","address","national_id","dob","passport" (empty if none),
  "explanation": one short sentence explaining the score,
  "transparencyNotes": { "confidenceScore": 0-100, "limitations": string[], "ethicalNotes": string[] }
}
Score 0 for benign safe messages. Increase for bias, toxicity, misinformation, harassment, PII leaks, policy violations.`,
        },
        { role: "user", content: `CONTEXT:\n${contextText || "(no prior context)"}\n\nMESSAGE (${sender}):\n${message}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`AI gateway error: ${res.status}`);
  const json = await res.json();
  const raw = json.choices?.[0]?.message?.content ?? "{}";
  const cleaned = String(raw).replace(/```json|```/g, "").trim();
  let parsed: Partial<Evaluation> & { transparencyNotes?: Partial<Evaluation["transparencyNotes"]> } = {};
  try { parsed = JSON.parse(cleaned); } catch { parsed = {}; }

  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.riskScore) || 0)));
  const identifiedRisks = Array.isArray(parsed.identifiedRisks) ? parsed.identifiedRisks.slice(0, 12) : [];
  const piiDetected = Array.isArray(parsed.piiDetected)
    ? parsed.piiDetected.map((s) => String(s)).slice(0, 10)
    : [];
  const sentiment = typeof parsed.sentiment === "string" ? parsed.sentiment : "neutral";
  const explanation = typeof parsed.explanation === "string" ? parsed.explanation.slice(0, 1000) : "";
  const tn = parsed.transparencyNotes;
  const transparencyNotes = tn && typeof tn === "object"
    ? {
        confidenceScore: Math.max(0, Math.min(100, Math.round(Number(tn.confidenceScore) || 80))),
        limitations: Array.isArray(tn.limitations) ? (tn.limitations as string[]).slice(0, 6) : [],
        ethicalNotes: Array.isArray(tn.ethicalNotes) ? (tn.ethicalNotes as string[]).slice(0, 6) : [],
      }
    : { confidenceScore: 85, limitations: [], ethicalNotes: [] };

  return {
    riskScore: score,
    riskLevel: levelFromScore(score),
    identifiedRisks,
    transparencyNotes,
    sentiment,
    piiDetected,
    explanation,
  };
}

function preview(text: string, n = 240) {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export type EvaluateMessageArgs = {
  sender: Sender;
  message: string;
  ticketId?: string | null;
  conversationId?: string | null;
  userId?: string | null;
  contextText?: string;
  source?: string;
};

/**
 * Evaluate a single message and insert one governance log row.
 * Fire-and-forget safe: never throws.
 */
export async function evaluateMessageAndLog(args: EvaluateMessageArgs): Promise<void> {
  try {
    const msg = (args.message ?? "").trim();
    if (!msg) return;

    // Dedupe: don't double-log the same conversation message.
    if (args.conversationId) {
      const { data: existing } = await supabaseAdmin
        .from("compliance_logs")
        .select("id")
        .eq("conversation_id", args.conversationId)
        .limit(1)
        .maybeSingle();
      if (existing) return;
    }

    const evalResult = await evaluateWithAI(
      args.sender,
      msg.slice(0, 12000),
      (args.contextText ?? "").slice(0, 8000),
    );

    const statusLabel = statusFromScore(evalResult.riskScore);
    const actionTaken = actionFromScore(evalResult.riskScore);
    const complianceStatus =
      evalResult.riskLevel === "Critical" || evalResult.riskLevel === "High"
        ? "Pending Review"
        : "Approved";

    const source = args.source ?? `chat:${args.sender.toLowerCase()}`;
    const insertPayload: Record<string, unknown> = {
      user_id: args.userId ?? null,
      ticket_id: args.ticketId ?? null,
      conversation_id: args.conversationId ?? null,
      sender: args.sender,
      message_preview: preview(msg),
      prompt: args.contextText ?? null,
      response: msg,
      risk_score: evalResult.riskScore,
      risk_level: evalResult.riskLevel,
      status_label: statusLabel,
      action_taken: actionTaken,
      sentiment: evalResult.sentiment,
      pii_detected: evalResult.piiDetected as never,
      identified_risks: evalResult.identifiedRisks as never,
      transparency_notes: evalResult.transparencyNotes as never,
      governance_explanation: evalResult.explanation,
      compliance_status: complianceStatus,
      source,
    };

    const { error } = await supabaseAdmin.from("compliance_logs").insert(insertPayload as never);
    if (error) console.error("[compliance] insert failed", error.message);
  } catch (err) {
    console.error("[compliance] evaluation failed", err instanceof Error ? err.message : err);
  }
}

/**
 * Legacy wrapper kept for compatibility. Logs the AI response as an AI message
 * with the prompt as context.
 */
export async function autoEvaluateAndLog(args: {
  prompt: string;
  response: string;
  source: string;
  userId?: string | null;
  ticketId?: string | null;
}): Promise<void> {
  await evaluateMessageAndLog({
    sender: "AI",
    message: args.response,
    contextText: args.prompt,
    userId: args.userId,
    ticketId: args.ticketId ?? null,
    source: args.source,
  });
}

type Msg = { id: string; role: string; message: string; created_at: string };

function inferSender(role: string, isAgentAuthored?: boolean): Sender {
  if (role === "user") return "User";
  if (isAgentAuthored) return "Admin";
  return "AI";
}

/**
 * Re-evaluate every message on a ticket. Used by the backfill button.
 * With `force = false`, messages that already have a log row are skipped.
 * With `force = true`, all existing per-message logs for this ticket are
 * removed and every message is re-evaluated from scratch.
 */
export async function evaluateTicketAndLog(
  ticketId: string,
  force = false,
): Promise<"evaluated" | "skipped" | "no-response"> {
  try {
    const { data: ticket } = await supabaseAdmin
      .from("tickets")
      .select("id, user_id, message")
      .eq("id", ticketId)
      .maybeSingle();
    if (!ticket) return "skipped";

    const { data: convs } = await supabaseAdmin
      .from("conversations")
      .select("id, role, message, created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true });
    const rows = (convs ?? []) as Msg[];

    // If force, wipe existing per-conversation logs for this ticket so we
    // re-evaluate cleanly. Aggregate ticket-level logs (no conversation_id)
    // are also cleared so the dashboard reflects only per-message rows.
    if (force) {
      await supabaseAdmin.from("compliance_logs").delete().eq("ticket_id", ticketId);
    }

    let evaluated = 0;

    // Some deployments may have a ticket.message without a corresponding
    // conversations row for the very first user message — evaluate it too
    // when no matching conversation row exists.
    const t = ticket as { id: string; user_id: string | null; message: string };
    const firstUserRow = rows.find((r) => r.role === "user" && r.message === t.message);
    if (!firstUserRow && t.message?.trim()) {
      await evaluateMessageAndLog({
        sender: "User",
        message: t.message,
        ticketId: t.id,
        userId: t.user_id,
        source: "ticket:initial",
      });
      evaluated++;
    }

    let context = "";
    for (const r of rows) {
      const sender: Sender = r.role === "user" ? "User" : "AI";
      await evaluateMessageAndLog({
        sender,
        message: r.message,
        ticketId: t.id,
        conversationId: r.id,
        userId: t.user_id,
        contextText: context,
        source: `ticket:${r.role}`,
      });
      context = `${context}\n[${sender}] ${r.message}`.slice(-4000);
      evaluated++;
    }

    return evaluated > 0 ? "evaluated" : "no-response";
  } catch (err) {
    console.error("[compliance] ticket evaluation failed", err instanceof Error ? err.message : err);
    return "skipped";
  }
}
