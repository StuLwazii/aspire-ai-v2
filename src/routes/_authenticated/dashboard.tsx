import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { adminListTickets, adminListAgents } from "@/lib/tickets.functions";
import { AnalyticsOverview } from "@/components/admin/AnalyticsOverview";
import { AgentWorkload } from "@/components/admin/AgentWorkload";
import { useRealtimeTickets } from "@/hooks/useRealtimeTickets";
import type { AdminTicket, Agent } from "@/components/admin/types";
import { toast } from "sonner";
import { useSupabaseSessionStatus } from "@/hooks/useSupabaseSessionStatus";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
  head: () => ({ meta: [{ title: "Admin Dashboard — Helix" }] }),
});

function DashboardPage() {
  const fetchTickets = useServerFn(adminListTickets);
  const fetchAgents = useServerFn(adminListAgents);
  const sessionStatus = useSupabaseSessionStatus();
  const canCallProtectedFns = sessionStatus === "authenticated";
  const { data: tickets = [], refetch } = useQuery({
    queryKey: ["admin-tickets"],
    queryFn: () => fetchTickets() as Promise<AdminTicket[]>,
    enabled: canCallProtectedFns,
  });
  const { data: agents = [], refetch: refetchAgents } = useQuery({
    queryKey: ["agents"],
    queryFn: () => fetchAgents() as Promise<Agent[]>,
    enabled: canCallProtectedFns,
  });
  useRealtimeTickets(() => { refetch(); refetchAgents(); });

  // Live notification for newly escalated tickets
  const announced = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ch = supabase
      .channel("escalation-alerts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "tickets" }, (payload) => {
        const t = payload.new as AdminTicket;
        if (t.resolution_type === "escalated" && !announced.current.has(t.id)) {
          announced.current.add(t.id);
          toast.warning(`New escalated ticket — ${t.category}`, {
            description: t.message?.slice(0, 120),
          });
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "tickets" }, (payload) => {
        const t = payload.new as AdminTicket;
        const old = payload.old as Partial<AdminTicket>;
        if (t.resolution_type === "escalated" && old.resolution_type !== "escalated" && !announced.current.has(t.id)) {
          announced.current.add(t.id);
          toast.warning(`Ticket escalated — ${t.category}`, {
            description: t.message?.slice(0, 120),
          });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Live overview of all incoming tickets.</p>
      </header>
      <div className="grid lg:grid-cols-[1fr_280px] gap-4">
        <AnalyticsOverview tickets={tickets} />
        <AgentWorkload agents={agents} />
      </div>
    </div>
  );
}
