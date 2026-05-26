import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminListTickets } from "@/lib/tickets.functions";
import { AnalyticsDashboard } from "@/components/admin/AnalyticsDashboard";
import { useRealtimeTickets } from "@/hooks/useRealtimeTickets";
import type { AdminTicket } from "@/components/admin/types";
import { useSupabaseSessionStatus } from "@/hooks/useSupabaseSessionStatus";

export const Route = createFileRoute("/_authenticated/analytics")({
  component: AnalyticsPage,
  head: () => ({ meta: [{ title: "Analytics — Aspire AI" }] }),
});

function AnalyticsPage() {
  const fetchTickets = useServerFn(adminListTickets);
  const sessionStatus = useSupabaseSessionStatus();
  const { data: tickets = [], refetch } = useQuery({
    queryKey: ["admin-tickets"],
    queryFn: () => fetchTickets() as Promise<AdminTicket[]>,
    enabled: sessionStatus === "authenticated",
  });
  useRealtimeTickets(() => refetch());

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Analytics & Tracking</h1>
        <p className="text-muted-foreground mt-1">KPIs, trends, and weekly insights across all tickets.</p>
      </header>
      <AnalyticsDashboard tickets={tickets} />
    </div>
  );
}
