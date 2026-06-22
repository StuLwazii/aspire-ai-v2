import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  evaluateCompliance,
  listComplianceLogs,
  complianceDashboard,
  reviewComplianceLog,
  complianceReport,
} from "@/lib/compliance.functions";
import { useSupabaseSessionStatus } from "@/hooks/useSupabaseSessionStatus";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { ClientOnly } from "@tanstack/react-router";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend,
} from "recharts";
import { ShieldAlert, ShieldCheck, AlertTriangle, Activity, Download, Loader2, Sparkles, Bell } from "lucide-react";
import { toast } from "sonner";

type Risk = { category?: string; severity?: string; explanation?: string };
type Log = {
  id: string;
  user_id: string | null;
  prompt: string;
  response: string;
  risk_score: number;
  risk_level: string;
  identified_risks: Risk[];
  compliance_status: string;
  review_notes: string | null;
  transparency_notes: { confidenceScore?: number; limitations?: string[]; ethicalNotes?: string[] };
  source: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

const PIE_COLORS = ["#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#3b82f6", "#ec4899"];

function riskBadge(level: string) {
  const map: Record<string, string> = {
    Low: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
    Medium: "bg-amber-500/15 text-amber-600 border-amber-500/30",
    High: "bg-orange-500/15 text-orange-600 border-orange-500/30",
    Critical: "bg-red-500/15 text-red-600 border-red-500/30",
  };
  return <Badge variant="outline" className={map[level] ?? ""}>{level}</Badge>;
}

function statusBadge(s: string) {
  const map: Record<string, string> = {
    Approved: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
    "Pending Review": "bg-amber-500/15 text-amber-600 border-amber-500/30",
    Rejected: "bg-red-500/15 text-red-600 border-red-500/30",
    Escalated: "bg-violet-500/15 text-violet-600 border-violet-500/30",
  };
  return <Badge variant="outline" className={map[s] ?? ""}>{s}</Badge>;
}

function toCSV(rows: Log[]) {
  const headers = ["id", "created_at", "risk_score", "risk_level", "compliance_status", "source", "prompt", "response", "identified_risks"];
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push([
      r.id, r.created_at, r.risk_score, r.risk_level, r.compliance_status, r.source,
      r.prompt, r.response, JSON.stringify(r.identified_risks ?? []),
    ].map(escape).join(","));
  }
  return lines.join("\n");
}

