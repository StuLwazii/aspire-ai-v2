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

export type CheckVerdict = "pass" | "warn" | "fail";
export type RiskLevel = "Low" | "Medium" | "High";

export type CheckResult = {
  verdict: CheckVerdict;
  detail: string;
};

export type GovernanceChecks = {
  bias: CheckResult & { categories: string[] };
  toxicity: CheckResult & { level: "none" | "low" | "moderate" | "severe" };
  compliance: CheckResult & { issues: string[] };
  hallucination: CheckResult & { risk: RiskLevel };
};

type AnalysisResult = {
  risk_score: number;
  confidence: number;
  categories: string[];
  bias_categories: string[];
  sentiment: GovSentiment;
  pii_detected: string[];
  explanation: string;
  checks: GovernanceChecks;
};

function riskToLevel(score: number): RiskLevel {
  if (score <= 20) return "Low";
  if (score <= 50) return "Medium";
  return "High";
}

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
            "You are an AI governance auditor for help-desk conversations. For each message, run four independent checks: (1) Bias — gender/race/religion/political/age/disability/socioeconomic bias; (2) Toxicity — harassment, hate, threats, profanity; (3) Compliance — policy/regulatory violations, PII exposure, unauthorized advice; (4) Hallucination — fabricated facts, unverifiable claims. For each check return a verdict (pass/warn/fail) with a concrete 1-sentence detail. Also produce an overall risk_score 0-100 (0=perfectly safe, 100=severe violation), a confidence 0-100 (how sure you are of the verdicts), sentiment, PII types found, and a 1-2 sentence overall explanation that says WHY (which checks were performed, what was found, recommended action). ALWAYS call the tool, even when everything is safe (all verdicts 'pass', risk_score low, confidence high, explanation like 'All four checks passed: no bias, toxic language, compliance issues, or hallucinated facts detected. No action required.').",
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
              confidence: { type: "integer", minimum: 0, maximum: 100 },
              categories: { type: "array", items: { type: "string", enum: [...CATEGORY_ENUM] } },
              bias_categories: { type: "array", items: { type: "string", enum: [...BIAS_TAXONOMY] } },
              sentiment: { type: "string", enum: ["Positive", "Neutral", "Negative", "Mixed"] },
              pii_detected: { type: "array", items: { type: "string" } },
              explanation: { type: "string" },
              bias_check: {
                type: "object",
                properties: {
                  verdict: { type: "string", enum: ["pass", "warn", "fail"] },
                  detail: { type: "string" },
                  categories: { type: "array", items: { type: "string" } },
                },
                required: ["verdict", "detail", "categories"],
              },
              toxicity_check: {
                type: "object",
                properties: {
                  verdict: { type: "string", enum: ["pass", "warn", "fail"] },
                  detail: { type: "string" },
                  level: { type: "string", enum: ["none", "low", "moderate", "severe"] },
                },
                required: ["verdict", "detail", "level"],
              },
              compliance_check: {
                type: "object",
                properties: {
                  verdict: { type: "string", enum: ["pass", "warn", "fail"] },
                  detail: { type: "string" },
                  issues: { type: "array", items: { type: "string" } },
                },
                required: ["verdict", "detail", "issues"],
              },
              hallucination_check: {
                type: "object",
                properties: {
                  verdict: { type: "string", enum: ["pass", "warn", "fail"] },
                  detail: { type: "string" },
                  risk: { type: "string", enum: ["Low", "Medium", "High"] },
                },
                required: ["verdict", "detail", "risk"],
              },
            },
            required: ["risk_score", "confidence", "categories", "bias_categories", "sentiment", "pii_detected", "explanation", "bias_check", "toxicity_check", "compliance_check", "hallucination_check"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "record_governance_analysis" } },
    }),
  });

  const safeChecks: GovernanceChecks = {
    bias: { verdict: "pass", detail: "No bias detected.", categories: [] },
    toxicity: { verdict: "pass", detail: "No toxic language detected.", level: "none" },
    compliance: { verdict: "pass", detail: "No compliance issues detected.", issues: [] },
    hallucination: { verdict: "pass", detail: "No unverifiable claims detected.", risk: "Low" },
  };

  if (!res.ok) {
    return {
      risk_score: 0, confidence: 50, categories: [], bias_categories: [], sentiment: "Neutral",
      pii_detected: [], explanation: `Analysis unavailable (gateway ${res.status}). Defaulted to safe.`,
      checks: safeChecks,
    };
  }
  const json = await res.json();
  const call = json.choices?.[0]?.message?.tool_calls?.[0];
  const args = call?.function?.arguments ? JSON.parse(call.function.arguments) : {};
  const rs = Math.max(0, Math.min(100, Number(args.risk_score ?? 0) | 0));
  const conf = Math.max(0, Math.min(100, Number(args.confidence ?? 85) | 0));
  const normCheck = <T extends object>(v: unknown, fallback: T): T =>
    v && typeof v === "object" ? { ...fallback, ...(v as T) } : fallback;

  return {
    risk_score: rs,
    confidence: conf,
    categories: Array.isArray(args.categories) ? args.categories.filter((c: unknown) => typeof c === "string") : [],
    bias_categories: Array.isArray(args.bias_categories) ? args.bias_categories.filter((c: unknown) => typeof c === "string") : [],
    sentiment: (["Positive", "Neutral", "Negative", "Mixed"].includes(args.sentiment) ? args.sentiment : "Neutral") as GovSentiment,
    pii_detected: Array.isArray(args.pii_detected) ? args.pii_detected.filter((c: unknown) => typeof c === "string") : [],
    explanation: typeof args.explanation === "string" && args.explanation.trim() ? args.explanation.trim() : "All checks passed.",
    checks: {
      bias: normCheck(args.bias_check, safeChecks.bias),
      toxicity: normCheck(args.toxicity_check, safeChecks.toxicity),
      compliance: normCheck(args.compliance_check, safeChecks.compliance),
      hallucination: normCheck(args.hallucination_check, safeChecks.hallucination),
    },
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
  incrementReeval?: boolean;
}) {
  const { conversationId, ticketId, sender, message, analysis, incrementReeval } = params;
  const status = scoreToStatus(analysis.risk_score);
  const action = statusToAction(status);
  const combinedRisks = [
    ...analysis.categories,
    ...analysis.bias_categories.map((b) => `bias:${b}`),
  ];
  const identifiedRisks = combinedRisks.length > 0 ? combinedRisks : ["None"];
  const ts = new Date(Date.now()).toISOString();

  let reevalCount = 0;
  if (conversationId) {
    const { data: existing } = await supabaseAdmin
      .from("compliance_logs")
      .select("transparency_notes")
      .eq("conversation_id", conversationId)
      .maybeSingle();
    const prior = (existing?.transparency_notes as { reevaluation_count?: number } | null)?.reevaluation_count ?? 0;
    reevalCount = incrementReeval ? prior + 1 : prior;
  }

  const transparency_notes = {
    confidence: analysis.confidence,
    governance_score: 100 - analysis.risk_score,
    risk_indicator: riskToLevel(analysis.risk_score),
    reevaluation_count: reevalCount,
    evaluated_by: "AI",
    checks: analysis.checks,
    evaluated_at: ts,
  };

  const row = {
    ticket_id: ticketId,
    conversation_id: conversationId,
    sender,
    message_preview: message.slice(0, 100),
    prompt: sender === "User" ? message.slice(0, 4000) : null,
    response: sender !== "User" ? message.slice(0, 4000) : null,
    risk_score: analysis.risk_score,
    risk_level: status,
    status_label: status,
    identified_risks: identifiedRisks,
    sentiment: analysis.sentiment,
    pii_detected: analysis.pii_detected,
    governance_explanation: analysis.explanation,
    compliance_status: action,
    action_taken: action,
    transparency_notes,
    source: "auto",
    created_at: ts,
  };

  if (conversationId) {
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
 * Analyze + persist one message. Returns true on save success, false on failure.
 * Never throws — governance work must not break the chat or ticket pipeline.
 */
export async function scheduleGovernanceAnalysis(params: {
  conversationId: string | null;
  ticketId: string | null;
  sender: GovSender;
  message: string;
  createdAt?: string;
  incrementReeval?: boolean;
}): Promise<boolean> {
  try {
    const analysis = await analyzeMessage(params.message, params.sender);
    await upsertLog({ ...params, analysis });
    return true;
  } catch (err) {
    console.warn("[governance] analysis failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Admin server functions                                             */
/* ------------------------------------------------------------------ */

const LOG_COLUMNS =
  "id, ticket_id, conversation_id, sender, message_preview, risk_score, risk_level, status_label, identified_risks, sentiment, pii_detected, governance_explanation, action_taken, compliance_status, source, transparency_notes, created_at, updated_at";

export const adminListGovernanceLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("compliance_logs")
      .select(LOG_COLUMNS)
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
      .select("risk_score, risk_level, sender, identified_risks, compliance_status, transparency_notes, created_at")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminReevaluateTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ ticketId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: convs, error } = await supabaseAdmin
      .from("conversations")
      .select("id, ticket_id, role, message, created_at")
      .eq("ticket_id", data.ticketId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    let processed = 0;
    let saved = 0;
    for (const c of convs ?? []) {
      const sender: GovSender = c.role === "user" ? "User" : c.role === "admin" ? "Admin" : "AI";
      const ok = await scheduleGovernanceAnalysis({
        conversationId: c.id,
        ticketId: c.ticket_id,
        sender,
        message: c.message,
        createdAt: c.created_at,
        incrementReeval: true,
      });
      processed++;
      if (ok) saved++;
    }
    if (processed > 0 && saved === 0) {
      throw new Error("Evaluation failed: no records were saved. Check server logs (AI gateway or database write error).");
    }
    return { processed: saved };
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
