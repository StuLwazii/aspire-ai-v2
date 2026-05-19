import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { adminGetConversation, adminUpdateTicket, adminDeleteTicket } from "@/lib/tickets.functions";
import type { AdminTicket } from "./types";
import type { Database } from "@/integrations/supabase/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CategoryBadge } from "@/components/CategoryBadge";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { toast } from "sonner";
import { Save, Trash2, ThumbsUp, ThumbsDown } from "lucide-react";

type Status = Database["public"]["Enums"]["ticket_status"];
const STATUSES: { id: Status; label: string }[] = [
  { id: "open", label: "Open" }, { id: "in_progress", label: "In progress" }, { id: "resolved", label: "Resolved" },
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

  const [response, setResponse] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ticket) {
      setResponse(ticket.ai_response ?? "");
      setNotes(ticket.admin_notes ?? "");
    }
  }, [ticket]);

  const { data: conversation = [] } = useQuery({
    queryKey: ["conversation", ticket?.id],
    queryFn: () => getConv({ data: { ticketId: ticket!.id } }),
    enabled: !!ticket,
  });

  if (!ticket) return null;

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

  const remove = async () => {
    if (!confirm("Delete this ticket and its conversation?")) return;
    setBusy(true);
    try {
      await del({ data: { id: ticket.id } });
      toast.success("Ticket deleted"); onChanged(); onClose();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={!!ticket} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>Ticket</span>
            <span className="text-xs font-mono text-muted-foreground">#{ticket.id.slice(0, 8)}</span>
            <CategoryBadge category={ticket.category} />
            {ticket.rating === "up" && <ThumbsUp className="h-4 w-4 text-accent" />}
            {ticket.rating === "down" && <ThumbsDown className="h-4 w-4 text-destructive" />}
          </DialogTitle>
          <DialogDescription>
            {ticket.app_users?.name} ({ticket.app_users?.email}) · {ticket.app_users?.department} · {new Date(ticket.created_at).toLocaleString()}
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Conversation</h3>
          <div className="space-y-3 p-3 bg-secondary/30 rounded-md max-h-72 overflow-y-auto">
            {conversation.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No messages</p>
            ) : conversation.map((m) => (
              <ChatBubble key={m.id} role={m.role as "user" | "assistant"} message={m.message} timestamp={m.created_at} />
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">AI response (editable)</h3>
          <Textarea value={response} onChange={(e) => setResponse(e.target.value)} rows={5} />
        </section>

        <section className="space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Internal notes (not visible to user)</h3>
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
