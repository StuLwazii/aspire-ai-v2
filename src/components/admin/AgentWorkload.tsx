import { Card } from "@/components/ui/card";
import type { Agent } from "./types";

const DOT: Record<string, string> = {
  available: "bg-emerald-500",
  busy: "bg-destructive",
  offline: "bg-muted-foreground",
};
const DEPT_COLOR: Record<string, string> = {
  IT: "text-[var(--cat-it)]",
  HR: "text-[var(--cat-hr)]",
  Finance: "text-[var(--cat-finance)]",
  Operations: "text-[var(--cat-ops)]",
};

export function AgentWorkload({ agents }: { agents: Agent[] }) {
  if (agents.length === 0) return null;
  return (
    <Card className="p-4">
      <div className="text-sm font-semibold mb-3">Agent workload</div>
      <ul className="space-y-2">
        {agents.map((a) => (
          <li key={a.id} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 min-w-0">
              <span className={`h-2 w-2 rounded-full ${DOT[a.status]}`} />
              <span className={`font-medium ${DEPT_COLOR[a.department] ?? ""}`}>{a.department}</span>
              <span className="text-muted-foreground truncate">· {a.full_name}</span>
            </span>
            <span className="text-muted-foreground whitespace-nowrap">
              {a.current_ticket_count} open · {a.status}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