function download(name: string, content: string, type = "text/csv") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function GovernancePage() {
  const sessionStatus = useSupabaseSessionStatus();
  const enabled = sessionStatus === "authenticated";

  const dashFn = useServerFn(complianceDashboard);
  const logsFn = useServerFn(listComplianceLogs);
  const evalFn = useServerFn(evaluateCompliance);
  const reviewFn = useServerFn(reviewComplianceLog);
  const reportFn = useServerFn(complianceReport);
  const qc = useQueryClient();

  const dashQ = useQuery({ queryKey: ["compliance-dash"], queryFn: () => dashFn(), enabled });
  const logsQ = useQuery({ queryKey: ["compliance-logs"], queryFn: () => logsFn({ data: {} }), enabled });

  const [tab, setTab] = useState("dashboard");
  const [filterLevel, setFilterLevel] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Log | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [override, setOverride] = useState<string>("");

  const [evalPrompt, setEvalPrompt] = useState("");
  const [evalResponse, setEvalResponse] = useState("");

  const evalMut = useMutation({
    mutationFn: (vars: { prompt: string; response: string }) =>
      evalFn({ data: { prompt: vars.prompt, response: vars.response, source: "manual" } }),
    onSuccess: (r) => {
      toast.success(`Evaluated — ${r.evaluation.riskLevel} (${r.evaluation.riskScore})`);
      if (r.evaluation.riskScore >= 80) {
        toast.warning("High risk threshold exceeded — flagged for review", { icon: <Bell className="h-4 w-4" /> });
      }
      qc.invalidateQueries({ queryKey: ["compliance-dash"] });
      qc.invalidateQueries({ queryKey: ["compliance-logs"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const reviewMut = useMutation({
    mutationFn: (vars: { id: string; action: "approve" | "reject" | "escalate"; notes?: string; overrideRiskScore?: number }) =>
      reviewFn({ data: vars }),
    onSuccess: () => {
      toast.success("Review saved");
      setSelected(null); setReviewNotes(""); setOverride("");
      qc.invalidateQueries({ queryKey: ["compliance-dash"] });
      qc.invalidateQueries({ queryKey: ["compliance-logs"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const logs = (logsQ.data ?? []) as Log[];
  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (filterLevel !== "all" && l.risk_level !== filterLevel) return false;
      if (filterStatus !== "all" && l.compliance_status !== filterStatus) return false;
      if (search && !(l.prompt?.toLowerCase().includes(search.toLowerCase()) || l.response?.toLowerCase().includes(search.toLowerCase()))) return false;
      return true;
    });
  }, [logs, filterLevel, filterStatus, search]);

  const pending = logs.filter((l) => l.compliance_status === "Pending Review" || l.compliance_status === "Escalated");

  // Notifications: multiple violations per user
  const userViolationCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of logs) {
      if (l.risk_level === "High" || l.risk_level === "Critical") {
        const k = l.user_id ?? "anon";
        counts[k] = (counts[k] ?? 0) + 1;
      }
    }
    return Object.entries(counts).filter(([, c]) => c >= 3);
  }, [logs]);

  const dash = dashQ.data;

  const runReport = async (kind: "csv" | "json") => {
    const r = await reportFn({ data: {} });
    if (kind === "csv") download(`compliance-report-${Date.now()}.csv`, toCSV(r.logs as Log[]));
    else download(`compliance-report-${Date.now()}.json`, JSON.stringify(r, null, 2), "application/json");
    toast.success("Report exported");
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-primary" /> AI Governance & Compliance
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor AI responses for ethical risks, bias, and compliance violations.
          </p>
        </div>
        {userViolationCounts.length > 0 && (
          <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400">
            <Bell className="h-4 w-4" />
            {userViolationCounts.length} user(s) with 3+ high-risk violations
          </div>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="logs">Compliance Logs</TabsTrigger>
          <TabsTrigger value="reports">Risk Reports</TabsTrigger>
          <TabsTrigger value="reviews">
            Manual Reviews {pending.length > 0 && <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600">{pending.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        {/* DASHBOARD */}
        <TabsContent value="dashboard" className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi label="Total AI Requests" value={dash?.kpis.total ?? 0} icon={<Activity className="h-4 w-4" />} />
            <Kpi label="Flagged Responses" value={dash?.kpis.flagged ?? 0} icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} />
            <Kpi label="High Risk" value={dash?.kpis.highRisk ?? 0} icon={<ShieldAlert className="h-4 w-4 text-red-500" />} />
            <Kpi label="Avg Risk Score" value={dash?.kpis.avgScore ?? 0} icon={<ShieldCheck className="h-4 w-4 text-emerald-500" />} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            <Card className="p-4">
              <div className="font-medium mb-2 text-sm">Risk Trend Over Time</div>
              <ClientOnly fallback={<div className="h-64" />}>
                {() => (
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={dash?.riskTrend ?? []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" fontSize={11} />
                      <YAxis fontSize={11} domain={[0, 100]} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                      <Line type="monotone" dataKey="avg" stroke="#ef4444" strokeWidth={2} dot={false} name="Avg risk" />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </ClientOnly>
            </Card>
            <Card className="p-4">
              <div className="font-medium mb-2 text-sm">Compliance Status Distribution</div>
              <ClientOnly fallback={<div className="h-64" />}>
                {() => (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={dash?.statusDistribution ?? []} dataKey="value" nameKey="name" outerRadius={90} label>
                        {(dash?.statusDistribution ?? []).map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                      </Pie>
                      <Legend />
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </ClientOnly>
            </Card>
            <Card className="p-4">
              <div className="font-medium mb-2 text-sm">Bias Categories Detected</div>
              <ClientOnly fallback={<div className="h-64" />}>
                {() => (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={dash?.biasCategories ?? []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" fontSize={10} />
                      <YAxis fontSize={11} />
                      <Tooltip />
                      <Bar dataKey="value" fill="#8b5cf6" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </ClientOnly>
            </Card>
            <Card className="p-4">
              <div className="font-medium mb-2 text-sm">Monthly Analytics</div>
              <ClientOnly fallback={<div className="h-64" />}>
                {() => (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={dash?.monthly ?? []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" fontSize={11} />
                      <YAxis fontSize={11} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="count" fill="#3b82f6" name="Total" />
                      <Bar dataKey="flagged" fill="#ef4444" name="Flagged" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </ClientOnly>
            </Card>
          </div>
        </TabsContent>

        {/* LOGS */}
        <TabsContent value="logs" className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex gap-2 flex-wrap">
              <Input placeholder="Search prompt or response…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
              <Select value={filterLevel} onValueChange={setFilterLevel}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Risk level" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All levels</SelectItem>
                  <SelectItem value="Low">Low</SelectItem>
                  <SelectItem value="Medium">Medium</SelectItem>
                  <SelectItem value="High">High</SelectItem>
                  <SelectItem value="Critical">Critical</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="Pending Review">Pending Review</SelectItem>
                  <SelectItem value="Approved">Approved</SelectItem>
                  <SelectItem value="Rejected">Rejected</SelectItem>
                  <SelectItem value="Escalated">Escalated</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => download(`compliance-logs-${Date.now()}.csv`, toCSV(filtered))}>
                <Download className="h-4 w-4 mr-1" /> Export CSV
              </Button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Created</th>
                    <th className="text-left py-2 px-2">Risk</th>
                    <th className="text-left py-2 px-2">Score</th>
                    <th className="text-left py-2 px-2">Status</th>
                    <th className="text-left py-2 px-2">Source</th>
                    <th className="text-left py-2 px-2">Prompt</th>
                    <th className="py-2 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => (
                    <tr key={l.id} className="border-b hover:bg-muted/30">
                      <td className="py-2 px-2 text-xs whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
                      <td className="py-2 px-2">{riskBadge(l.risk_level)}</td>
                      <td className="py-2 px-2 font-mono text-xs">{l.risk_score}</td>
                      <td className="py-2 px-2">{statusBadge(l.compliance_status)}</td>
                      <td className="py-2 px-2 text-xs">{l.source}</td>
                      <td className="py-2 px-2 max-w-md truncate">{l.prompt}</td>
                      <td className="py-2 px-2 text-right">
                        <Button size="sm" variant="outline" onClick={() => { setSelected(l); setReviewNotes(l.review_notes ?? ""); setOverride(""); }}>View</Button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} className="py-8 text-center text-muted-foreground text-sm">No logs found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* REPORTS */}
        <TabsContent value="reports" className="space-y-4">
          <Card className="p-4">
            <div className="flex justify-between items-start mb-4 flex-wrap gap-2">
              <div>
                <div className="font-semibold">Risk Evaluation Report</div>
                <div className="text-xs text-muted-foreground">Aggregated metrics across all compliance logs</div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => runReport("csv")}><Download className="h-4 w-4 mr-1" /> CSV</Button>
                <Button size="sm" variant="outline" onClick={() => runReport("json")}><Download className="h-4 w-4 mr-1" /> JSON</Button>
                <Button size="sm" variant="outline" onClick={() => window.print()}><Download className="h-4 w-4 mr-1" /> PDF (Print)</Button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <Kpi label="Total Requests" value={dash?.kpis.total ?? 0} />
              <Kpi label="Flagged" value={dash?.kpis.flagged ?? 0} />
              <Kpi label="High Risk" value={dash?.kpis.highRisk ?? 0} />
              <Kpi label="Avg Score" value={dash?.kpis.avgScore ?? 0} />
            </div>
            <div className="font-medium text-sm mb-2">Most Common Risks</div>
            <div className="space-y-1">
              {(dash?.biasCategories ?? []).slice(0, 8).map((b) => (
                <div key={b.name} className="flex justify-between text-sm border-b py-1">
                  <span>{b.name}</span>
                  <span className="font-mono">{b.value}</span>
                </div>
              ))}
              {(!dash || dash.biasCategories.length === 0) && (
                <div className="text-sm text-muted-foreground">No risks detected yet.</div>
              )}
            </div>
          </Card>
        </TabsContent>

        {/* REVIEWS */}
        <TabsContent value="reviews" className="space-y-3">
          {pending.length === 0 && (
            <Card className="p-8 text-center text-sm text-muted-foreground">No items pending review.</Card>
          )}
          {pending.map((l) => (
            <Card key={l.id} className="p-4 space-y-2">
              <div className="flex justify-between items-start gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  {riskBadge(l.risk_level)} {statusBadge(l.compliance_status)}
                  <span className="text-xs text-muted-foreground">Score {l.risk_score}</span>
                </div>
                <Button size="sm" variant="outline" onClick={() => { setSelected(l); setReviewNotes(l.review_notes ?? ""); setOverride(""); }}>Review</Button>
              </div>
              <div className="text-sm"><span className="text-muted-foreground">Prompt:</span> {l.prompt.slice(0, 200)}</div>
              <div className="text-sm"><span className="text-muted-foreground">Response:</span> {l.response.slice(0, 200)}</div>
            </Card>
          ))}
        </TabsContent>

        {/* SETTINGS — manual evaluator */}
        <TabsContent value="settings" className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4" /> Manual evaluation</div>
            <p className="text-xs text-muted-foreground">Run the risk engine on any prompt/response pair. Results are stored in the compliance log.</p>
            <Textarea placeholder="Prompt sent to AI…" value={evalPrompt} onChange={(e) => setEvalPrompt(e.target.value)} rows={3} />
            <Textarea placeholder="AI response to evaluate…" value={evalResponse} onChange={(e) => setEvalResponse(e.target.value)} rows={4} />
            <div>
              <Button
                onClick={() => evalMut.mutate({ prompt: evalPrompt, response: evalResponse })}
                disabled={!evalPrompt || !evalResponse || evalMut.isPending}
              >
                {evalMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ShieldAlert className="h-4 w-4 mr-1" />}
                Evaluate
              </Button>
            </div>
            {evalMut.data && (
              <div className="text-sm border rounded p-3 bg-muted/30 space-y-1">
                <div>Risk: {riskBadge(evalMut.data.evaluation.riskLevel)} (score {evalMut.data.evaluation.riskScore})</div>
                <div>Confidence: {evalMut.data.evaluation.transparencyNotes.confidenceScore}%</div>
                {evalMut.data.evaluation.identifiedRisks.length > 0 && (
                  <div>Risks: {evalMut.data.evaluation.identifiedRisks.map((r: Risk) => r.category).join(", ")}</div>
                )}
              </div>
            )}
          </Card>
          <Card className="p-4 text-sm space-y-2">
            <div className="font-semibold">Security & policies</div>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-5">
              <li>Compliance logs are restricted to administrators via row-level security.</li>
              <li>Review actions record the reviewer and timestamp for audit trail.</li>
              <li>Sensitive logs are stored encrypted at rest by the database provider.</li>
              <li>High-risk responses (score ≥ 80) trigger in-app notifications.</li>
            </ul>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Review dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Compliance log</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="flex gap-2 flex-wrap items-center">
                {riskBadge(selected.risk_level)} {statusBadge(selected.compliance_status)}
                <span className="text-xs text-muted-foreground">Score {selected.risk_score} · {selected.source}</span>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Prompt</div>
                <div className="whitespace-pre-wrap border rounded p-2 bg-muted/30">{selected.prompt}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Response</div>
                <div className="whitespace-pre-wrap border rounded p-2 bg-muted/30">{selected.response}</div>
              </div>
              {selected.identified_risks?.length > 0 && (
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Identified risks</div>
                  <ul className="space-y-1">
                    {selected.identified_risks.map((r, i) => (
                      <li key={i} className="border rounded p-2 text-xs">
                        <span className="font-medium">{r.category}</span> · <span className="text-muted-foreground">{r.severity}</span>
                        {r.explanation && <div className="text-muted-foreground mt-1">{r.explanation}</div>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {selected.transparency_notes && (
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Transparency notes</div>
                  <div className="border rounded p-2 text-xs space-y-1">
                    <div>Confidence: {selected.transparency_notes.confidenceScore ?? "—"}%</div>
                    {selected.transparency_notes.limitations?.length ? (
                      <div>Limitations: <ul className="list-disc pl-5">{selected.transparency_notes.limitations.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                    ) : null}
                    {selected.transparency_notes.ethicalNotes?.length ? (
                      <div>Ethical notes: <ul className="list-disc pl-5">{selected.transparency_notes.ethicalNotes.map((s, i) => <li key={i}>{s}</li>)}</ul></div>
                    ) : null}
                  </div>
                </div>
              )}
              <div>
                <div className="text-xs uppercase text-muted-foreground">Review notes</div>
                <Textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} rows={3} />
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground">Override risk score (optional, 0–100)</div>
                <Input value={override} onChange={(e) => setOverride(e.target.value)} placeholder="e.g. 30" />
              </div>
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => selected && reviewMut.mutate({ id: selected.id, action: "approve", notes: reviewNotes, overrideRiskScore: override ? Number(override) : undefined })} disabled={reviewMut.isPending}>Approve</Button>
            <Button variant="outline" onClick={() => selected && reviewMut.mutate({ id: selected.id, action: "escalate", notes: reviewNotes, overrideRiskScore: override ? Number(override) : undefined })} disabled={reviewMut.isPending}>Escalate</Button>
            <Button variant="destructive" onClick={() => selected && reviewMut.mutate({ id: selected.id, action: "reject", notes: reviewNotes, overrideRiskScore: override ? Number(override) : undefined })} disabled={reviewMut.isPending}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Kpi({ label, value, icon }: { label: string; value: number | string; icon?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>{icon}
      </div>
      <div className="text-2xl font-bold mt-2">{value}</div>
    </Card>
  );
}
