import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export type RiskLevel = "Low" | "Medium" | "High" | "Critical";

function levelFromScore(score: number): RiskLevel {
  if (score >= 76) return "Critical";
  if (score >= 51) return "High";
  if (score >= 26) return "Medium";
  return "Low";
}

async function callAI(body: unknown) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw new Error("AI rate limit reached. Try again shortly.");
  if (res.status === 402) throw new Error("AI credits exhausted.");
  if (!res.ok) throw new Error(`AI gateway error: ${res.status}`);
  return res.json();
}

async function evaluateWithAI(prompt: string, response: string) {
  const json = await callAI({
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
      {
        role: "user",
        content: `PROMPT:\n${prompt}\n\nRESPONSE:\n${response}`,
      },
    ],
  });
  const raw = json.choices?.[0]?.message?.content ?? "{}";
  const cleaned = String(raw).replace(/```json|```/g, "").trim();
  let parsed: any = {};
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = {};
  }
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.riskScore) || 0)));
  const identifiedRisks = Array.isArray(parsed.identifiedRisks) ? parsed.identifiedRisks.slice(0, 12) : [];
  const transparencyNotes = parsed.transparencyNotes && typeof parsed.transparencyNotes === "object"
    ? {
        confidenceScore: Math.max(0, Math.min(100, Math.round(Number(parsed.transparencyNotes.confidenceScore) || 80))),
        limitations: Array.isArray(parsed.transparencyNotes.limitations) ? parsed.transparencyNotes.limitations.slice(0, 6) : [],
        ethicalNotes: Array.isArray(parsed.transparencyNotes.ethicalNotes) ? parsed.transparencyNotes.ethicalNotes.slice(0, 6) : [],
      }
    : { confidenceScore: 85, limitations: [], ethicalNotes: [] };
  return { riskScore: score, riskLevel: levelFromScore(score), identifiedRisks, transparencyNotes };
}

const EvalInput = z.object({
  prompt: z.string().min(1).max(8000),
  response: z.string().min(1).max(12000),
  source: z.string().max(40).optional(),
  persist: z.boolean().optional(),
});

export const evaluateCompliance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => EvalInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const isAdmin = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin.data) throw new Error("Forbidden");

    const evaluation = await evaluateWithAI(data.prompt, data.response);
    const complianceStatus = evaluation.riskLevel === "Critical" || evaluation.riskLevel === "High"
      ? "Pending Review"
      : "Approved";

    if (data.persist !== false) {
      const { data: row, error } = await supabase
        .from("compliance_logs")
        .insert({
          user_id: userId,
          prompt: data.prompt,
          response: data.response,
          risk_score: evaluation.riskScore,
          risk_level: evaluation.riskLevel,
          identified_risks: evaluation.identifiedRisks,
          transparency_notes: evaluation.transparencyNotes,
          compliance_status: complianceStatus,
          source: data.source ?? "manual",
        })
        .select()
        .single();
      if (error) throw error;
      return { evaluation, log: row };
    }
    return { evaluation, log: null };
  });

const ListInput = z.object({
  riskLevel: z.enum(["Low", "Medium", "High", "Critical"]).optional(),
  status: z.string().max(30).optional(),
  search: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const listComplianceLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ListInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const isAdmin = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin.data) throw new Error("Forbidden");

    let q = supabase.from("compliance_logs").select("*").order("created_at", { ascending: false }).limit(data.limit ?? 100);
    if (data.riskLevel) q = q.eq("risk_level", data.riskLevel);
    if (data.status) q = q.eq("compliance_status", data.status);
    if (data.search) q = q.or(`prompt.ilike.%${data.search}%,response.ilike.%${data.search}%`);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const complianceDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const isAdmin = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin.data) throw new Error("Forbidden");

    const { data: rows, error } = await supabase
      .from("compliance_logs")
      .select("id,risk_score,risk_level,compliance_status,identified_risks,created_at")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw error;
    const logs = rows ?? [];
    const total = logs.length;
    const flagged = logs.filter((l) => l.risk_level !== "Low").length;
    const highRisk = logs.filter((l) => l.risk_level === "High" || l.risk_level === "Critical").length;
    const avgScore = total ? logs.reduce((s, l) => s + (l.risk_score ?? 0), 0) / total : 0;

    const statusCounts: Record<string, number> = {};
    const biasCounts: Record<string, number> = {};
    const trend: Record<string, { date: string; avg: number; count: number; sum: number }> = {};
    const monthly: Record<string, { month: string; count: number; flagged: number }> = {};

    for (const l of logs) {
      statusCounts[l.compliance_status] = (statusCounts[l.compliance_status] ?? 0) + 1;
      const risks = Array.isArray(l.identified_risks) ? l.identified_risks : [];
      for (const r of risks as Array<{ category?: string }>) {
        if (r && typeof r.category === "string") biasCounts[r.category] = (biasCounts[r.category] ?? 0) + 1;
      }
      const d = new Date(l.created_at);
      const dayKey = d.toISOString().slice(0, 10);
      const monthKey = d.toISOString().slice(0, 7);
      if (!trend[dayKey]) trend[dayKey] = { date: dayKey, avg: 0, count: 0, sum: 0 };
      trend[dayKey].count += 1;
      trend[dayKey].sum += l.risk_score ?? 0;
      trend[dayKey].avg = trend[dayKey].sum / trend[dayKey].count;
      if (!monthly[monthKey]) monthly[monthKey] = { month: monthKey, count: 0, flagged: 0 };
      monthly[monthKey].count += 1;
      if (l.risk_level !== "Low") monthly[monthKey].flagged += 1;
    }

    return {
      kpis: { total, flagged, highRisk, avgScore: Math.round(avgScore * 10) / 10 },
      statusDistribution: Object.entries(statusCounts).map(([name, value]) => ({ name, value })),
      biasCategories: Object.entries(biasCounts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      riskTrend: Object.values(trend).sort((a, b) => a.date.localeCompare(b.date)),
      monthly: Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month)),
    };
  });

