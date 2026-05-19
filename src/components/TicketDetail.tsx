import { useEffect, useState } from "react";
import type { Database } from "@/integrations/supabase/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useServerFn } from "@tanstack/react-start";
import { updateTicket, regenerateResponse } from "@/lib/tickets.functions";
import { CategoryBadge } from "./CategoryBadge";
import { toast } from "sonner";
import { Copy, RefreshCw, Save } from "lucide-react";

type Ticket = Database["public"]["Tables"]["tickets"]["Row"];
type Status = Database["public"]["Enums"]["ticket_status"];
const STATUSES: { id: Status; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "in_progress", label: "In progress" },
  { id: "resolved", label: "Resolved" },
];
const TONES = ["formal", "friendly", "urgent"] as const;

export function TicketDetail({
  ticket, onClose, onChanged, onUpdated,
}: {
  ticket: Ticket | null;
  onClose: () => void;
  onChanged: () => void;
  onUpdated: (t: Ticket) => void;
}) {
  const update = useServerFn(updateTicket);
  const regen = useServerFn(regenerateResponse);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ticket) { setDraft(ticket.ai_response ?? ""); setEditing(false); }
  }, [ticket]);

  if (!ticket) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(ticket.ai_response ?? "");
    toast.success("Response copied to clipboard");
  };

  const save = async () => {
    setBusy(true);
    try {
      const row = await update({ data: { id: ticket.id, ai_response: draft } });
      onUpdated(row as Ticket); onChanged(); setEditing(false);
      toast.success("Response updated");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  const setStatus = async (status: Status) => {
    setBusy(true);
    try {
      const row = await update({ data: { id: ticket.id, status } });
      onUpdated(row as Ticket); onChanged();
      toast.success(`Marked ${status.replace("_", " ")}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  const regenerate = async (tone: (typeof TONES)[number]) => {
    setBusy(true);
    try {
      const row = await regen({ data: { id: ticket.id, tone } });
      onUpdated(row as Ticket); onChanged(); setDraft((row as Ticket).ai_response ?? "");
      toast.success(`Regenerated in ${tone} tone`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={!!ticket} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>Ticket</span>
            <span className="text-xs font-mono text-muted-foreground">#{ticket.id.slice(0, 8)}</span>
            <CategoryBadge category={ticket.category} />
          </DialogTitle>
          <DialogDescription>
            Submitted {new Date(ticket.created_at).toLocaleString()}
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Original message</h3>
          <div className="p-3 rounded-md bg-secondary text-sm whitespace-pre-wrap">{ticket.message}</div>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">AI response</h3>
            <div className="flex gap-1">
              {TONES.map((t) => (
                <button
                  key={t}
                  onClick={() => regenerate(t)}
                  disabled={busy}
                  className={`text-[11px] px-2 py-1 rounded border transition ${
                    ticket.tone === t ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-secondary"
                  }`}
                >
                  <RefreshCw className="inline h-3 w-3 mr-1" />{t}
                </button>
              ))}
            </div>
          </div>
          {editing ? (
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={6} />
          ) : (
            <div className="p-3 rounded-md border border-border text-sm whitespace-pre-wrap">
              {ticket.ai_response || "—"}
            </div>
          )}
          <div className="flex gap-2">
            {editing ? (
              <>
                <Button size="sm" onClick={save} disabled={busy}><Save className="h-3.5 w-3.5 mr-1.5" />Save</Button>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(ticket.ai_response ?? ""); }}>Cancel</Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={copy}><Copy className="h-3.5 w-3.5 mr-1.5" />Copy</Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>
              </>
            )}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Status</h3>
          <div className="flex gap-2 flex-wrap">
            {STATUSES.map((s) => (
              <Button
                key={s.id}
                size="sm"
                variant={ticket.status === s.id ? "default" : "outline"}
                onClick={() => setStatus(s.id)}
                disabled={busy || ticket.status === s.id}
              >
                {s.label}
              </Button>
            ))}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}