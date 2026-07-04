import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type GovStatus = "Safe" | "Warning" | "High Risk" | "Critical";
export type GovAction = "Passed" | "Flagged" | "Escalated" | "Blocked";
export type GovSender = "User" | "AI" | "Admin";
export type GovSentiment = "Positive" | "Neutral" | "Negative" | "Mixed";

export const CATEGORY_ENUM = [
  "harassment",
  "bias",
  "misinformation",
  "PII",
  "compliance violation",
] as const;

export const BIAS_TAXONOMY = [
  "Gender",
  "Race/Ethnicity",
  "Religion",
  "Political",
  "Age",
  "Disability",
  "Socioeconomic",
  "Other",
] as const;

function scoreToStatus(score: number): GovStatus {
  if (score <= 20) return "Safe";
  if (score <= 50) return "Warning";
  if (score <= 80) return "High Risk";
  return "Critical";
}

function statusToAction(status: GovStatus): GovAction {
  if (status === "Safe") return "Passed";
  if (status === "Warning") return "Flagged";
  if (status === "High Risk") return "Escalated";
  return "Blocked";
}

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

/* ------------------------------------------------------------------ */
/* AI analysis                                                        */
/* ------------------------------------------------------------------ */

type AnalysisResult = {
  risk_score: number;
  categories: string[];
  bias_categories: string[];
  sentiment: GovSentiment;
  pii_detected: string[];
  explanation: string;
};

async function analyzeMessage(message: string, sender: GovSender): Promise<AnalysisResult> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

  const preview = message.slice(0, 4000);
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        {
          role: "system",
          content:
            "You are an AI governance auditor. Evaluate a single message from a help-desk conversation for risk. Score 0-100 (0 = perfectly safe, 100 = severe violation). Consider harassment, bias, misinformation, PII exposure, and compliance/policy violations. Identify sentiment. Detect PII (emails, phone numbers, SSN-like patterns, addresses). Bias sub-categories (only when bias is present): Gender, Race/Ethnicity, Religion, Political, Age, Disability, Socioeconomic, Other. Return a concise 1-2 sentence explanation. ALWAYS call the tool, even if the message is completely safe (score 0, empty categories, brief 'No risk detected.' explanation).",
        },
        { role: "user", content: `Sender: ${sender}\nMessage:\n"""${preview}"""` },
      ],
      tools: [{
        type: "function",
        function: {
          name: "record_governance_analysis",
          description: "Record the governance evaluation of a single conversation message.",
          parameters: {
            type: "object",
            properties: {
              risk_score: { type: "integer", minimum: 0, maximum: 100 },
              categories: {
                type: "array",
                items: { type: "string", enum: [...CATEGORY_ENUM] },
              },
              bias_categories: {
                type: "array",
                items: { type: "string", enum: [...BIAS_TAXONOMY] },
              },
              sentiment: { type: "string", enum: ["Positive", "Neutral", "Negative", "Mixed"] },
              pii_detected: {
                type: "array",
                items: { type: "string" },
                description: "Types of PII found, e.g. 'email', 'phone', 'address', 'SSN'.",
              },
              explanation: { type: "string" },
            },
            required: ["risk_score", "categories", "bias_categories", "sentiment", "pii_detected", "explanation"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "record_governance_analysis" } },
    }),
  });

  if (!res.ok) {
    // graceful fallback so failures never break the chat pipeline
    return {
      risk_score: 0, categories: [], bias_categories: [], sentiment: "Neutral",
      pii_detected: [], explanation: `Analysis unavailable (gateway ${res.status}).`,
    };
  }
  const json = await res.json();
  const call = json.choices?.[0]?.message?.tool_calls?.[0];
  const args = call?.function?.arguments ? JSON.parse(call.function.arguments) : {};
  const rs = Math.max(0, Math.min(100, Number(args.risk_score ?? 0) | 0));
  return {
    risk_score: rs,
    categories: Array.isArray(args.categories) ? args.categories.filter((c: unknown) => typeof c === "string") : [],
    bias_categories: Array.isArray(args.bias_categories) ? args.bias_categories.filter((c: unknown) => typeof c === "string") : [],
    sentiment: (["Positive", "Neutral", "Negative", "Mixed"].includes(args.sentiment) ? args.sentiment : "Neutral") as GovSentiment,
    pii_detected: Array.isArray(args.pii_detected) ? args.pii_detected.filter((c: unknown) => typeof c === "string") : [],
    explanation: typeof args.explanation === "string" && args.explanation.trim() ? args.explanation.trim() : "No risk detected.",
  };
}

