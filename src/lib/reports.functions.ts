import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DEPARTMENTS = ["All", "Sales", "Marketing", "Operations", "Finance", "HR", "IT"] as const;
const CADENCES = ["weekly", "biweekly", "monthly"] as const;

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

async function callAI(body: unknown) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429) throw new Error("AI rate limit reached. Please try again shortly.");
  if (res.status === 402) throw new Error("AI credits exhausted. Please top up in Workspace settings.");
  if (!res.ok) throw new Error(`AI gateway error: ${res.status}`);
  return res.json() as Promise<{ choices: Array<{ message: { tool_calls?: Array<{ function: { arguments: string } }> } }> }>;
}

type TicketLite = {
  id: string;
  category: string;
  status: string;
  priority: string | null;
  resolution_type: string;
  created_at: string;
  resolved_at: string | null;
  first_response_at: string | null;
  title: string | null;
};

function computeKpis(tickets: TicketLite[], department: string, periodStart: Date, periodEnd: Date) {
  const inPeriod = tickets.filter((t) => {
    const c = new Date(t.created_at);
    return c >= periodStart && c <= periodEnd;
  });
  const scoped = department === "All"
    ? inPeriod
    : inPeriod.filter((t) => t.category === department || department === "Sales" || department === "Marketing");

  const total = scoped.length;
  const resolved = scoped.filter((t) => t.status === "resolved").length;
  const open = scoped.filter((t) => t.status === "open" || t.status === "in_progress").length;
  const escalated = scoped.filter((t) => t.resolution_type === "escalated").length;
  const selfService = scoped.filter((t) => t.resolution_type === "self_service").length;

  const respTimes = scoped
    .filter((t) => t.first_response_at)
    .map((t) => new Date(t.first_response_at as string).getTime() - new Date(t.created_at).getTime());
  const resTimes = scoped
    .filter((t) => t.resolved_at)
    .map((t) => new Date(t.resolved_at as string).getTime() - new Date(t.created_at).getTime());

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const avgRespMs = avg(respTimes);
  const avgResMs = avg(resTimes);

  const byCategory: Record<string, number> = {};
  for (const t of scoped) byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;

  const byPriority: Record<string, number> = {};
  for (const t of scoped) byPriority[t.priority ?? "medium"] = (byPriority[t.priority ?? "medium"] ?? 0) + 1;

  // Prev period for trend
  const periodMs = periodEnd.getTime() - periodStart.getTime();
  const prevStart = new Date(periodStart.getTime() - periodMs);
  const prev = tickets.filter((t) => {
    const c = new Date(t.created_at);
    return c >= prevStart && c < periodStart;
  });
  const prevTotal = department === "All" ? prev.length : prev.filter((t) => t.category === department).length;
  const volumeChangePct = prevTotal === 0 ? null : Math.round(((total - prevTotal) / prevTotal) * 100);
  const resolutionRate = total === 0 ? 0 : Math.round((resolved / total) * 100);

  return {
    total, resolved, open, escalated, selfService,
    avgResponseMinutes: Math.round(avgRespMs / 60000),
    avgResolutionMinutes: Math.round(avgResMs / 60000),
    byCategory, byPriority,
    prevTotal, volumeChangePct, resolutionRate,
  };
}

type ReportContent = {
  executive_summary: string;
  performance_analysis: string;
  recommendations: string;
};

async function generateReportContent(department: string, kpis: ReturnType<typeof computeKpis>, periodStart: Date, periodEnd: Date): Promise<ReportContent> {
  const periodLabel = `${periodStart.toISOString().slice(0, 10)} to ${periodEnd.toISOString().slice(0, 10)}`;
  const json = await callAI({
    model: "google/gemini-2.5-flash",
    messages: [
      {
        role: "system",
        content: "You are an executive business analyst. Given KPI data from a support/ticket platform, produce a polished weekly business report aimed at C-level readers. Use plain business language. Be concise, data-grounded, and action-oriented. Do not invent numbers; only reference what's in the KPIs.",
      },
      {
        role: "user",
        content: `Generate a ${department} department executive report for the period ${periodLabel}. KPIs:\n${JSON.stringify(kpis, null, 2)}\n\nReturn three sections via the tool: executive_summary (3-5 sentence overview with key achievements and concerns), performance_analysis (5-8 sentences on KPI trends, growth indicators, and comparison vs previous period), recommendations (3-5 bullet points starting with '- ' for actions and opportunities).`,
      },
    ],
    tools: [{
      type: "function",
      function: {
        name: "submit_report",
        description: "Submit the executive report sections.",
        parameters: {
          type: "object",
          properties: {
            executive_summary: { type: "string" },
            performance_analysis: { type: "string" },
            recommendations: { type: "string" },
          },
          required: ["executive_summary", "performance_analysis", "recommendations"],
          additionalProperties: false,
        },
      },
    }],
    tool_choice: { type: "function", function: { name: "submit_report" } },
  });

  const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("AI returned no report content");
  return JSON.parse(args) as ReportContent;
}

