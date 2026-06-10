import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Legend, ReferenceLine, Area, ComposedChart,
} from "recharts";
import { ClientOnly } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { generatePredictiveRecommendations } from "@/lib/predictions.functions";
import { toast } from "sonner";
import {
  TrendingUp, TrendingDown, AlertTriangle, Sparkles, Loader2,
  CalendarDays, Building2, Activity, Brain,
} from "lucide-react";
import type { AdminTicket } from "./types";

const CATEGORIES = ["IT", "HR", "Finance", "Operations"] as const;
type Category = (typeof CATEGORIES)[number];

const CAT_COLOR: Record<Category, string> = {
  IT: "var(--cat-it, oklch(0.65 0.18 250))",
  HR: "var(--cat-hr, oklch(0.7 0.16 320))",
  Finance: "var(--cat-finance, oklch(0.7 0.15 150))",
  Operations: "var(--cat-ops, oklch(0.72 0.16 60))",
};

// ---------- Sample data generator (used if no tickets exist) ----------
function buildSampleTickets(days = 90): AdminTicket[] {
  const out: AdminTicket[] = [];
  const now = Date.now();
  for (let d = days; d >= 0; d--) {
    const date = new Date(now - d * 86400000);
    const dow = date.getDay();
    // Base load + weekend dip + weekly seasonality + slight upward trend on IT
    const seed = (n: number) => Math.abs(Math.sin((d + n) * 1.3)) * 5;
    const weekend = dow === 0 || dow === 6 ? 0.4 : 1;
    const counts: Record<Category, number> = {
      IT: Math.round((6 + seed(1) + d * 0.04) * weekend),
      HR: Math.round((3 + seed(2)) * weekend),
      Finance: Math.round((2 + seed(3)) * weekend),
      Operations: Math.round((4 + seed(4) - d * 0.01) * weekend),
    };
    for (const c of CATEGORIES) {
      for (let i = 0; i < counts[c]; i++) {
        out.push({
          id: `${d}-${c}-${i}`,
          category: c,
          created_at: date.toISOString(),
          status: "open",
        } as unknown as AdminTicket);
      }
    }
  }
  return out;
}

// ---------- Simple linear regression forecast ----------
function linReg(values: number[]) {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0, r2: 0 };
  const xs = values.map((_, i) => i);
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (values[i] - meanY);
    den += (xs[i] - meanX) ** 2;
    ssTot += (values[i] - meanY) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const pred = slope * xs[i] + intercept;
    ssRes += (values[i] - pred) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);
  return { slope, intercept, r2 };
}

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

function bucketByDay(tickets: AdminTicket[], days: number, filterCat?: Category | "All") {
  const map = new Map<string, number>();
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    map.set(dayKey(d), 0);
  }
  for (const t of tickets) {
    if (filterCat && filterCat !== "All" && t.category !== filterCat) continue;
    const d = new Date(t.created_at);
    const k = dayKey(d);
    if (map.has(k)) map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()].map(([date, count]) => ({ date, count }));
}

function forecastSeries(history: { date: string; count: number }[], futureDays: number) {
  const values = history.map((h) => h.count);
  const { slope, intercept, r2 } = linReg(values);
  const n = values.length;
  const out: { date: string; actual?: number; forecast?: number }[] = history.map((h) => ({
    date: h.date,
    actual: h.count,
  }));
  const last = new Date(history[history.length - 1].date);
  for (let i = 1; i <= futureDays; i++) {
    const x = n - 1 + i;
    const pred = Math.max(0, Math.round(slope * x + intercept));
    const d = new Date(last.getTime() + i * 86400000);
    out.push({ date: dayKey(d), forecast: pred });
  }
  return { series: out, slope, intercept, r2 };
}

