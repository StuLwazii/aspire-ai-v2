import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  adminListGovernanceLogs,
  adminGovernanceStats,
  adminEvaluateNewMessages,
  adminReevaluateAll,
} from "@/lib/governance.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  ShieldCheck, AlertTriangle, Activity, Gauge, RefreshCw, Play, Loader2,
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, BarChart, Bar,
} from "recharts";

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
  created_at: string;
};

const STATUS_COLORS: Record<string, string> = {
  Safe: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  Warning: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
  "High Risk": "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30",
  Critical: "bg-destructive/15 text-destructive border-destructive/30",
};
const ACTION_COLORS: Record<string, string> = {
  Passed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  Flagged: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  Escalated: "bg-orange-500/10 text-orange-700 dark:text-orange-400",
  Blocked: "bg-destructive/10 text-destructive",
};
const PIE_COLORS = ["#10b981", "#eab308", "#f97316", "#ef4444"];

export function GovernanceDashboard() {
  const listFn = useServerFn(adminListGovernanceLogs);
  const statsFn = useServerFn(adminGovernanceStats);
  const evalNewFn = useServerFn(adminEvaluateNewMessages);
  const reevalAllFn = useServerFn(adminReevaluateAll);

  const logsQ = useQuery({
    queryKey: ["gov-logs"],
    queryFn: () => listFn() as Promise<LogRow[]>,
    refetchInterval: 15_000,
  });
  const statsQ = useQuery({
    queryKey: ["gov-stats"],
    queryFn: () => statsFn() as Promise<LogRow[]>,
    refetchInterval: 15_000,
  });

  const [evaluatingNew, setEvaluatingNew] = useState(false);
  const [reevalRunning, setReevalRunning] = useState(false);

  const logs = logsQ.data ?? [];
  const stats = statsQ.data ?? [];

  const totals = useMemo(() => {
    const total = stats.length;
    const aiCount = stats.filter((s) => s.sender !== "User").length;
    const flagged = stats.filter((s) => s.compliance_status !== "Passed").length;
    const highRisk = stats.filter((s) => s.risk_level === "High Risk" || s.risk_level === "Critical").length;
    const avg = total ? Math.round(stats.reduce((a, s) => a + s.risk_score, 0) / total) : 0;
    return { total, aiCount, flagged, highRisk, avg };
  }, [stats]);

  const statusDist = useMemo(() => {
    const buckets: Record<string, number> = { Safe: 0, Warning: 0, "High Risk": 0, Critical: 0 };
    for (const s of stats) buckets[s.risk_level] = (buckets[s.risk_level] ?? 0) + 1;
    return Object.entries(buckets).map(([name, value]) => ({ name, value }));
  }, [stats]);

  const trend = useMemo(() => {
    const byDay = new Map<string, { day: string; avg: number; count: number; flagged: number }>();
    for (const s of stats) {
      const day = new Date(s.created_at).toISOString().slice(0, 10);
      const cur = byDay.get(day) ?? { day, avg: 0, count: 0, flagged: 0 };
      cur.avg = (cur.avg * cur.count + s.risk_score) / (cur.count + 1);
      cur.count += 1;
      if (s.compliance_status !== "Passed") cur.flagged += 1;
      byDay.set(day, cur);
    }
    return Array.from(byDay.values()).map((d) => ({ ...d, avg: Math.round(d.avg) }));
  }, [stats]);

  const biasDist = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of stats) {
      for (const r of s.identified_risks ?? []) {
        if (typeof r === "string" && r.startsWith("bias:")) {
          const k = r.slice(5);
          counts[k] = (counts[k] ?? 0) + 1;
        }
      }
    }
    return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [stats]);

  const monthly = useMemo(() => {
    const byMonth = new Map<string, { month: string; avg: number; count: number; flagged: number; topCats: Record<string, number> }>();
    for (const s of stats) {
      const m = new Date(s.created_at).toISOString().slice(0, 7);
      const cur = byMonth.get(m) ?? { month: m, avg: 0, count: 0, flagged: 0, topCats: {} };
      cur.avg = (cur.avg * cur.count + s.risk_score) / (cur.count + 1);
      cur.count += 1;
      if (s.compliance_status !== "Passed") cur.flagged += 1;
      for (const r of s.identified_risks ?? []) cur.topCats[r] = (cur.topCats[r] ?? 0) + 1;
      byMonth.set(m, cur);
    }
    return Array.from(byMonth.values()).map((r) => ({
      ...r,
      avg: Math.round(r.avg),
      topCategory: Object.entries(r.topCats).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—",
    }));
  }, [stats]);

  const flaggedLogs = logs.filter((l) => l.compliance_status === "Flagged" || l.compliance_status === "Escalated" || l.compliance_status === "Blocked");
  const categoryCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const s of stats) for (const r of s.identified_risks ?? []) if (typeof r === "string" && !r.startsWith("bias:")) c[r] = (c[r] ?? 0) + 1;
    return Object.entries(c).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [stats]);

  const runEvalNew = async () => {
    setEvaluatingNew(true);
    try {
      const r = await evalNewFn();
      toast.success(`Evaluated ${r.processed} new messages (${r.remaining} remaining)`);
      logsQ.refetch(); statsQ.refetch();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setEvaluatingNew(false); }
  };
  const runReevalAll = async () => {
    setReevalRunning(true);
    try {
      const r = await reevalAllFn({ data: { limit: 100 } });
      toast.success(`Re-evaluated ${r.processed} messages`);
      logsQ.refetch(); statsQ.refetch();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setReevalRunning(false); }
  };

  const StatCard = ({ label, value, icon: Icon, tone = "default" }: { label: string; value: string | number; icon: typeof Gauge; tone?: "default" | "warn" | "danger" | "ok" }) => {
    const toneCls = tone === "warn" ? "text-yellow-600 dark:text-yellow-400"
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
          <div className={`text-2xl font-bold mt-2 ${toneCls}`}>{value}</div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      {/* Widgets */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="Total AI requests" value={totals.aiCount} icon={Activity} />
        <StatCard label="Flagged responses" value={totals.flagged} icon={AlertTriangle} tone="warn" />
        <StatCard label="High risk" value={totals.highRisk} icon={ShieldCheck} tone="danger" />
        <StatCard label="Avg risk score" value={totals.avg} icon={Gauge} tone={totals.avg > 50 ? "warn" : "ok"} />
        <StatCard label="Total evaluations" value={totals.total} icon={ShieldCheck} />
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Risk trend over time</CardTitle></CardHeader>
          <CardContent className="h-64">
            {trend.length === 0 ? <Empty /> : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend}>
                  <XAxis dataKey="day" fontSize={10} />
                  <YAxis domain={[0, 100]} fontSize={10} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                  <Line type="monotone" dataKey="avg" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Compliance status distribution</CardTitle></CardHeader>
          <CardContent className="h-64">
            {statusDist.every((s) => s.value === 0) ? <Empty /> : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusDist} dataKey="value" nameKey="name" outerRadius={80} label>
                    {statusDist.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Legend />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Bias categories detected</CardTitle></CardHeader>
          <CardContent className="h-64">
            {biasDist.length === 0 ? <Empty label="No bias detected." /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={biasDist}>
                  <XAxis dataKey="name" fontSize={10} />
                  <YAxis fontSize={10} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Monthly analytics</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground border-b">
                  <tr><th className="text-left p-2">Month</th><th className="text-left p-2">Avg risk</th><th className="text-left p-2">Flagged</th><th className="text-left p-2">Top category</th></tr>
                </thead>
                <tbody>
                  {monthly.length === 0 ? (
                    <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">No data yet.</td></tr>
                  ) : monthly.map((m) => (
                    <tr key={m.month} className="border-b last:border-0">
                      <td className="p-2 font-mono">{m.month}</td>
                      <td className="p-2">{m.avg}</td>
                      <td className="p-2">{m.flagged}</td>
                      <td className="p-2">{m.topCategory}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="logs" className="w-full">
        <TabsList className="grid grid-cols-2 lg:grid-cols-5 h-auto">
          <TabsTrigger value="logs">Compliance logs</TabsTrigger>
          <TabsTrigger value="reports">Risk reports</TabsTrigger>
          <TabsTrigger value="manual">Manual reviews</TabsTrigger>
          <TabsTrigger value="evalnew">Evaluate new</TabsTrigger>
          <TabsTrigger value="reevalall">Re-evaluate all</TabsTrigger>
        </TabsList>

        <TabsContent value="logs">
          <LogsTable rows={logs} />
        </TabsContent>

        <TabsContent value="reports">
          <Card>
            <CardHeader><CardTitle className="text-sm font-semibold">Top detected categories</CardTitle></CardHeader>
            <CardContent>
              {categoryCounts.length === 0 ? <Empty /> : (
                <div className="space-y-2">
                  {categoryCounts.map((c) => (
                    <div key={c.name} className="flex items-center justify-between text-sm">
                      <span className="capitalize">{c.name}</span>
                      <Badge variant="secondary">{c.value}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="mt-4">
            <CardHeader><CardTitle className="text-sm font-semibold">High-risk conversations</CardTitle></CardHeader>
            <CardContent className="p-0">
              <LogsTable rows={logs.filter((l) => l.risk_level === "High Risk" || l.risk_level === "Critical")} embedded />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manual">
          <LogsTable rows={flaggedLogs} />
        </TabsContent>

        <TabsContent value="evalnew">
          <Card>
            <CardContent className="p-6 space-y-4">
              <p className="text-sm text-muted-foreground">Analyze conversation messages that haven't been evaluated yet (up to 50 per run).</p>
              <Button onClick={runEvalNew} disabled={evaluatingNew}>
                {evaluatingNew ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
                Evaluate new tickets
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reevalall">
          <Card>
            <CardContent className="p-6 space-y-4">
              <p className="text-sm text-muted-foreground">Rerun governance analysis for the 100 most recent conversation messages. Existing evaluations are updated in place.</p>
              <Button onClick={runReevalAll} disabled={reevalRunning} variant="destructive">
                {reevalRunning ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Re-evaluate all tickets
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Empty({ label = "No data yet." }: { label?: string }) {
  return <div className="h-full flex items-center justify-center text-xs text-muted-foreground">{label}</div>;
}

function LogsTable({ rows, embedded = false }: { rows: LogRow[]; embedded?: boolean }) {
  const body = (
    <ScrollArea className="h-[520px]">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card border-b text-muted-foreground">
          <tr>
            <th className="text-left p-2">Time</th>
            <th className="text-left p-2">Sender</th>
            <th className="text-left p-2">Preview</th>
            <th className="text-left p-2">Score</th>
            <th className="text-left p-2">Status</th>
            <th className="text-left p-2">Action</th>
            <th className="text-left p-2">Sentiment</th>
            <th className="text-left p-2">Categories</th>
            <th className="text-left p-2">PII</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No evaluations yet. Trigger analysis by chatting or click "Evaluate new tickets".</td></tr>
          ) : rows.map((l) => (
            <tr key={l.id} className="border-b hover:bg-muted/30 align-top">
              <td className="p-2 whitespace-nowrap font-mono text-[10px]">{new Date(l.created_at).toLocaleString()}</td>
              <td className="p-2"><Badge variant="outline" className="text-[10px]">{l.sender ?? "—"}</Badge></td>
              <td className="p-2 max-w-[280px]">
                <div className="line-clamp-2">{l.message_preview}</div>
                {l.governance_explanation && <div className="text-muted-foreground text-[10px] mt-1 italic line-clamp-2">{l.governance_explanation}</div>}
              </td>
              <td className="p-2 font-mono">{l.risk_score}</td>
              <td className="p-2"><Badge className={`text-[10px] ${STATUS_COLORS[l.risk_level] ?? ""}`}>{l.risk_level}</Badge></td>
              <td className="p-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${ACTION_COLORS[l.compliance_status] ?? ""}`}>{l.compliance_status}</span></td>
              <td className="p-2">{l.sentiment ?? "—"}</td>
              <td className="p-2">
                <div className="flex flex-wrap gap-1">
                  {(l.identified_risks ?? []).map((r, i) => <Badge key={i} variant="secondary" className="text-[10px]">{r}</Badge>)}
                </div>
              </td>
              <td className="p-2">
                <div className="flex flex-wrap gap-1">
                  {(l.pii_detected ?? []).map((r, i) => <Badge key={i} variant="destructive" className="text-[10px]">{r}</Badge>)}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
  return embedded ? body : <Card><CardContent className="p-0">{body}</CardContent></Card>;
}
