import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import {
  agentListMyTickets,
  agentGetConversation,
  agentRespondToTicket,
} from "@/lib/tickets.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CategoryBadge } from "@/components/CategoryBadge";
import { toast } from "sonner";
import { Inbox, Send, CheckCircle2, AlertCircle, ArrowUpDown } from "lucide-react";
import { useRealtimeTickets } from "@/hooks/useRealtimeTickets";
import type { AdminTicket } from "@/components/admin/types";
import { useSupabaseSessionStatus } from "@/hooks/useSupabaseSessionStatus";
import { sortTicketsByPriority } from "@/lib/ticket-sort";

export const Route = createFileRoute("/_authenticated/my-queue")({
  component: MyQueuePage,
  head: () => ({ meta: [{ title: "My queue — Aspire AI" }] }),
});

type Msg = { id: string; ticket_id: string; role: string; message: string; created_at: string };

const STATUS_STYLE: Record<string, string> = {
  open: "bg-accent/15 text-accent",
  in_progress: "bg-primary/10 text-primary",
  escalated: "bg-destructive/15 text-destructive",
  resolved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

const PRIORITY_STYLE: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-secondary text-secondary-foreground",
  high: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  critical: "bg-destructive/20 text-destructive",
};

function MyQueuePage() {
  const listFn = useServerFn(agentListMyTickets);
  const convoFn = useServerFn(agentGetConversation);
  const respondFn = useServerFn(agentRespondToTicket);
  const sessionStatus = useSupabaseSessionStatus();

  const { data, refetch, isLoading } = useQuery({
    queryKey: ["agent-my-queue"],
    queryFn: () => listFn() as Promise<{ agent: { id: string; full_name: string; department: string }; tickets: AdminTicket[] }>,
    enabled: sessionStatus === "authenticated",
  });

  useRealtimeTickets(() => refetch());

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Msg[]>([]);
  const [reply, setReply] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const tickets = data?.tickets ?? [];
  const agent = data?.agent;
  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    if (!selectedId) {
      setConversation([]);
      setNotes("");
      return;
    }
    convoFn({ data: { ticketId: selectedId } })
      .then((rows) => setConversation(rows as Msg[]))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load conversation"));
    setNotes(selected?.admin_notes ?? "");
  }, [selectedId, convoFn, selected?.admin_notes, sessionStatus]);

  const open = sortTicketsByPriority(tickets.filter((t) => t.status !== "resolved"));
  const resolved = sortTicketsByPriority(tickets.filter((t) => t.status === "resolved"));

  const send = async (status?: "in_progress" | "resolved") => {
    if (!selectedId) return;
    setBusy(true);
    try {
      await respondFn({ data: {
        ticketId: selectedId,
        response: reply.trim() || undefined,
        status,
        admin_notes: notes,
      }});
      toast.success(status === "resolved" ? "Marked resolved" : "Updated");
      setReply("");
      refetch();
      if (selectedId) {
        const rows = await convoFn({ data: { ticketId: selectedId } });
        setConversation(rows as Msg[]);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-4">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">My queue</h1>
        <p className="text-muted-foreground mt-1">
          {agent ? <>Welcome, <span className="font-medium text-foreground">{agent.full_name}</span> · {agent.department} agent</> : "Loading…"}
        </p>
      </header>

      <div className="grid lg:grid-cols-[1fr_2fr] gap-4">
        <Card className="p-0 overflow-hidden h-fit">
          <div className="px-3 py-2 border-b text-xs font-semibold uppercase tracking-wide text-muted-foreground bg-secondary/40 flex items-center justify-between">
            <span className="flex items-center gap-1.5"><Inbox className="h-3.5 w-3.5" /> Active ({open.length})</span>
            <span className="text-[10px] opacity-70">{resolved.length} resolved</span>
          </div>
          <div className="max-h-[70vh] overflow-y-auto divide-y">
            {isLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Loading…</div>
            ) : tickets.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">No tickets assigned to you yet.</div>
            ) : (
              [...open, ...resolved].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full text-left p-3 hover:bg-secondary/50 transition-colors ${selectedId === t.id ? "bg-secondary/70" : ""}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${STATUS_STYLE[t.status]}`}>{t.status.replace("_", " ")}</span>
                    {t.priority && <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${PRIORITY_STYLE[t.priority]}`}>{t.priority}</span>}
                  </div>
                  <div className="font-medium text-sm line-clamp-1">{(t as AdminTicket & { title?: string }).title ?? t.message.slice(0, 60)}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {t.app_users?.name ?? "—"} · <span className="font-mono">#{t.id.slice(0, 8)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          {!selected ? (
            <div className="p-12 text-center text-sm text-muted-foreground">Select a ticket to view details.</div>
          ) : (
            <div className="flex flex-col h-[70vh]">
              <div className="px-4 py-3 border-b">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-muted-foreground font-mono">#{selected.id.slice(0, 8)}</div>
                    <h2 className="text-lg font-semibold mt-0.5">{(selected as AdminTicket & { title?: string }).title ?? "Untitled"}</h2>
                    <div className="flex items-center gap-2 mt-2">
                      <CategoryBadge category={selected.category} />
                      <Badge variant="outline" className={STATUS_STYLE[selected.status]}>{selected.status.replace("_", " ")}</Badge>
                      {selected.priority && <Badge variant="outline" className={PRIORITY_STYLE[selected.priority]}>{selected.priority}</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-2">
                      From <span className="font-medium text-foreground">{selected.app_users?.name}</span> · {selected.app_users?.email}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-secondary/20">
                {conversation.map((m) => (
                  <div key={m.id} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-background border" : "bg-accent text-accent-foreground"}`}>
                      <div className="text-[10px] uppercase tracking-wide opacity-70 mb-1">{m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "Agent"}</div>
                      {m.message}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t p-3 space-y-2">
                <Textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Write a response to the user…"
                  rows={3}
                  maxLength={5000}
                />
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Internal notes (only visible to staff)…"
                  rows={2}
                  maxLength={5000}
                  className="text-xs"
                />
                <div className="flex flex-wrap gap-2 justify-end">
                  <Button size="sm" variant="outline" disabled={busy || (!reply.trim() && notes === (selected.admin_notes ?? ""))} onClick={() => send("in_progress")}>
                    <Send className="h-4 w-4 mr-1.5" /> Save & reply
                  </Button>
                  <Button size="sm" disabled={busy} onClick={() => send("resolved")} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    <CheckCircle2 className="h-4 w-4 mr-1.5" /> Resolve
                  </Button>
                </div>
                {selected.resolution_type === "escalated" && (
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> Escalated by AI: {selected.escalation_reason ?? "—"}
                  </p>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