function buildHtml(opts: {
  title: string; department: string; periodStart: Date; periodEnd: Date;
  content: ReportContent; kpis: ReturnType<typeof computeKpis>;
}) {
  const { title, department, periodStart, periodEnd, content, kpis } = opts;
  const generated = new Date().toISOString().slice(0, 16).replace("T", " ");
  const fmtMin = (m: number) => m < 60 ? `${m}m` : m < 1440 ? `${(m / 60).toFixed(1)}h` : `${(m / 1440).toFixed(1)}d`;
  const catRows = Object.entries(kpis.byCategory).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
  const priRows = Object.entries(kpis.byPriority).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
  const recsHtml = content.recommendations
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<li>${l.replace(/^[-*•]\s*/, "")}</li>`)
    .join("");
  const trend = kpis.volumeChangePct == null ? "—" : `${kpis.volumeChangePct > 0 ? "+" : ""}${kpis.volumeChangePct}%`;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:820px;margin:0 auto;padding:40px 32px;line-height:1.55}
  h1{font-size:28px;margin:0 0 4px;color:#0f172a}
  h2{font-size:18px;margin:32px 0 12px;color:#1e293b;border-bottom:2px solid #e2e8f0;padding-bottom:6px}
  .brand{display:flex;align-items:center;gap:12px;border-bottom:3px solid #0f172a;padding-bottom:16px;margin-bottom:24px}
  .logo{width:40px;height:40px;border-radius:8px;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700}
  .meta{color:#64748b;font-size:13px;margin-top:2px}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}
  .kpi{border:1px solid #e2e8f0;border-radius:8px;padding:12px;background:#f8fafc}
  .kpi .lbl{font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:.5px}
  .kpi .val{font-size:22px;font-weight:700;color:#0f172a;margin-top:4px}
  table{width:100%;border-collapse:collapse;margin:8px 0}
  th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:14px}
  th{background:#f1f5f9;color:#475569;font-weight:600}
  ul{padding-left:20px}
  li{margin:6px 0}
  p{margin:8px 0}
  .footer{margin-top:40px;padding-top:16px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px;text-align:center}
  @media print{body{padding:20px}}
</style></head><body>
<div class="brand">
  <div class="logo">A</div>
  <div>
    <div style="font-weight:700;font-size:16px">Aspire AI</div>
    <div class="meta">Business Reporting Automation</div>
  </div>
</div>
<h1>${title}</h1>
<div class="meta">Department: <strong>${department}</strong> · Period: ${periodStart.toISOString().slice(0,10)} → ${periodEnd.toISOString().slice(0,10)} · Generated: ${generated}</div>

<h2>Executive Summary</h2>
<p>${content.executive_summary.replace(/\n/g, "<br>")}</p>

<h2>Key KPIs</h2>
<div class="kpis">
  <div class="kpi"><div class="lbl">Total Tickets</div><div class="val">${kpis.total}</div></div>
  <div class="kpi"><div class="lbl">Resolved</div><div class="val">${kpis.resolved}</div></div>
  <div class="kpi"><div class="lbl">Open</div><div class="val">${kpis.open}</div></div>
  <div class="kpi"><div class="lbl">Escalated</div><div class="val">${kpis.escalated}</div></div>
  <div class="kpi"><div class="lbl">Resolution Rate</div><div class="val">${kpis.resolutionRate}%</div></div>
  <div class="kpi"><div class="lbl">Avg Response</div><div class="val">${fmtMin(kpis.avgResponseMinutes)}</div></div>
  <div class="kpi"><div class="lbl">Avg Resolution</div><div class="val">${fmtMin(kpis.avgResolutionMinutes)}</div></div>
  <div class="kpi"><div class="lbl">Volume vs Prev</div><div class="val">${trend}</div></div>
</div>

<h2>Performance Analysis</h2>
<p>${content.performance_analysis.replace(/\n/g, "<br>")}</p>

${catRows ? `<h2>Breakdown by Category</h2><table><thead><tr><th>Category</th><th>Tickets</th></tr></thead><tbody>${catRows}</tbody></table>` : ""}
${priRows ? `<h2>Breakdown by Priority</h2><table><thead><tr><th>Priority</th><th>Tickets</th></tr></thead><tbody>${priRows}</tbody></table>` : ""}

<h2>Recommendations</h2>
<ul>${recsHtml || `<li>${content.recommendations}</li>`}</ul>

<div class="footer">Aspire AI · Confidential — for internal executive review only</div>
</body></html>`;
}

