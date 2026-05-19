import { useMemo, useState } from "react";
import type { Database } from "@/integrations/supabase/types";
import { Card } from "@/components/ui/card";
import { CategoryBadge } from "./CategoryBadge";
import { TicketDetail } from "./TicketDetail";
import { Skeleton } from "@/components/ui/skeleton";

type Ticket = Database["public"]["Tables"]["tickets"]["Row"];
type Cat = Database["public"]["Enums"]["ticket_category"] | "All";
const CATS: Cat[] = ["All", "HR", "IT", "Finance", "Operations"];

const STATUS_STYLE: Record<string, string> = {
  open: "bg-accent/15 text-accent",
  in_progress: "bg-primary/10 text-primary",
  resolved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

export function TicketList({ tickets, loading, onChanged }: { tickets: Ticket[]; loading: boolean; onChanged: () => void }) {
  const [filter, setFilter] = useState<Cat>("All");
  const [selected, setSelected] = useState<Ticket | null>(null);

  const filtered = useMemo(
    () => (filter === "All" ? tickets : tickets.filter((t) => t.category === filter)),
    [filter, tickets],
  );

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex items-center gap-1 p-2 border-b overflow-x-auto">
        {CATS.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              filter === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            {c}
            {c !== "All" && (
              <span className="ml-1.5 opacity-60">
                {tickets.filter((t) => t.category === c).length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="divide-y">
        {loading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="p-4 space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/4" /></div>
          ))
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No tickets yet. Submit one to see it appear here.
          </div>
        ) : (
          filtered.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelected(t)}
              className="w-full text-left p-4 hover:bg-secondary/50 transition-colors flex items-start gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <CategoryBadge category={t.category} />
                  <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${STATUS_STYLE[t.status]}`}>
                    {t.status.replace("_", " ")}
                  </span>
                  <span className="text-xs text-muted-foreground font-mono">#{t.id.slice(0, 8)}</span>
                </div>
                <p className="text-sm text-foreground line-clamp-2">{t.message}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(t.created_at).toLocaleString()}
                </p>
              </div>
            </button>
          ))
        )}
      </div>

      <TicketDetail
        ticket={selected}
        onClose={() => setSelected(null)}
        onChanged={() => { onChanged(); }}
        onUpdated={(t) => setSelected(t)}
      />
    </Card>
  );
}