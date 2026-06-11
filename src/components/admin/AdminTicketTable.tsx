import { useMemo, useState } from "react";
import type { AdminTicket } from "./types";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CategoryBadge } from "@/components/CategoryBadge";
import { AdminTicketDrawer } from "./AdminTicketDrawer";
import { Skeleton } from "@/components/ui/skeleton";
import { ThumbsUp, ThumbsDown, ArrowUpDown, Bot, User as UserIcon, AlertCircle } from "lucide-react";
import { sortTicketsByPriority } from "@/lib/ticket-sort";

const CATS = ["All", "HR", "IT", "Finance", "Operations"] as const;
const STATUSES = ["All", "open", "escalated", "in_progress", "resolved"] as const;
const RES_TABS = ["all", "self_service", "escalated", "needs_review"] as const;

const STATUS_STYLE: Record<string, string> = {
  open: "bg-accent/15 text-accent",
  escalated: "bg-destructive/15 text-destructive",
  in_progress: "bg-primary/10 text-primary",
  resolved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

const RES_STYLE: Record<string, { cls: string; label: string; Icon: typeof Bot }> = {
  self_service: { cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", label: "Self-service", Icon: Bot },
  escalated:    { cls: "bg-destructive/15 text-destructive", label: "Escalated", Icon: UserIcon },
  pending:      { cls: "bg-muted text-muted-foreground", label: "Pending", Icon: AlertCircle },
};

type Sort = "priority" | "newest" | "oldest" | "unresolved";

export function AdminTicketTable({
  tickets, loading, onChanged,
}: { tickets: AdminTicket[]; loading: boolean; onChanged: () => void }) {
  const [cat, setCat] = useState<(typeof CATS)[number]>("All");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("All");
  const [resTab, setResTab] = useState<(typeof RES_TABS)[number]>("all");
  const [dept, setDept] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("priority");
  const [selected, setSelected] = useState<AdminTicket | null>(null);

  const departments = useMemo(() => {
    const s = new Set<string>();
    tickets.forEach((t) => t.app_users?.department && s.add(t.app_users.department));
    return ["All", ...[...s].sort()];
  }, [tickets]);

  const filtered = useMemo(() => {
    let rows = tickets.filter((t) => {
      if (cat !== "All" && t.category !== cat) return false;
      if (status !== "All" && t.status !== status) return false;
      if (resTab === "self_service" && t.resolution_type !== "self_service") return false;
      if (resTab === "escalated" && t.resolution_type !== "escalated") return false;
      if (resTab === "needs_review" && !(t.rating === "down" || (t.resolution_type === "escalated" && t.status !== "resolved"))) return false;
      if (dept && dept !== "All" && t.app_users?.department !== dept) return false;
      if (from && new Date(t.created_at) < new Date(from)) return false;
      if (to && new Date(t.created_at) > new Date(`${to}T23:59:59`)) return false;
      if (q) {
        const needle = q.toLowerCase();
        const hay = `${t.id} ${t.message} ${t.app_users?.name ?? ""} ${t.app_users?.email ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    if (sort === "priority") rows = sortTicketsByPriority(rows);
    if (sort === "newest") rows = [...rows].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    if (sort === "oldest") rows = [...rows].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
    if (sort === "unresolved") rows = [...rows].sort((a, b) => (a.status === "resolved" ? 1 : 0) - (b.status === "resolved" ? 1 : 0));
    return rows;
  }, [tickets, cat, status, resTab, dept, from, to, q, sort]);

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-3 pt-3 flex flex-wrap gap-1 border-b">
        {RES_TABS.map((r) => (
          <button
            key={r}
            onClick={() => setResTab(r)}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              resTab === r ? "bg-secondary text-foreground font-medium" : "text-muted-foreground hover:bg-secondary/60"
            }`}
          >
            {r === "all" ? "All" : r === "self_service" ? "🤖 Self-service" : r === "escalated" ? "👤 Escalated" : "⚠️ Needs review"}
          </button>
        ))}
      </div>
      <div className="p-3 border-b grid gap-2 md:grid-cols-[1fr_auto_auto_auto_auto_auto]">
        <Input placeholder="Search by id, name, email, or text…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value={cat} onChange={(e) => setCat(e.target.value as typeof cat)}>
          {CATS.map((c) => <option key={c} value={c}>{c === "All" ? "All categories" : c}</option>)}
        </select>
        <select className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s === "All" ? "All statuses" : s.replace("_", " ")}</option>)}
        </select>
        <select className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value={dept} onChange={(e) => setDept(e.target.value)}>
          {departments.map((d) => <option key={d} value={d === "All" ? "" : d}>{d === "All" ? "All depts" : d}</option>)}
        </select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" />
      </div>

      <div className="flex items-center justify-between px-3 py-2 border-b text-xs text-muted-foreground">
        <span>{filtered.length} of {tickets.length} tickets</span>
        <button onClick={() => setSort(sort === "priority" ? "newest" : sort === "newest" ? "oldest" : sort === "oldest" ? "unresolved" : "priority")} className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowUpDown className="h-3 w-3" /> {sort === "priority" ? "Priority (high → low)" : sort === "newest" ? "Newest first" : sort === "oldest" ? "Oldest first" : "Unresolved first"}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left p-3 font-semibold">ID</th>
              <th className="text-left p-3 font-semibold">User</th>
              <th className="text-left p-3 font-semibold">Summary</th>
              <th className="text-left p-3 font-semibold">Category</th>
              <th className="text-left p-3 font-semibold">Resolution</th>
              <th className="text-left p-3 font-semibold">Agent</th>
              <th className="text-left p-3 font-semibold">Status</th>
              <th className="text-left p-3 font-semibold">Rating</th>
              <th className="text-left p-3 font-semibold">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(4)].map((_, i) => (
                <tr key={i}><td colSpan={9} className="p-3"><Skeleton className="h-6 w-full" /></td></tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="p-12 text-center text-muted-foreground">No tickets match your filters.</td></tr>
            ) : filtered.map((t) => {
              const r = RES_STYLE[t.resolution_type ?? "pending"];
              const escalated = t.resolution_type === "escalated" && t.status !== "resolved";
              return (
                <tr key={t.id} onClick={() => setSelected(t)} className={`border-t cursor-pointer ${escalated ? "bg-destructive/5 hover:bg-destructive/10" : "hover:bg-secondary/40"}`}>
                  <td className="p-3 font-mono text-xs">#{t.id.slice(0, 8)}</td>
                  <td className="p-3">
                    <div className="font-medium">{t.app_users?.name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{t.app_users?.email}</div>
                  </td>
                  <td className="p-3 max-w-xs truncate">{t.message.slice(0, 100)}</td>
                  <td className="p-3"><CategoryBadge category={t.category} /></td>
                  <td className="p-3">
                    <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${r.cls}`}>
                      <r.Icon className="h-3 w-3" /> {r.label}
                    </span>
                  </td>
                  <td className="p-3 text-xs">{t.agents?.full_name ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="p-3"><span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${STATUS_STYLE[t.status]}`}>{t.status.replace("_", " ")}</span></td>
                  <td className="p-3">
                    {t.rating === "up" ? <ThumbsUp className="h-4 w-4 text-accent" /> :
                     t.rating === "down" ? <ThumbsDown className="h-4 w-4 text-destructive" /> :
                     <span className="text-muted-foreground text-xs">—</span>}
                  </td>
                  <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(t.created_at).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <AdminTicketDrawer ticket={selected} onClose={() => setSelected(null)} onChanged={onChanged} onUpdated={(t) => setSelected(t)} />
    </Card>
  );
}
