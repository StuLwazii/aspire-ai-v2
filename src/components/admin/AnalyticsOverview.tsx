import { Card } from "@/components/ui/card";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  BarChart, Bar, ResponsiveContainer, XAxis, YAxis, Tooltip, Cell,
  LineChart, Line, CartesianGrid, PieChart, Pie, Legend,
} from "recharts";
import { ClientOnly } from "@tanstack/react-router";
import type { AdminTicket } from "./types";

const CAT_COLORS: Record<string, string> = {
  IT: "var(--cat-it)", Finance: "var(--cat-finance)", HR: "var(--cat-hr)", Operations: "var(--cat-ops)",
};
const STATUS_COLORS: Record<string, string> = {
  open: "var(--accent)",
  in_progress: "var(--primary)",
  resolved: "oklch(0.65 0.15 150)",
};

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-3xl font-bold mt-1">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </Card>
  );
}

function bucket(tickets: AdminTicket[], grain: "day" | "week") {
  const buckets = new Map<string, number>();
  for (const t of tickets) {
    const d = new Date(t.created_at);
    let key: string;
    if (grain === "day") {
      key = d.toISOString().slice(0, 10);
    } else {
      const day = d.getUTCDay();
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
      key = monday.toISOString().slice(0, 10);
    }
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}

export function AnalyticsOverview({ tickets }: { tickets: AdminTicket[] }) {
  const [grain, setGrain] = useState<"day" | "week">("day");

  const total = tickets.length;
  const open = tickets.filter((t) => t.status === "open").length;
  const resolved = tickets.filter((t) => t.status === "resolved").length;
  const rated = tickets.filter((t) => t.rating);
  const up = rated.filter((t) => t.rating === "up").length;
  const avgRating = rated.length ? `${Math.round((up / rated.length) * 100)}%` : "—";

  const byCat = ["IT", "Finance", "HR", "Operations"].map((c) => ({
    name: c, count: tickets.filter((t) => t.category === c).length,
  }));
  const byStatus = ["open", "in_progress", "resolved"].map((s) => ({
    name: s.replace("_", " "), key: s, value: tickets.filter((t) => t.status === s).length,
  })).filter((d) => d.value > 0);
  const series = bucket(tickets, grain);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="Total tickets" value={total} />
        <Stat label="Open" value={open} />
        <Stat label="Resolved" value={resolved} />
        <Stat label="Avg rating" value={avgRating} hint={rated.length ? `${rated.length} rated` : "No ratings yet"} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <div className="text-sm font-semibold mb-3">Tickets by category</div>
          <div className="h-56">
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
          <div className="text-sm font-semibold mb-3">Status breakdown</div>
          <div className="h-56">
            <ClientOnly fallback={null}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={byStatus} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {byStatus.map((d) => <Cell key={d.key} fill={STATUS_COLORS[d.key]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </ClientOnly>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold">Tickets over time</div>
          <div className="flex gap-1">
            <Button size="sm" variant={grain === "day" ? "default" : "outline"} onClick={() => setGrain("day")}>Daily</Button>
            <Button size="sm" variant={grain === "week" ? "default" : "outline"} onClick={() => setGrain("week")}>Weekly</Button>
          </div>
        </div>
        <div className="h-64">
          <ClientOnly fallback={null}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="count" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </ClientOnly>
        </div>
      </Card>
    </div>
  );
}