const ReviewInput = z.object({
  id: z.string().uuid(),
  action: z.enum(["approve", "reject", "escalate"]),
  notes: z.string().max(2000).optional(),
  overrideRiskScore: z.number().int().min(0).max(100).optional(),
});

export const reviewComplianceLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ReviewInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const isAdmin = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin.data) throw new Error("Forbidden");

    const statusMap = { approve: "Approved", reject: "Rejected", escalate: "Escalated" } as const;
    const patch: {
      compliance_status: string;
      review_notes: string | null;
      reviewed_by: string;
      reviewed_at: string;
      risk_score?: number;
      risk_level?: string;
    } = {
      compliance_status: statusMap[data.action],
      review_notes: data.notes ?? null,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
    };
    if (typeof data.overrideRiskScore === "number") {
      patch.risk_score = data.overrideRiskScore;
      patch.risk_level = levelFromScore(data.overrideRiskScore);
    }
    const { data: row, error } = await supabase
      .from("compliance_logs")
      .update(patch)
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw error;
    return row;
  });

const ReportInput = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export const complianceReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ReportInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const isAdmin = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin.data) throw new Error("Forbidden");

    let q = supabase.from("compliance_logs").select("*").order("created_at", { ascending: false });
    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);
    const { data: rows, error } = await q;
    if (error) throw error;
    const logs = rows ?? [];
    const total = logs.length;
    const flagged = logs.filter((l) => l.risk_level !== "Low").length;
    const avgScore = total ? logs.reduce((s, l) => s + (l.risk_score ?? 0), 0) / total : 0;
    const biasCounts: Record<string, number> = {};
    for (const l of logs) {
      const risks = Array.isArray(l.identified_risks) ? l.identified_risks : [];
      for (const r of risks as Array<{ category?: string }>) {
        if (r?.category) biasCounts[r.category] = (biasCounts[r.category] ?? 0) + 1;
      }
    }
    const mostCommonRisks = Object.entries(biasCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
    return {
      total,
      flagged,
      avgScore: Math.round(avgScore * 10) / 10,
      mostCommonRisks,
      logs,
    };
  });

const BackfillInput = z.object({
  force: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export const adminBackfillTicketCompliance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => BackfillInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const isAdmin = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin.data) throw new Error("Forbidden");
    const { evaluateTicketAndLog } = await import("@/lib/compliance.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: tickets, error } = await supabaseAdmin
      .from("tickets")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 500);
    if (error) throw error;
    let evaluated = 0, skipped = 0, failed = 0;
    for (const t of (tickets ?? []) as Array<{ id: string }>) {
      try {
        // When not forcing, skip tickets that already have any log rows.
        if (!data.force) {
          const { data: existing } = await supabaseAdmin
            .from("compliance_logs")
            .select("id")
            .eq("ticket_id", t.id)
            .limit(1)
            .maybeSingle();
          if (existing) { skipped++; continue; }
        }
        const res = await evaluateTicketAndLog(t.id, data.force ?? false);
        if (res === "evaluated") evaluated++;
        else skipped++;
      } catch {
        failed++;
      }
    }
    return { processed: (tickets ?? []).length, evaluated, skipped, failed };
  });
