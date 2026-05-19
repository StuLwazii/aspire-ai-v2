import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listTickets } from "@/lib/tickets.functions";
import { TicketList } from "@/components/TicketList";

export const Route = createFileRoute("/_authenticated/tickets")({
  component: TicketsPage,
  head: () => ({ meta: [{ title: "Tickets — Helix Help Desk" }] }),
});

function TicketsPage() {
  const fetchTickets = useServerFn(listTickets);
  const { data: tickets = [], refetch, isLoading } = useQuery({
    queryKey: ["tickets"],
    queryFn: () => fetchTickets(),
  });
  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-4">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Tickets</h1>
        <p className="text-muted-foreground mt-1">All classified tickets across departments.</p>
      </header>
      <TicketList tickets={tickets} loading={isLoading} onChanged={() => refetch()} />
    </div>
  );
}