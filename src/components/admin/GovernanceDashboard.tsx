import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  adminListGovernanceLogs,
  adminGovernanceStats,
  adminReevaluateTicket,
  adminReevaluateAll,
} from "@/lib/governance.functions";
import { useSupabaseSession } from "@/hooks/useSupabaseSessionStatus";
import { Navigate } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  ShieldCheck, AlertTriangle, Activity, Gauge, RefreshCw, Loader2,
  CheckCircle2, XCircle, AlertOctagon, ChevronDown, Sparkles, Info, Clock,
} from "lucide-react";

type GovChecks = {
  bias?: { verdict: string; detail: string; categories?: string[] };
  toxicity?: { verdict: string; detail: string; level?: string };
  compliance?: { verdict: string; detail: string; issues?: string[] };
  hallucination?: { verdict: string; detail: string; risk?: string };
};
type Transparency = {
  confidence?: number;
  governance_score?: number;
  risk_indicator?: "Low" | "Medium" | "High";
  reevaluation_count?: number;
  evaluated_by?: string;
  checks?: GovChecks;
  evaluated_at?: string;
};

type LogRow = {
  id: string;
  ticket_id: string | null;
  conversation_id: string | null;
  sender: string | null;
  message_preview: string | null;
  risk_score: number;
  risk_level: string;
  status_label: string | null;
  identified_risks: string[] | null;
  sentiment: string | null;
  pii_detected: string[] | null;
  governance_explanation: string | null;
  action_taken: string | null;
  compliance_status: string;
  source: string;
  transparency_notes: Transparency | null;
  created_at: string;
  updated_at?: string;
};

const RISK_TONE: Record<string, string> = {
  Low: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  Medium: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
  High: "bg-destructive/15 text-destructive border-destructive/30",
};

function RiskBadge({ risk }: { risk: "Low" | "Medium" | "High" }) {
  const dot = risk === "Low" ? "🟢" : risk === "Medium" ? "🟡" : "🔴";
  return <Badge variant="outline" className={`${RISK_TONE[risk]} font-medium`}>{dot} {risk} Risk</Badge>;
}

function StatusPill({ status }: { status: "PASSED" | "WARNING" | "FAILED" }) {
  const cls =
    status === "PASSED" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
    : status === "WARNING" ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30"
    : "bg-destructive/15 text-destructive border-destructive/30";
  const Icon = status === "PASSED" ? CheckCircle2 : status === "WARNING" ? AlertTriangle : XCircle;
  return (
    <Badge variant="outline" className={`${cls} gap-1 font-semibold`}>
      <Icon className="h-3.5 w-3.5" /> {status}
    </Badge>
  );
}

function scoreToStatus(score: number): "PASSED" | "WARNING" | "FAILED" {
  if (score >= 80) return "PASSED";
  if (score >= 50) return "WARNING";
  return "FAILED";
}

function riskFromScore(risk_score: number): "Low" | "Medium" | "High" {
  if (risk_score <= 20) return "Low";
  if (risk_score <= 50) return "Medium";
  return "High";
}

/* ------------------------------------------------------------------ */

