import { Card } from "@/components/ui/card";
import type { Database } from "@/integrations/supabase/types";
import { BarChart, Bar, ResponsiveContainer, XAxis, Tooltip, Cell } from "recharts";
import { ClientOnly } from "@tanstack/react-router";

type Ticket = Database["public"]["Tables"]["tickets"]["Row"];
const CATS = ["IT", "Finance", "HR", "Operations"] as const;
const COLORS: Record<string, string> = {
  IT: "var(--cat-it)", Finance: "var(--cat-finance)", HR: "var(--cat-hr)", Operations: "var(--cat-ops)",
};

export function AnalyticsCards({ tickets }: { tickets: Ticket[] }) {
  const total = tickets.length;
  const open = tickets.filter((t) => t.status === "open").length;
  const inProgress = tickets.filter((t) => t.status === "in_progress").length;
  const resolved = tickets.filter((t) => t.status === "resolved").length;
  const data = CATS.map((c) => ({ name: c, count: tickets.filter((t) => t.category === c).length }));

  const Stat = ({ label, value, accent }: { label: string; value: number; accent?: boolean }) => (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-3xl font-bold mt-1 ${accent ? "text-accent" : ""}`}>{value}</div>
    </Card>
  );

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
      <Stat label="Total" value={total} />
      <Stat label="Open" value={open} accent />
      <Stat label="In progress" value={inProgress} />
      <Stat label="Resolved" value={resolved} />
      <Card className="p-4 col-span-2 md:col-span-4 lg:col-span-1">
        <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">By category</div>
        <div className="h-16">
          <ClientOnly fallback={null}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "transparent" }} contentStyle={{ fontSize: 12, padding: "4px 8px" }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {data.map((d) => <Cell key={d.name} fill={COLORS[d.name]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ClientOnly>
        </div>
      </Card>
    </div>
  );
}