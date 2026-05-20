import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { userListTicketsByEmail, userGetTicket } from "@/lib/tickets.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Ticket as TicketIcon, RefreshCw, MessageCircle, User as UserIcon, Bot } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/my-tickets")({
  component: MyTicketsPage,
  head: () => ({
    meta: [
      { title: "Track my tickets — Aspire AI" },
      { name: "description", content: "Check the status of tickets you logged and read messages from our agents." },
    ],
  }),
});

type TicketRow = {
  id: string;
  title: string | null;
  message: string;
  status: string;
  category: string;
  priority: string;
  resolution_type: string;
  created_at: string;
  updated_at: string;
  assigned_agent_id: string | null;
  assigned_agent_name: string | null;
};

type Msg = { id: string; role: string; message: string; created_at: string };

const STATUS_STYLES: Record<string, string> = {
  open: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  in_progress: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  escalated: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
  resolved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

function MyTicketsPage() {
  const list = useServerFn(userListTicketsByEmail);
  const get = useServerFn(userGetTicket);

  const [email, setEmail] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [accessCodeError, setAccessCodeError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [submittedAccessCode, setSubmittedAccessCode] = useState<string | null>(null);
  const [tickets, setTickets] = useState<TicketRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<{ ticket: TicketRow; messages: Msg[]; agent: string | null } | null>(null);

  const load = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setAccessCodeError(null);
    if (!email.trim()) return;
    if (!accessCode.trim()) {
      setAccessCodeError("Invalid access code. Please contact your administrator.");
      return;
    }
    setBusy(true);
    try {
      const res = await list({ data: { email: email.trim() } });
      setTickets(res.tickets as TicketRow[]);
      setSubmittedEmail(email.trim());
      setActive(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setBusy(false);
    }
  };

  const open = async (t: TicketRow) => {
    if (!submittedEmail) return;
    setBusy(true);
    try {
      const res = await get({ data: { email: submittedEmail, ticketId: t.id } });
      setActive({ ticket: res.ticket as unknown as TicketRow, messages: res.messages as Msg[], agent: res.assignedAgentName });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load ticket");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-secondary">
      <header className="max-w-4xl mx-auto flex items-center justify-between px-6 py-5">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to home
        </Link>
        <Link to="/chat" className="text-sm text-accent hover:underline">New ticket</Link>
      </header>

      <main className="max-w-4xl mx-auto px-6 pb-16">
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 rounded-xl bg-accent/15 items-center justify-center mb-3">
            <TicketIcon className="h-6 w-6 text-accent" />
          </div>
          <h1 className="text-3xl font-bold">Track your tickets</h1>
          <p className="text-sm text-muted-foreground mt-2">Enter the email you used when submitting a ticket.</p>
        </div>

        <Card className="p-6">
          <form onSubmit={load} className="flex flex-col sm:flex-row gap-3 items-end">
            <div className="flex-1 space-y-2 w-full">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <Button type="submit" disabled={busy} className="bg-accent text-accent-foreground hover:bg-accent/90">
              {busy ? "Loading…" : "Look up"}
            </Button>
            {tickets && (
              <Button type="button" variant="outline" onClick={() => load()} disabled={busy} aria-label="Refresh">
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
          </form>
        </Card>

        {tickets && tickets.length === 0 && (
          <p className="text-center text-sm text-muted-foreground mt-8">No tickets found for that email.</p>
        )}

        {tickets && tickets.length > 0 && (
          <div className="grid gap-3 mt-6">
            {tickets.map((t) => (
              <button
                key={t.id}
                onClick={() => open(t)}
                className="text-left rounded-xl border bg-card p-4 hover:border-accent transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm truncate">{t.title || t.message.slice(0, 80)}</div>
                    <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-2">
                      <span className="font-mono">#{t.id.slice(0, 8)}</span>
                      <span>·</span>
                      <span>{t.category}</span>
                      <span>·</span>
                      <span>{new Date(t.created_at).toLocaleString()}</span>
                      {t.assigned_agent_name && <><span>·</span><span>Agent: {t.assigned_agent_name}</span></>}
                    </div>
                  </div>
                  <span className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded-full whitespace-nowrap ${STATUS_STYLES[t.status] ?? "bg-secondary text-foreground"}`}>
                    {t.status.replace("_", " ")}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}

        {active && (
          <Card className="mt-6 overflow-hidden">
            <header className="px-4 py-3 border-b flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate">{active.ticket.title || "Ticket"}</div>
                <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-1.5">
                  <span className="font-mono">#{active.ticket.id.slice(0, 8)}</span>
                  <span>·</span><span>{active.ticket.category}</span>
                  <span>·</span><span>Priority: {active.ticket.priority}</span>
                  {active.agent && <><span>·</span><span>Agent: {active.agent}</span></>}
                </div>
              </div>
              <span className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded-full whitespace-nowrap ${STATUS_STYLES[active.ticket.status] ?? "bg-secondary text-foreground"}`}>
                {active.ticket.status.replace("_", " ")}
              </span>
            </header>
            <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto bg-secondary/30">
              {active.messages.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">No messages yet.</p>
              )}
              {active.messages.map((m) => {
                const isUser = m.role === "user";
                return (
                  <div key={m.id} className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
                    {!isUser && (
                      <div className="h-7 w-7 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
                        <Bot className="h-3.5 w-3.5 text-accent" />
                      </div>
                    )}
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${isUser ? "bg-accent text-accent-foreground" : "bg-card border"}`}>
                      <div className="text-[10px] uppercase tracking-wide opacity-70 mb-0.5">
                        {isUser ? "You" : active.agent ? `Agent / Assistant` : "Assistant"}
                      </div>
                      {m.message}
                      <div className="text-[10px] opacity-60 mt-1">{new Date(m.created_at).toLocaleString()}</div>
                    </div>
                    {isUser && (
                      <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center shrink-0">
                        <UserIcon className="h-3.5 w-3.5" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <footer className="p-3 border-t flex items-center justify-between text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><MessageCircle className="h-3.5 w-3.5" />Replies from agents appear here automatically.</span>
              <Button size="sm" variant="ghost" onClick={() => open(active.ticket)}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refresh
              </Button>
            </footer>
          </Card>
        )}
      </main>
    </div>
  );
}