/* ------------------------------------------------------------------ */
/* Persistence                                                        */
/* ------------------------------------------------------------------ */

async function upsertLog(params: {
  conversationId: string | null;
  ticketId: string | null;
  sender: GovSender;
  message: string;
  analysis: AnalysisResult;
  createdAt?: string;
}) {
  const { conversationId, ticketId, sender, message, analysis, createdAt } = params;
  const status = scoreToStatus(analysis.risk_score);
  const action = statusToAction(status);
  const combinedRisks = [
    ...analysis.categories,
    ...analysis.bias_categories.map((b) => `bias:${b}`),
  ];
  const ts = (() => {
    if (!createdAt) return new Date().toISOString();
    const d = new Date(createdAt);
    // guard against corrupted future dates
    if (isNaN(d.getTime()) || d.getTime() > Date.now() + 5 * 60 * 1000) return new Date().toISOString();
    return d.toISOString();
  })();

  const row = {
    ticket_id: ticketId,
    conversation_id: conversationId,
    sender,
    message_preview: message.slice(0, 500),
    prompt: sender === "User" ? message.slice(0, 4000) : null,
    response: sender !== "User" ? message.slice(0, 4000) : null,
    risk_score: analysis.risk_score,
    risk_level: status,
    status_label: status,
    identified_risks: combinedRisks,
    sentiment: analysis.sentiment,
    pii_detected: analysis.pii_detected,
    governance_explanation: analysis.explanation,
    compliance_status: action,
    action_taken: action,
    source: "auto",
    created_at: ts,
  };

  if (conversationId) {
    // idempotent per conversation message
    const { error } = await supabaseAdmin
      .from("compliance_logs")
      .upsert(row as never, { onConflict: "conversation_id" });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabaseAdmin.from("compliance_logs").insert(row as never);
    if (error) throw new Error(error.message);
  }
}

/**
 * Fire-and-forget analysis. Never throws — governance work must not break
 * the chat or ticket pipeline. Safe to call after conversation inserts.
 */
export async function scheduleGovernanceAnalysis(params: {
  conversationId: string | null;
  ticketId: string | null;
  sender: GovSender;
  message: string;
  createdAt?: string;
}): Promise<void> {
  try {
    const analysis = await analyzeMessage(params.message, params.sender);
    await upsertLog({ ...params, analysis });
  } catch (err) {
    // Swallow — governance failures are silent by design.
    console.warn("[governance] analysis failed:", err instanceof Error ? err.message : err);
  }
}

/* ------------------------------------------------------------------ */
/* Admin server functions                                             */
/* ------------------------------------------------------------------ */

export const adminListGovernanceLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("compliance_logs")
      .select("id, ticket_id, conversation_id, sender, message_preview, risk_score, risk_level, status_label, identified_risks, sentiment, pii_detected, governance_explanation, action_taken, compliance_status, source, created_at")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminGovernanceStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("compliance_logs")
      .select("risk_score, risk_level, sender, identified_risks, compliance_status, created_at")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminEvaluateNewMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    // Conversations not yet logged
    const { data: convs } = await supabaseAdmin
      .from("conversations")
      .select("id, ticket_id, role, message, created_at")
      .order("created_at", { ascending: true })
      .limit(500);
    const { data: existing } = await supabaseAdmin
      .from("compliance_logs")
      .select("conversation_id")
      .not("conversation_id", "is", null);
    const seen = new Set((existing ?? []).map((r) => r.conversation_id as string));
    const pending = (convs ?? []).filter((c) => !seen.has(c.id));

    let processed = 0;
    for (const c of pending.slice(0, 50)) {
      const sender: GovSender = c.role === "user" ? "User" : "AI";
      await scheduleGovernanceAnalysis({
        conversationId: c.id,
        ticketId: c.ticket_id,
        sender,
        message: c.message,
        createdAt: c.created_at,
      });
      processed++;
    }
    return { processed, remaining: Math.max(0, pending.length - processed) };
  });

export const adminReevaluateAll = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ limit: z.number().int().min(1).max(200).default(50) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: convs } = await supabaseAdmin
      .from("conversations")
      .select("id, ticket_id, role, message, created_at")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    let processed = 0;
    for (const c of convs ?? []) {
      const sender: GovSender = c.role === "user" ? "User" : "AI";
      await scheduleGovernanceAnalysis({
        conversationId: c.id,
        ticketId: c.ticket_id,
        sender,
        message: c.message,
        createdAt: c.created_at,
      });
      processed++;
    }
    return { processed };
  });
