import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { adminGetConversation, adminUpdateTicket, adminDeleteTicket, adminListAgents } from "@/lib/tickets.functions";
import type { AdminTicket, Agent } from "./types";
import type { Database } from "@/integrations/supabase/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CategoryBadge } from "@/components/CategoryBadge";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { toast } from "sonner";
import { Save, Trash2, ThumbsUp, ThumbsDown, Bot, User as UserIcon, AlertCircle } from "lucide-react";
import { useSupabaseSessionStatus } from "@/hooks/useSupabaseSessionStatus";

type Status = Database["public"]["Enums"]["ticket_status"];
const STATUSES: { id: Status; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "escalated" as Status, label: "Escalated" },
  { id: "in_progress", label: "In progress" },
  { id: "resolved", label: "Resolved" },
];

export function AdminTicketDrawer({
  ticket, onClose, onChanged, onUpdated,
}: {
  ticket: AdminTicket | null;
  onClose: () => void;
  onChanged: () => void;
  onUpdated: (t: AdminTicket) => void;
}) {
  const getConv = useServerFn(adminGetConversation);
  const update = useServerFn(adminUpdateTicket);
  const del = useServerFn(adminDeleteTicket);
  const listAgents = useServerFn(adminListAgents);
  const sessionStatus = useSupabaseSessionStatus();
  const canCallProtectedFns = sessionStatus === "authenticated";

  const [response, setResponse] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ticket) { setResponse(ticket.ai_response ?? ""); setNotes(ticket.admin_notes ?? ""); }
  }, [ticket]);

  const { data: conversation = [] } = useQuery({
    queryKey: ["conversation", ticket?.id],
    queryFn: () => getConv({ data: { ticketId: ticket!.id } }),
    enabled: !!ticket && canCallProtectedFns,
  });

  const { data: agents = [] } = useQuery({
    queryKey: ["agents-for-drawer"],
    queryFn: () => listAgents() as Promise<Agent[]>,
    enabled: !!ticket && canCallProtectedFns,
  });

  if (!ticket) return null;

  const departmentAgents = agents.filter((a) => a.department === ticket.category);

  const save = async () => {
    setBusy(true);
    try {
      const row = await update({ data: { id: ticket.id, ai_response: response, admin_notes: notes } });
      onUpdated({ ...ticket, ...(row as object) } as AdminTicket); onChanged();
      toast.success("Ticket updated");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  const setStatus = async (status: Status) => {
    setBusy(true);
    try {
      const row = await update({ data: { id: ticket.id, status } });
      onUpdated({ ...ticket, ...(row as object) } as AdminTicket); onChanged();
      toast.success(`Marked ${status.replace("_", " ")}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  const reassign = async (agentId: string) => {
    setBusy(true);
    try {
      const row = await update({ data: { id: ticket.id, assigned_agent_id: agentId } });
      onUpdated({ ...ticket, ...(row as object) } as AdminTicket); onChanged();
      toast.success("Reassigned");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  const overrideSelfService = async () => {
    setBusy(true);
    try {
      const row = await update({ data: { id: ticket.id, resolution_type: "self_service", status: "resolved" } });
      onUpdated({ ...ticket, ...(row as object) } as AdminTicket); onChanged();
      toast.success("Marked as self-service resolved");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!confirm("Delete this ticket and its conversation?")) return;
    setBusy(true);
    try {
      await del({ data: { id: ticket.id } });
      toast.success("Ticket deleted"); onChanged(); onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  const resType = ticket.resolution_type ?? "pending";
  const resBadge =
    resType === "self_service" ? { Icon: Bot, label: "Self-service", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" } :
    resType === "escalated"    ? { Icon: UserIcon, label: "Escalated", cls: "bg-destructive/15 text-destructive" } :
                                  { Icon: AlertCircle, label: "Pending", cls: "bg-muted text-muted-foreground" };

  return (
    <Dialog open={!!ticket} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>Ticket</span>
            <span className="text-xs font-mono text-muted-foreground">#{ticket.id.slice(0, 8)}</span>
            <CategoryBadge category={ticket.category} />
            <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${resBadge.cls}`}>
              <resBadge.Icon className="h-3 w-3" /> {resBadge.label}
            </span>
            {ticket.priority && (
              <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-secondary text-foreground">
                {ticket.priority}
              </span>
            )}
            {ticket.rating === "up" && <ThumbsUp className="h-4 w-4 text-accent" />}
            {ticket.rating === "down" && <ThumbsDown className="h-4 w-4 text-destructive" />}
          </DialogTitle>
          <DialogDescription>
            {ticket.app_users?.name} ({ticket.app_users?.email}) · {ticket.app_users?.department} · {new Date(ticket.created_at).toLocaleString()}
          </DialogDescription>
        </DialogHeader>

        {ticket.escalation_reason && (
          <section className="space-y-1">
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">AI triage reason</h3>
            <p className="text-sm bg-secondary/40 rounded p-2 border">{ticket.escalation_reason}</p>
          </section>
        )}

        <section className="space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Conversation</h3>
          <div className="space-y-3 p-3 bg-secondary/30 rounded-md max-h-72 overflow-y-auto">
            {conversation.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No messages</p>
            ) : conversation.map((m) => (
              <ChatBubble key={m.id} role={(m.role === "user" ? "user" : "assistant")} message={m.message} timestamp={m.created_at} />
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Assigned agent</h3>
            <select
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              value={ticket.assigned_agent_id ?? ""}
              onChange={(e) => reassign(e.target.value)}
              disabled={busy || departmentAgents.length === 0}
            >
              <option value="">— unassigned —</option>
              {departmentAgents.map((a) => (
                <option key={a.id} value={a.id}>{a.full_name} ({a.status}) · {a.current_ticket_count} open</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Override</h3>
            <Button size="sm" variant="outline" onClick={overrideSelfService} disabled={busy}>
              <Bot className="h-3.5 w-3.5 mr-1.5" />Mark as self-service & resolved
            </Button>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">AI response (editable)</h3>
          <Textarea value={response} onChange={(e) => setResponse(e.target.value)} rows={5} />
        </section>

        <section className="space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Internal notes</h3>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Internal notes…" />
        </section>

        <section className="space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Status</h3>
          <div className="flex gap-2 flex-wrap">
            {STATUSES.map((s) => (
              <Button key={s.id} size="sm" variant={ticket.status === s.id ? "default" : "outline"}
                onClick={() => setStatus(s.id)} disabled={busy || ticket.status === s.id}>
                {s.label}
              </Button>
            ))}
          </div>
        </section>

        <div className="flex justify-between gap-2 pt-2 border-t">
          <Button variant="destructive" size="sm" onClick={remove} disabled={busy}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" />Delete
          </Button>
          <Button size="sm" onClick={save} disabled={busy}>
            <Save className="h-3.5 w-3.5 mr-1.5" />Save changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
