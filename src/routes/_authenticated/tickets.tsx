import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { adminListTickets } from "@/lib/tickets.functions";
import { AdminTicketTable } from "@/components/admin/AdminTicketTable";
import { useRealtimeTickets } from "@/hooks/useRealtimeTickets";
import type { AdminTicket } from "@/components/admin/types";

export const Route = createFileRoute("/_authenticated/tickets")({
  component: TicketsPage,
  head: () => ({ meta: [{ title: "Tickets — Helix" }] }),
});

function TicketsPage() {
  const fetchTickets = useServerFn(adminListTickets);
  const { data: tickets = [], refetch, isLoading } = useQuery({
    queryKey: ["admin-tickets"],
    queryFn: () => fetchTickets() as Promise<AdminTicket[]>,
  });
  useRealtimeTickets(() => refetch());

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-4">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Tickets</h1>
        <p className="text-muted-foreground mt-1">All tickets from users, with filters and search.</p>
      </header>
      <AdminTicketTable tickets={tickets} loading={isLoading} onChanged={() => refetch()} />
    </div>
  );
}