// ---------- Component ----------
export function PredictiveInsights({ tickets: realTickets }: { tickets: AdminTicket[] }) {
  const usingSample = realTickets.length < 14;
  const tickets = useMemo(
    () => (usingSample ? buildSampleTickets(90) : realTickets),
    [realTickets, usingSample],
  );

  const [cat, setCat] = useState<"All" | Category>("All");
  const [rangeDays, setRangeDays] = useState<number>(60);
  const [fromDate, setFromDate] = useState<string>("");

  const filtered = useMemo(() => {
    if (!fromDate) return tickets;
    const from = new Date(fromDate).getTime();
    return tickets.filter((t) => new Date(t.created_at).getTime() >= from);
  }, [tickets, fromDate]);

  const history = useMemo(
    () => bucketByDay(filtered, rangeDays, cat),
    [filtered, rangeDays, cat],
  );

  const weekFc = useMemo(() => forecastSeries(history, 7), [history]);
  const monthFc = useMemo(() => forecastSeries(history, 30), [history]);

  const sumLast = (arr: { count: number }[], n: number) =>
    arr.slice(-n).reduce((a, b) => a + b.count, 0);

  const last7 = sumLast(history, 7);
  const prev7 = sumLast(history.slice(0, -7), 7);
  const last30 = sumLast(history, 30);
  const prev30 = sumLast(history.slice(0, -30), 30);

  const nextWeekPred = weekFc.series.slice(-7).reduce((a, b) => a + (b.forecast ?? 0), 0);
  const nextMonthPred = monthFc.series.slice(-30).reduce((a, b) => a + (b.forecast ?? 0), 0);

  const weekConfidence = Math.round(Math.min(95, Math.max(45, weekFc.r2 * 100 + 50)));
  const monthConfidence = Math.round(Math.min(92, Math.max(40, monthFc.r2 * 100 + 45)));

  // Per-category forecasts
  const perCat = useMemo(() => {
    return CATEGORIES.map((c) => {
      const hist = bucketByDay(filtered, rangeDays, c);
      const fc = forecastSeries(hist, 30);
      const recent = sumLast(hist, 14);
      const prior = sumLast(hist.slice(0, -14), 14);
      const change = prior === 0 ? 0 : ((recent - prior) / prior) * 100;
      const nextMonth = fc.series.slice(-30).reduce((a, b) => a + (b.forecast ?? 0), 0);
      return { category: c, recent, prior, change, nextMonth, slope: fc.slope };
    });
  }, [filtered, rangeDays]);

  const busiest = [...perCat].sort((a, b) => b.nextMonth - a.nextMonth)[0];
  const rising = perCat.filter((c) => c.change > 10).sort((a, b) => b.change - a.change);
  const falling = perCat.filter((c) => c.change < -10).sort((a, b) => a.change - b.change);

  // Seasonality: avg by day-of-week
  const dow = useMemo(() => {
    const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const sums = Array(7).fill(0);
    const counts = Array(7).fill(0);
    for (const h of history) {
      const d = new Date(h.date).getUTCDay();
      sums[d] += h.count;
      counts[d] += 1;
    }
    return sums.map((s, i) => ({ day: names[i], avg: counts[i] ? +(s / counts[i]).toFixed(1) : 0 }));
  }, [history]);

  const peakDay = [...dow].sort((a, b) => b.avg - a.avg)[0];

  // Surge detection: any day in forecast > 1.5x rolling avg
  const baseline = last30 / 30 || 1;
  const surges = monthFc.series
    .filter((p) => p.forecast !== undefined && p.forecast > baseline * 1.5)
    .slice(0, 5);

  // AI recommendations
  const recMut = useMutation({
    mutationFn: useServerFn(generatePredictiveRecommendations),
    onError: (e: Error) => toast.error(e.message),
  });

  const generateRecs = () => {
    const summary = [
      `Next 7 days forecast: ${nextWeekPred} tickets (${weekConfidence}% confidence).`,
      `Next 30 days forecast: ${nextMonthPred} tickets (${monthConfidence}% confidence).`,
      `Last 7 vs prior 7: ${last7} vs ${prev7} (${prev7 ? Math.round(((last7 - prev7) / prev7) * 100) : 0}%).`,
      `Busiest predicted department: ${busiest?.category} (~${busiest?.nextMonth} next month).`,
      rising.length
        ? `Rising categories: ${rising.map((r) => `${r.category} +${Math.round(r.change)}%`).join(", ")}.`
        : "No major rising categories.",
      falling.length
        ? `Falling categories: ${falling.map((r) => `${r.category} ${Math.round(r.change)}%`).join(", ")}.`
        : "",
      `Peak day-of-week: ${peakDay?.day} (avg ${peakDay?.avg}/day).`,
      surges.length ? `Surge days predicted: ${surges.length}.` : "",
    ]
      .filter(Boolean)
      .join(" ");
    recMut.mutate({ data: { summary } });
  };

  const recs = recMut.data?.recommendations ?? [];

  return (
    <div className="space-y-6">
      {usingSample && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 border rounded-md px-3 py-2">
          <Activity className="h-3.5 w-3.5" />
          Showing simulated 90-day sample data — predictions will use live ticket data once more history accumulates.
        </div>
      )}

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[140px]">
            <label className="text-xs text-muted-foreground mb-1 block">Department</label>
            <Select value={cat} onValueChange={(v) => setCat(v as "All" | Category)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All</SelectItem>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[140px]">
            <label className="text-xs text-muted-foreground mb-1 block">History window</label>
            <Select value={String(rangeDays)} onValueChange={(v) => setRangeDays(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="60">Last 60 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[160px]">
            <label className="text-xs text-muted-foreground mb-1 block">From date (optional)</label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="ml-auto">
            <Button onClick={generateRecs} disabled={recMut.isPending}>
              {recMut.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Thinking…</> : <><Sparkles className="h-4 w-4 mr-2" /> Generate AI recommendations</>}
            </Button>
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI
          icon={<CalendarDays className="h-4 w-4" />}
          label="Next 7 days"
          value={nextWeekPred}
          hint={`${weekConfidence}% confidence`}
          delta={prev7 ? ((nextWeekPred - last7) / Math.max(1, last7)) * 100 : 0}
        />
        <KPI
          icon={<CalendarDays className="h-4 w-4" />}
          label="Next 30 days"
          value={nextMonthPred}
          hint={`${monthConfidence}% confidence`}
          delta={prev30 ? ((nextMonthPred - last30) / Math.max(1, last30)) * 100 : 0}
        />
        <KPI
          icon={<Building2 className="h-4 w-4" />}
          label="Busiest dept (next 30d)"
          value={busiest?.category ?? "—"}
          hint={busiest ? `~${busiest.nextMonth} tickets` : ""}
        />
        <KPI
          icon={<AlertTriangle className="h-4 w-4" />}
          label="Predicted surge days"
          value={surges.length}
          hint={surges.length ? `≥ 1.5× baseline (${baseline.toFixed(1)}/day)` : "No surges predicted"}
        />
      </div>

      <Tabs defaultValue="volume" className="space-y-4">
        <TabsList>
          <TabsTrigger value="volume">Volume forecast</TabsTrigger>
          <TabsTrigger value="trends">Trend analysis</TabsTrigger>
          <TabsTrigger value="dept">Department workload</TabsTrigger>
          <TabsTrigger value="insights">Business insights</TabsTrigger>
        </TabsList>

        {/* Volume */}
        <TabsContent value="volume" className="space-y-4">
          <Card className="p-5">
            <div className="text-sm font-semibold mb-3">Historical + 30-day forecast</div>
            <div className="h-72">
              <ClientOnly fallback={null}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={monthFc.series}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <ReferenceLine x={history[history.length - 1]?.date} stroke="var(--muted-foreground)" strokeDasharray="3 3" label={{ value: "Today", fontSize: 10 }} />
                    <Area type="monotone" dataKey="actual" name="Actual" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.15} strokeWidth={2} />
                    <Line type="monotone" dataKey="forecast" name="Forecast" stroke="var(--primary)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </ClientOnly>
            </div>
          </Card>
        </TabsContent>

        {/* Trends */}
        <TabsContent value="trends" className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Card className="p-5">
              <div className="text-sm font-semibold mb-3 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-green-500" /> Rising categories (last 14d vs prior 14d)</div>
              {rising.length === 0 && <p className="text-sm text-muted-foreground">No significant rises detected.</p>}
              <ul className="space-y-2">
                {rising.map((r) => (
                  <li key={r.category} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{r.category}</span>
                    <Badge className="bg-green-500/15 text-green-600 border-green-500/30">+{Math.round(r.change)}%</Badge>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-5">
              <div className="text-sm font-semibold mb-3 flex items-center gap-2"><TrendingDown className="h-4 w-4 text-rose-500" /> Falling categories</div>
              {falling.length === 0 && <p className="text-sm text-muted-foreground">No significant declines detected.</p>}
              <ul className="space-y-2">
                {falling.map((r) => (
                  <li key={r.category} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{r.category}</span>
                    <Badge variant="destructive">{Math.round(r.change)}%</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card className="p-5">
            <div className="text-sm font-semibold mb-3">Weekly seasonality (avg tickets/day)</div>
            <div className="h-56">
              <ClientOnly fallback={null}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dow}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="avg" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ClientOnly>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Peak day: <span className="font-medium text-foreground">{peakDay?.day}</span> (avg {peakDay?.avg} tickets/day).
            </p>
          </Card>

          {surges.length > 0 && (
            <Card className="p-5 border-amber-500/40 bg-amber-500/5">
              <div className="text-sm font-semibold mb-2 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /> Predicted surge days</div>
              <ul className="text-sm space-y-1">
                {surges.map((s) => (
                  <li key={s.date} className="flex justify-between">
                    <span>{new Date(s.date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
                    <span className="text-amber-600 font-medium">{s.forecast} tickets</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </TabsContent>

        {/* Department workload */}
        <TabsContent value="dept" className="space-y-4">
          <Card className="p-5">
            <div className="text-sm font-semibold mb-3">Projected workload by department (next 30 days)</div>
            <div className="h-72">
              <ClientOnly fallback={null}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={perCat} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis type="number" tick={{ fontSize: 12 }} />
                    <YAxis type="category" dataKey="category" tick={{ fontSize: 12 }} width={90} />
                    <Tooltip contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="nextMonth" name="Predicted tickets" radius={[0, 4, 4, 0]}>
                      {perCat.map((d) => (
                        <rect key={d.category} fill={CAT_COLOR[d.category]} />
                      ))}
                    </Bar>
                    <Bar dataKey="recent" name="Last 14 days actual" fill="var(--muted-foreground)" opacity={0.4} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ClientOnly>
            </div>
          </Card>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
            {perCat.map((c) => (
              <Card key={c.category} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">{c.category}</div>
                  <Badge variant={c.change >= 0 ? "default" : "secondary"}>
                    {c.change >= 0 ? "+" : ""}{Math.round(c.change)}%
                  </Badge>
                </div>
                <div className="mt-2 text-2xl font-bold">{c.nextMonth}</div>
                <div className="text-xs text-muted-foreground">predicted next 30 days</div>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Insights */}
        <TabsContent value="insights" className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold flex items-center gap-2"><Brain className="h-4 w-4 text-accent" /> AI recommendations for managers</div>
              <Button size="sm" variant="outline" onClick={generateRecs} disabled={recMut.isPending}>
                {recMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              </Button>
            </div>
            {recs.length === 0 && !recMut.isPending && (
              <p className="text-sm text-muted-foreground">Click "Generate AI recommendations" to receive forecast-driven guidance.</p>
            )}
            {recMut.isPending && <p className="text-sm text-muted-foreground">Analyzing forecast…</p>}
            <ul className="space-y-2">
              {recs.map((r, i) => (
                <li key={i} className="flex gap-2 text-sm">
                  <span className="text-accent">•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5">
            <div className="text-sm font-semibold mb-3">Forecast summary</div>
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <SummaryRow label="Next week tickets" value={`${nextWeekPred} (±${Math.round(nextWeekPred * (1 - weekConfidence / 100))})`} />
              <SummaryRow label="Next month tickets" value={`${nextMonthPred} (±${Math.round(nextMonthPred * (1 - monthConfidence / 100))})`} />
              <SummaryRow label="Busiest department" value={busiest?.category ?? "—"} />
              <SummaryRow label="Expected peak day" value={peakDay?.day ?? "—"} />
              <SummaryRow label="Surge days predicted" value={String(surges.length)} />
              <SummaryRow label="Trend slope" value={`${weekFc.slope > 0 ? "↑" : weekFc.slope < 0 ? "↓" : "→"} ${weekFc.slope.toFixed(2)}/day`} />
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KPI({ icon, label, value, hint, delta }: { icon: React.ReactNode; label: string; value: string | number; hint?: string; delta?: number }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
        {icon} {label}
      </div>
      <div className="text-3xl font-bold mt-1">{value}</div>
      <div className="flex items-center gap-2 mt-1">
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
        {delta !== undefined && Math.abs(delta) > 0.5 && (
          <Badge variant="outline" className={delta > 0 ? "text-green-600 border-green-500/30" : "text-rose-600 border-rose-500/30"}>
            {delta > 0 ? "+" : ""}{Math.round(delta)}%
          </Badge>
        )}
      </div>
    </Card>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-border/50 pb-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
