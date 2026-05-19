import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listTickets } from "@/lib/tickets.functions";
import { TicketForm } from "@/components/TicketForm";
import { TicketList } from "@/components/TicketList";
import { AnalyticsCards } from "@/components/AnalyticsCards";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
  head: () => ({ meta: [{ title: "Dashboard — Helix Help Desk" }] }),
});

function DashboardPage() {
  const fetchTickets = useServerFn(listTickets);
  const { data: tickets = [], refetch, isLoading } = useQuery({
    queryKey: ["tickets"],
    queryFn: () => fetchTickets(),
  });

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Submit a ticket and let AI classify and draft a response.</p>
      </header>

      <AnalyticsCards tickets={tickets} />

      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2">
          <TicketForm onCreated={() => refetch()} />
        </div>
        <div className="lg:col-span-3">
          <TicketList tickets={tickets} loading={isLoading} onChanged={() => refetch()} />
        </div>
      </div>
    </div>
  );
}