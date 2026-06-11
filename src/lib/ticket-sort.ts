import type { AdminTicket } from "@/components/admin/types";

// High at top, Medium middle, Low at bottom. Critical ranks above High.
// Tickets with no priority assigned sort after Low.
const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function priorityRank(p?: string | null): number {
  if (!p) return 4;
  return PRIORITY_RANK[p] ?? 4;
}

/**
 * Default ticket ordering across the app: priority first (High → Low),
 * then oldest-first within the same priority.
 */
export function sortTicketsByPriority<T extends Pick<AdminTicket, "priority" | "created_at">>(
  tickets: T[],
): T[] {
  return [...tickets].sort((a, b) => {
    const pr = priorityRank(a.priority) - priorityRank(b.priority);
    if (pr !== 0) return pr;
    return +new Date(a.created_at) - +new Date(b.created_at);
  });
}
