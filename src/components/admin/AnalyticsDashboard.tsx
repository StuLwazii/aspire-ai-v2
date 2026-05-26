import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ClientOnly } from "@tanstack/react-router";
import {
  BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, Cell,
  LineChart, Line, CartesianGrid, PieChart, Pie, Legend, Area, AreaChart,
} from "recharts";
import { Download, TrendingUp, TrendingDown, Clock, CheckCircle2, AlertCircle, Sparkles } from "lucide-react";
import type { AdminTicket } from "./types";

const CAT_COLORS: Record<string, string> = {
  IT: "var(--cat-it)", Finance: "var(--cat-finance)", HR: "var(--cat-hr)", Operations: "var(--cat-ops)",
};

type Granularity = "day" | "week" | "month";

function formatDuration(ms: number | null): string {
  if (ms == null || !isFinite(ms) || ms < 0) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = mins / 60;
  if (hrs < 24) return `${hrs.toFixed(1)}h`;
  return `${(hrs / 24).toFixed(1)}d`;
}

function avg(nums: number[]): number | null {
  const valid = nums.filter((n) => isFinite(n) && n >= 0);
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function bucketKey(d: Date, grain: Granularity): string {
  if (grain === "day") return d.toISOString().slice(0, 10);
  if (grain === "month") return d.toISOString().slice(0, 7);
  const day = d.getUTCDay();
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function KpiCard({ label, value, hint, icon: Icon, trend }: {
  label: string; value: string | number; hint?: string;
  icon: typeof Clock; trend?: { dir: "up" | "down" | "flat"; pct: number };
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
          <div className="text-2xl font-bold mt-1">{value}</div>
          {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
        </div>
        <div className="h-9 w-9 rounded-md bg-accent/10 flex items-center justify-center">
          <Icon className="h-4 w-4 text-accent" />
        </div>
      </div>
      {trend && (
        <div className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${
          trend.dir === "up" ? "text-emerald-600" : trend.dir === "down" ? "text-rose-600" : "text-muted-foreground"
        }`}>
          {trend.dir === "up" ? <TrendingUp className="h-3 w-3" /> : trend.dir === "down" ? <TrendingDown className="h-3 w-3" /> : null}
          {trend.pct.toFixed(0)}% vs previous period
        </div>
      )}
    </Card>
  );
}

export function AnalyticsDashboard({ tickets }: { tickets: AdminTicket[] }) {
  const [grain, setGrain] = useState<Granularity>("day");
  const [category, setCategory] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const filtered = useMemo(() => {
    return tickets.filter((t) => {
      if (category !== "all" && t.category !== category) return false;
      if (status !== "all" && t.status !== status) return false;
      const created = new Date(t.created_at);
      if (fromDate && created < new Date(fromDate)) return false;
      if (toDate && created > new Date(`${toDate}T23:59:59`)) return false;
      return true;
    });
  }, [tickets, category, status, fromDate, toDate]);

  // KPIs
  const total = filtered.length;
  const open = filtered.filter((t) => t.status === "open" || t.status === "in_progress").length;
  const closed = filtered.filter((t) => t.status === "resolved").length;
  const avgResponse = avg(
    filtered
      .filter((t) => t.first_response_at)
      .map((t) => new Date(t.first_response_at as string).getTime() - new Date(t.created_at).getTime())
  );
  const avgResolution = avg(
    filtered
      .filter((t) => t.resolved_at)
      .map((t) => new Date(t.resolved_at as string).getTime() - new Date(t.created_at).getTime())
  );

  // Week-over-week comparison for trend chip
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const thisWeek = filtered.filter((t) => now - new Date(t.created_at).getTime() < weekMs).length;
  const prevWeek = filtered.filter((t) => {
    const age = now - new Date(t.created_at).getTime();
    return age >= weekMs && age < 2 * weekMs;
  }).length;
  const volumeTrend = prevWeek === 0 ? null : {
    dir: (thisWeek > prevWeek ? "up" : thisWeek < prevWeek ? "down" : "flat") as "up" | "down" | "flat",
    pct: Math.abs(((thisWeek - prevWeek) / prevWeek) * 100),
  };

  // Category distribution
  const cats = ["IT", "Finance", "HR", "Operations"];
  const byCat = cats.map((c) => ({ name: c, count: filtered.filter((t) => t.category === c).length }));
  const topCat = [...byCat].sort((a, b) => b.count - a.count)[0];

  // Open vs closed
  const openVsClosed = [
    { name: "Open", value: open, key: "open" },
    { name: "Closed", value: closed, key: "closed" },
    { name: "In progress", value: filtered.filter((t) => t.status === "in_progress").length, key: "inp" },
  ].filter((d) => d.value > 0);

  // Trends over time
  const trendMap = new Map<string, { created: number; resolved: number }>();
  for (const t of filtered) {
    const k = bucketKey(new Date(t.created_at), grain);
    const cur = trendMap.get(k) ?? { created: 0, resolved: 0 };
    cur.created += 1;
    trendMap.set(k, cur);
    if (t.resolved_at) {
      const rk = bucketKey(new Date(t.resolved_at), grain);
      const r = trendMap.get(rk) ?? { created: 0, resolved: 0 };
      r.resolved += 1;
      trendMap.set(rk, r);
    }
  }
  const trendSeries = [...trendMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));

  // AI insights (rule-based summary)
  const insights: string[] = [];
  if (volumeTrend) {
    insights.push(`Ticket volume ${volumeTrend.dir === "up" ? "increased" : volumeTrend.dir === "down" ? "decreased" : "held steady"} ${volumeTrend.pct.toFixed(0)}% this week vs last week.`);
  }
  if (topCat && topCat.count > 0) {
    insights.push(`${topCat.name} is the top category with ${topCat.count} ticket${topCat.count === 1 ? "" : "s"} (${Math.round((topCat.count / total) * 100)}% of total).`);
  }
  if (avgResponse != null) {
    insights.push(`Average first response time is ${formatDuration(avgResponse)}.`);
  }
  if (avgResolution != null) {
    insights.push(`Average resolution time is ${formatDuration(avgResolution)}.`);
  }
  if (total > 0) {
    const resolveRate = Math.round((closed / total) * 100);
    insights.push(`${resolveRate}% of tickets in view are resolved.`);
  }

  // CSV export
  const exportCsv = () => {
    const headers = [
      "ticket_id", "title", "customer_name", "customer_email", "category", "priority",
      "assigned_agent", "status", "created_at", "first_response_at", "resolved_at",
      "response_time_minutes", "resolution_time_minutes",
    ];
    const rows = filtered.map((t) => {
      const resp = t.first_response_at ? Math.round((new Date(t.first_response_at).getTime() - new Date(t.created_at).getTime()) / 60000) : "";
      const res = t.resolved_at ? Math.round((new Date(t.resolved_at).getTime() - new Date(t.created_at).getTime()) / 60000) : "";
      return [
        t.id, t.title ?? "", t.app_users?.name ?? "", t.app_users?.email ?? "",
        t.category, t.priority ?? "", t.agents?.full_name ?? "", t.status,
        t.created_at, t.first_response_at ?? "", t.resolved_at ?? "", resp, res,
      ];
    });
    const escape = (v: unknown) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tickets-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[140px]">
            <label className="text-xs text-muted-foreground mb-1 block">Category</label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {cats.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="text-xs text-muted-foreground mb-1 block">Status</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="text-xs text-muted-foreground mb-1 block">From</label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="text-xs text-muted-foreground mb-1 block">To</label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <Button onClick={exportCsv} variant="outline" className="gap-2">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard label="Total" value={total} icon={AlertCircle} trend={volumeTrend ?? undefined} />
        <KpiCard label="Open" value={open} icon={AlertCircle} hint={`${closed} resolved`} />
        <KpiCard label="Avg response" value={formatDuration(avgResponse)} icon={Clock} hint="First reply" />
        <KpiCard label="Avg resolution" value={formatDuration(avgResolution)} icon={CheckCircle2} hint="Created → resolved" />
        <KpiCard label="Top category" value={topCat?.count ? topCat.name : "—"} icon={Sparkles} hint={topCat?.count ? `${topCat.count} tickets` : undefined} />
      </div>

      {/* Weekly AI insights */}
      <Card className="p-5 border-accent/30">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-accent" />
          <div className="text-sm font-semibold">Weekly insights</div>
          <Badge variant="secondary" className="ml-auto">Auto-generated</Badge>
        </div>
        <ul className="space-y-2 text-sm">
          {insights.length === 0 && <li className="text-muted-foreground">Not enough data yet for insights.</li>}
          {insights.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-accent">•</span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Trends */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="text-sm font-semibold">Open vs resolved over time</div>
          <div className="flex gap-1">
            {(["day", "week", "month"] as Granularity[]).map((g) => (
              <Button key={g} size="sm" variant={grain === g ? "default" : "outline"} onClick={() => setGrain(g)}>
                {g[0].toUpperCase() + g.slice(1)}ly
              </Button>
            ))}
          </div>
        </div>
        <div className="h-72">
          <ClientOnly fallback={null}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendSeries} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="created" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.2} name="Created" />
                <Area type="monotone" dataKey="resolved" stroke="oklch(0.65 0.15 150)" fill="oklch(0.65 0.15 150)" fillOpacity={0.2} name="Resolved" />
              </AreaChart>
            </ResponsiveContainer>
          </ClientOnly>
        </div>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <div className="text-sm font-semibold mb-3">Category distribution</div>
          <div className="h-64">
            <ClientOnly fallback={null}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byCat} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {byCat.map((d) => <Cell key={d.name} fill={CAT_COLORS[d.name]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ClientOnly>
          </div>
        </Card>

        <Card className="p-5">
          <div className="text-sm font-semibold mb-3">Open vs closed</div>
          <div className="h-64">
            <ClientOnly fallback={null}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={openVsClosed} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                    {openVsClosed.map((d, i) => (
                      <Cell key={d.key} fill={["var(--accent)", "oklch(0.65 0.15 150)", "var(--primary)"][i % 3]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </ClientOnly>
          </div>
        </Card>
      </div>
    </div>
  );
}