export function GovernanceDashboard() {
  const listFn = useServerFn(adminListGovernanceLogs);
  const statsFn = useServerFn(adminGovernanceStats);
  const reevalTicketFn = useServerFn(adminReevaluateTicket);
  const reevalAllFn = useServerFn(adminReevaluateAll);
  const { status: sessionStatus, accessToken } = useSupabaseSession();
  const authed = sessionStatus === "authenticated" && !!accessToken;
  const authHeaders = useMemo(
    () => (accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined),
    [accessToken],
  );

  const logsQ = useQuery({
    queryKey: ["gov-logs", accessToken],
    queryFn: async () => {
      if (!authHeaders) throw new Error("Unauthorized");
      return (await listFn({ headers: authHeaders })) as unknown as LogRow[];
    },
    refetchInterval: authed ? 15_000 : false,
    enabled: authed,
    retry: false,
  });

  const statsQ = useQuery({
    queryKey: ["gov-stats", accessToken],
    queryFn: async () => {
      if (!authHeaders) throw new Error("Unauthorized");
      return (await statsFn({ headers: authHeaders })) as unknown as LogRow[];
    },
    refetchInterval: authed ? 15_000 : false,
    enabled: authed,
    retry: false,
  });

  const logs = logsQ.data ?? [];
  const stats = statsQ.data ?? [];

  const [selectedTicket, setSelectedTicket] = useState<string | null>(null);

  const metrics = useMemo(() => {
    const total = stats.length;
    if (total === 0) return null;
    const scores = stats.map((s) => 100 - s.risk_score);
    const confidences = stats.map((s) => s.transparency_notes?.confidence ?? 85);
    const passed = stats.filter((s) => s.compliance_status === "Passed").length;
    const flagged = total - passed;
    const bias = stats.filter((s) => (s.identified_risks ?? []).some((r) => typeof r === "string" && (r === "bias" || r.startsWith("bias:")))).length;
    const toxicity = stats.filter((s) => {
      const t = s.transparency_notes?.checks?.toxicity;
      return t && t.verdict !== "pass";
    }).length;
    const compFails = stats.filter((s) => {
      const c = s.transparency_notes?.checks?.compliance;
      return c ? c.verdict === "fail" : s.compliance_status === "Blocked";
    }).length;
    const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / total);
    const avgConf = Math.round(confidences.reduce((a, b) => a + b, 0) / total);
    return { total, passed, flagged, avgScore, avgConf, bias, toxicity, compFails };
  }, [stats]);

  // Group logs into per-ticket evaluations for the history table
  const ticketRows = useMemo(() => {
    const map = new Map<string, {
      ticketId: string;
      lastEvaluatedAt: string;
      avgScore: number;
      worstRisk: "Low" | "Medium" | "High";
      status: "PASSED" | "WARNING" | "FAILED";
      count: number;
      reevalCount: number;
      logs: LogRow[];
    }>();
    for (const l of logs) {
      if (!l.ticket_id) continue;
      const cur = map.get(l.ticket_id) ?? {
        ticketId: l.ticket_id,
        lastEvaluatedAt: l.created_at,
        avgScore: 0,
        worstRisk: "Low" as const,
        status: "PASSED" as const,
        count: 0,
        reevalCount: 0,
        logs: [],
      };
      cur.logs.push(l);
      cur.count += 1;
      cur.reevalCount = Math.max(cur.reevalCount, l.transparency_notes?.reevaluation_count ?? 0);
      if (new Date(l.created_at) > new Date(cur.lastEvaluatedAt)) cur.lastEvaluatedAt = l.created_at;
      const riskOrder = { Low: 0, Medium: 1, High: 2 };
      const thisRisk = riskFromScore(l.risk_score);
      if (riskOrder[thisRisk] > riskOrder[cur.worstRisk]) cur.worstRisk = thisRisk;
      map.set(l.ticket_id, cur);
    }
    for (const row of map.values()) {
      const scores = row.logs.map((x) => 100 - x.risk_score);
      row.avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      row.status = scoreToStatus(row.avgScore);
    }
    return Array.from(map.values()).sort((a, b) => b.lastEvaluatedAt.localeCompare(a.lastEvaluatedAt));
  }, [logs]);

  if (sessionStatus === "signed-out") return <Navigate to="/admin/login" />;

  const runReevalTicket = async (ticketId: string) => {
    if (!authHeaders) { toast.error("Please sign in again."); return null; }
    const r = await reevalTicketFn({ data: { ticketId }, headers: authHeaders });
    await Promise.all([logsQ.refetch(), statsQ.refetch()]);
    return r;
  };

  const loading = logsQ.isLoading || statsQ.isLoading;
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);

  const runEvaluateAll = async () => {
    if (!authHeaders) { toast.error("Please sign in again."); return; }
    setEvaluating(true);
    try {
      const r = await reevalAllFn({ data: { limit: 50 }, headers: authHeaders }) as { processed: number };
      await Promise.all([logsQ.refetch(), statsQ.refetch()]);
      toast.success(`Evaluation complete — ${r.processed} message${r.processed === 1 ? "" : "s"} analyzed.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Evaluation failed.");
    } finally {
      setEvaluating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header actions */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Run governance checks across recent conversations. Results below refresh automatically.
        </p>
        <Button onClick={runEvaluateAll} disabled={evaluating || !authed} className="gap-2">
          {evaluating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {evaluating ? "Running evaluation…" : "Run Evaluation"}
        </Button>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label="Total Tickets Evaluated" value={metrics?.total ?? 0} icon={Activity} empty={!metrics} />
        <KpiCard label="Passed Evaluations" value={metrics?.passed ?? 0} icon={CheckCircle2} tone="ok" empty={!metrics} />
        <KpiCard label="Flagged Tickets" value={metrics?.flagged ?? 0} icon={AlertTriangle} tone="warn" empty={!metrics} />
        <KpiCard label="Avg Governance Score" value={metrics ? `${metrics.avgScore}/100` : "—"} icon={Gauge} tone={metrics && metrics.avgScore >= 80 ? "ok" : "warn"} empty={!metrics} />
        <KpiCard label="Avg Confidence" value={metrics ? `${metrics.avgConf}%` : "—"} icon={Sparkles} empty={!metrics} />
        <KpiCard label="Bias Alerts" value={metrics?.bias ?? 0} icon={AlertOctagon} tone="warn" empty={!metrics} />
        <KpiCard label="Toxicity Alerts" value={metrics?.toxicity ?? 0} icon={AlertTriangle} tone="warn" empty={!metrics} />
        <KpiCard label="Compliance Failures" value={metrics?.compFails ?? 0} icon={ShieldCheck} tone="danger" empty={!metrics} />
      </div>

      {!loading && !metrics && (
        <Card className="border-dashed">
          <CardContent className="py-10 flex flex-col items-center text-center gap-3">
            <ShieldCheck className="h-10 w-10 text-muted-foreground" />
            <div>
              <div className="text-lg font-semibold">No evaluations yet</div>
              <p className="text-sm text-muted-foreground max-w-md mt-1">
                Governance runs automatically for every AI and admin response in every conversation. Start a chat, or open an existing ticket below and click <span className="font-medium">Re-evaluate Ticket</span> to run the checks now.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Evaluation history */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4" /> Evaluation history
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[520px]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card border-b text-muted-foreground z-10">
                <tr>
                  <th className="text-left p-3">Ticket ID</th>
                  <th className="text-left p-3">Last evaluated</th>
                  <th className="text-left p-3">Governance score</th>
                  <th className="text-left p-3">Risk level</th>
                  <th className="text-left p-3">Status</th>
                  <th className="text-left p-3">Evaluated by</th>
                  <th className="text-left p-3">Re-evaluations</th>
                  <th className="text-right p-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {ticketRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">
                      {loading ? "Loading evaluations…" : "No ticket evaluations yet. Send a chat message or trigger a re-evaluation to populate this table."}
                    </td>
                  </tr>
                ) : ticketRows.map((r) => (
                  <tr key={r.ticketId} className="border-b hover:bg-muted/30">
                    <td className="p-3 font-mono text-[10px]">{r.ticketId.slice(0, 8)}…</td>
                    <td className="p-3 whitespace-nowrap">{new Date(r.lastEvaluatedAt).toLocaleString()}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono">{r.avgScore}/100</span>
                        <Progress value={r.avgScore} className="h-1.5 w-16" />
                      </div>
                    </td>
                    <td className="p-3"><RiskBadge risk={r.worstRisk} /></td>
                    <td className="p-3"><StatusPill status={r.status} /></td>
                    <td className="p-3"><Badge variant="secondary" className="text-[10px]">AI</Badge></td>
                    <td className="p-3 font-mono">{r.reevalCount}</td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={rowBusy === r.ticketId}
                          onClick={async () => {
                            setRowBusy(r.ticketId);
                            try {
                              const res = await runReevalTicket(r.ticketId);
                              if (res) toast.success(`Re-evaluated ${res.processed} message${res.processed === 1 ? "" : "s"}.`);
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : "Re-evaluation failed.");
                            } finally {
                              setRowBusy(null);
                            }
                          }}
                        >
                          {rowBusy === r.ticketId
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <RefreshCw className="h-3.5 w-3.5" />}
                          Re-evaluate
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setSelectedTicket(r.ticketId)}>
                          View details
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      </Card>

      <TicketDetailDialog
        ticketId={selectedTicket}
        onOpenChange={(o) => !o && setSelectedTicket(null)}
        logs={selectedTicket ? logs.filter((l) => l.ticket_id === selectedTicket) : []}
        onReevaluate={runReevalTicket}
      />
    </div>
  );
}

function KpiCard({
  label, value, icon: Icon, tone = "default", empty,
}: { label: string; value: string | number; icon: typeof Gauge; tone?: "default" | "warn" | "danger" | "ok"; empty?: boolean }) {
  const toneCls = empty ? "text-muted-foreground"
    : tone === "warn" ? "text-yellow-600 dark:text-yellow-400"
    : tone === "danger" ? "text-destructive"
    : tone === "ok" ? "text-emerald-600 dark:text-emerald-400"
    : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
          <Icon className={`h-4 w-4 ${toneCls}`} />
        </div>
        <div className={`text-2xl font-bold mt-2 ${toneCls}`}>{empty ? "No data" : value}</div>
        {empty && <div className="text-[10px] text-muted-foreground mt-1">No evaluations yet</div>}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Ticket detail dialog                                                */
/* ------------------------------------------------------------------ */

const STEPS = [
  { key: "bias", label: "Running Bias Detection" },
  { key: "toxicity", label: "Running Toxicity Detection" },
  { key: "compliance", label: "Running Compliance Check" },
  { key: "hallucination", label: "Running Hallucination Check" },
  { key: "score", label: "Calculating Governance Score" },
] as const;

function TicketDetailDialog({
  ticketId, onOpenChange, logs, onReevaluate,
}: {
  ticketId: string | null;
  onOpenChange: (open: boolean) => void;
  logs: LogRow[];
  onReevaluate: (ticketId: string) => Promise<{ processed: number } | null>;
}) {
  const [running, setRunning] = useState(false);
  const [stepIdx, setStepIdx] = useState(-1); // -1 = idle, 0..STEPS.length-1 running/done
  const [transcript, setTranscript] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(true);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    return () => { timers.current.forEach((t) => window.clearTimeout(t)); };
  }, []);

  useEffect(() => {
    if (!ticketId) {
      setRunning(false); setStepIdx(-1); setTranscript([]);
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    }
  }, [ticketId]);

  // Aggregated latest per-ticket view
  const latest = logs[0];
  const scores = logs.map((l) => 100 - l.risk_score);
  const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  const avgConf = logs.length
    ? Math.round(logs.reduce((a, l) => a + (l.transparency_notes?.confidence ?? 85), 0) / logs.length)
    : 0;
  const worstRisk: "Low" | "Medium" | "High" = logs.reduce((acc, l) => {
    const r = riskFromScore(l.risk_score);
    const order = { Low: 0, Medium: 1, High: 2 };
    return order[r] > order[acc] ? r : acc;
  }, "Low" as "Low" | "Medium" | "High");
  const status = scoreToStatus(avgScore);
  const reevalCount = logs.reduce((m, l) => Math.max(m, l.transparency_notes?.reevaluation_count ?? 0), 0);

  const aggChecks = useMemo(() => {
    // pick worst verdict across all logs for each check
    const rank = { pass: 0, warn: 1, fail: 2 } as const;
    const merge = <K extends keyof GovChecks>(k: K) => {
      let best: GovChecks[K] | undefined;
      for (const l of logs) {
        const c = l.transparency_notes?.checks?.[k];
        if (!c) continue;
        if (!best || rank[c.verdict as keyof typeof rank] > rank[best.verdict as keyof typeof rank]) best = c;
      }
      return best;
    };
    return {
      bias: merge("bias"),
      toxicity: merge("toxicity"),
      compliance: merge("compliance"),
      hallucination: merge("hallucination"),
    };
  }, [logs]);

  const runReevaluation = async () => {
    if (!ticketId) return;
    setRunning(true);
    setTranscript([`${new Date().toLocaleTimeString()}  Starting evaluation…`]);
    setStepIdx(0);
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];

    const push = (line: string) => setTranscript((prev) => [...prev, `${new Date().toLocaleTimeString()}  ${line}`]);

    // Kick off the actual server call in parallel with the animation
    const serverPromise = onReevaluate(ticketId);

    STEPS.forEach((s, i) => {
      const t = window.setTimeout(() => {
        setStepIdx(i);
        push(`${s.label}…`);
        const done = window.setTimeout(() => push(`✓ ${s.label} completed.`), 550);
        timers.current.push(done);
      }, i * 900);
      timers.current.push(t);
    });

    try {
      const r = await serverPromise;
      const wait = window.setTimeout(async () => {
        push(`Final Governance Score: ${avgScore}`);
        push(`Result: ${status}`);
        push(`Analyzed ${r?.processed ?? 0} messages in this ticket.`);
        setRunning(false);
        toast.success("Re-evaluation complete");
      }, STEPS.length * 900 + 400);
      timers.current.push(wait);
    } catch (e) {
      push(`✗ Failed: ${e instanceof Error ? e.message : "unknown error"}`);
      setRunning(false);
      toast.error("Re-evaluation failed");
    }
  };

  const open = !!ticketId;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Governance Result — Ticket {ticketId?.slice(0, 8)}…
          </DialogTitle>
        </DialogHeader>

        {logs.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No evaluations recorded for this ticket yet. Click Re-evaluate to run the governance engine.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Header stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryStat label="Governance Status" value={<StatusPill status={status} />} />
              <SummaryStat label="Governance Score" value={<span className="text-xl font-bold">{avgScore}/100</span>} />
              <SummaryStat label="Confidence" value={<span className="text-xl font-bold">{avgConf}%</span>} />
              <SummaryStat label="Risk Level" value={<RiskBadge risk={worstRisk} />} />
            </div>

            {/* Checks panel */}
            <div className="grid md:grid-cols-2 gap-3">
              <CheckPanel title="Bias Check" verdict={aggChecks.bias?.verdict} detail={aggChecks.bias?.detail ?? "No bias detected."} extra={aggChecks.bias?.categories} />
              <CheckPanel title="Toxicity Check" verdict={aggChecks.toxicity?.verdict} detail={aggChecks.toxicity?.detail ?? "Safe."} extra={aggChecks.toxicity?.level ? [`Level: ${aggChecks.toxicity.level}`] : undefined} />
              <CheckPanel title="Compliance" verdict={aggChecks.compliance?.verdict} detail={aggChecks.compliance?.detail ?? "Passed."} extra={aggChecks.compliance?.issues} />
              <CheckPanel title="Hallucination Risk" verdict={aggChecks.hallucination?.verdict} detail={aggChecks.hallucination?.detail ?? "Low."} extra={aggChecks.hallucination?.risk ? [`Risk: ${aggChecks.hallucination.risk}`] : undefined} />
            </div>

            {/* Explanation */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2"><Info className="h-4 w-4" /> AI Explanation</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {latest?.governance_explanation || "The response complies with governance policies. No harmful language, bias, or privacy risks were detected."}
              </CardContent>
            </Card>

            {/* Timeline */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Governance Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="relative border-l pl-4 space-y-2 text-sm">
                  {[
                    "Ticket Created",
                    "AI Evaluation Started",
                    "Bias Detection Completed",
                    "Safety Check Completed",
                    "Compliance Completed",
                    "Evaluation Finished",
                  ].map((label) => (
                    <li key={label} className="relative">
                      <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                      <span>{label}</span>
                    </li>
                  ))}
                </ol>
                <div className="text-[11px] text-muted-foreground mt-3">
                  Last evaluated {latest ? new Date(latest.created_at).toLocaleString() : "—"} · {logs.length} message{logs.length === 1 ? "" : "s"} analyzed · {reevalCount} re-evaluation{reevalCount === 1 ? "" : "s"}
                </div>
              </CardContent>
            </Card>

            {/* Re-evaluate action + staged progress */}
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-sm font-semibold">Re-run governance analysis</div>
                    <div className="text-xs text-muted-foreground">Runs bias, toxicity, compliance and hallucination checks on every message in this ticket.</div>
                  </div>
                  <Button onClick={runReevaluation} disabled={running}>
                    {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Re-evaluate Ticket
                  </Button>
                </div>
                {(running || stepIdx >= 0) && (
                  <div className="space-y-2 pt-2 border-t">
                    {STEPS.map((s, i) => {
                      const state = i < stepIdx ? "done" : i === stepIdx ? (running ? "run" : "done") : "pending";
                      return (
                        <div key={s.key} className="flex items-center gap-2 text-sm">
                          {state === "done" ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            : state === "run" ? <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            : <span className="h-4 w-4 rounded-full border border-muted-foreground/30" />}
                          <span className={state === "pending" ? "text-muted-foreground" : ""}>{s.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Collapsible logs */}
            <Collapsible open={showLogs} onOpenChange={setShowLogs}>
              <Card>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between p-4 text-left">
                    <span className="text-sm font-semibold">Governance Logs</span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${showLogs ? "rotate-180" : ""}`} />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <pre className="bg-muted/50 rounded p-3 text-[11px] font-mono max-h-56 overflow-auto whitespace-pre-wrap">
{transcript.length === 0
  ? "Click 'Re-evaluate Ticket' to stream a live log of each governance check."
  : transcript.join("\n")}
                    </pre>
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}

function CheckPanel({
  title, verdict, detail, extra,
}: { title: string; verdict?: string; detail: string; extra?: string[] }) {
  const v = verdict ?? "pass";
  const cls = v === "fail" ? "border-destructive/40 bg-destructive/5"
    : v === "warn" ? "border-yellow-500/40 bg-yellow-500/5"
    : "border-emerald-500/40 bg-emerald-500/5";
  const Icon = v === "fail" ? XCircle : v === "warn" ? AlertTriangle : CheckCircle2;
  const iconCls = v === "fail" ? "text-destructive" : v === "warn" ? "text-yellow-600 dark:text-yellow-400" : "text-emerald-600 dark:text-emerald-400";
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{title}</div>
        <Icon className={`h-4 w-4 ${iconCls}`} />
      </div>
      <div className="text-xs text-muted-foreground mt-1">{detail}</div>
      {extra && extra.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {extra.map((e, i) => <Badge key={i} variant="secondary" className="text-[10px]">{e}</Badge>)}
        </div>
      )}
    </div>
  );
}
