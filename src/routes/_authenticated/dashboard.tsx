import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminListTickets } from "@/lib/tickets.functions";
import { AnalyticsOverview } from "@/components/admin/AnalyticsOverview";
import { useRealtimeTickets } from "@/hooks/useRealtimeTickets";
import type { AdminTicket } from "@/components/admin/types";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
  head: () => ({ meta: [{ title: "Admin Dashboard — Helix" }] }),
});

function DashboardPage() {
  const fetchTickets = useServerFn(adminListTickets);
  const { data: tickets = [], refetch } = useQuery({
    queryKey: ["admin-tickets"],
    queryFn: () => fetchTickets() as Promise<AdminTicket[]>,
  });
  useRealtimeTickets(() => refetch());

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Live overview of all incoming tickets.</p>
      </header>
      <AnalyticsOverview tickets={tickets} />
    </div>
  );
}