export const adminGenerateReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      department: z.enum(DEPARTMENTS).default("All"),
      periodDays: z.number().int().min(1).max(365).default(7),
      save: z.boolean().default(true),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - data.periodDays * 24 * 60 * 60 * 1000);

    // Pull tickets from a wider window to compute previous-period trend.
    const sinceForTrend = new Date(periodStart.getTime() - data.periodDays * 24 * 60 * 60 * 1000);
    const { data: tickets, error } = await supabaseAdmin
      .from("tickets")
      .select("id, category, status, priority, resolution_type, created_at, resolved_at, first_response_at, title")
      .gte("created_at", sinceForTrend.toISOString());
    if (error) throw new Error(error.message);

    const kpis = computeKpis((tickets ?? []) as TicketLite[], data.department, periodStart, periodEnd);
    const content = await generateReportContent(data.department, kpis, periodStart, periodEnd);
    const title = `${data.department === "All" ? "Company-wide" : data.department} Weekly Business Report`;
    const html = buildHtml({ title, department: data.department, periodStart, periodEnd, content, kpis });

    if (!data.save) {
      return {
        id: null, title, department: data.department, period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(), executive_summary: content.executive_summary,
        performance_analysis: content.performance_analysis, recommendations: content.recommendations,
        kpis, html, created_at: new Date().toISOString(),
      };
    }

    const { data: row, error: insErr } = await supabaseAdmin
      .from("business_reports" as never)
      .insert({
        title, department: data.department,
        period_start: periodStart.toISOString(), period_end: periodEnd.toISOString(),
        executive_summary: content.executive_summary,
        performance_analysis: content.performance_analysis,
        recommendations: content.recommendations,
        kpis, html, created_by: context.userId,
      } as never)
      .select()
      .single();
    if (insErr) throw new Error(insErr.message);
    return row;
  });

export const adminListReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("business_reports" as never)
      .select("id, title, department, period_start, period_end, executive_summary, recommendations, kpis, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const adminGetReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: row, error } = await supabaseAdmin
      .from("business_reports" as never).select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    return row;
  });

export const adminDeleteReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.from("business_reports" as never).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Schedules

export const adminListSchedules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("report_schedules" as never).select("*").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

function computeNextRun(cadence: string): Date {
  const d = new Date();
  if (cadence === "weekly") d.setDate(d.getDate() + 7);
  else if (cadence === "biweekly") d.setDate(d.getDate() + 14);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

export const adminCreateSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      name: z.string().trim().min(1).max(120),
      department: z.enum(DEPARTMENTS).default("All"),
      cadence: z.enum(CADENCES).default("weekly"),
      recipients: z.array(z.string().email()).max(20).default([]),
      active: z.boolean().default(true),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { data: row, error } = await supabaseAdmin
      .from("report_schedules" as never)
      .insert({ ...data, next_run_at: computeNextRun(data.cadence).toISOString(), created_by: context.userId } as never)
      .select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const adminUpdateSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id: z.string().uuid(),
      active: z.boolean().optional(),
      recipients: z.array(z.string().email()).max(20).optional(),
      cadence: z.enum(CADENCES).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { id, ...patch } = data;
    const update: Record<string, unknown> = { ...patch };
    if (patch.cadence) update.next_run_at = computeNextRun(patch.cadence).toISOString();
    const { data: row, error } = await supabaseAdmin
      .from("report_schedules" as never).update(update as never).eq("id", id).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const adminDeleteSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin.from("report_schedules" as never).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
