import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { startConversation, continueConversation, rateTicket, markUserResolution } from "@/lib/tickets.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ChatBubble, TypingIndicator } from "./ChatBubble";
import { DEPARTMENT_OPTIONS } from "@/lib/constants";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { Send, ThumbsUp, ThumbsDown, Ticket as TicketIcon, MessageCircle, Bot, User as UserIcon, CheckCircle2, XCircle, ArrowLeft } from "lucide-react";

type Ticket = Database["public"]["Tables"]["tickets"]["Row"] & {
  resolution_type?: "self_service" | "escalated" | "pending";
};
type Msg = Database["public"]["Tables"]["conversations"]["Row"];

export function ChatPortal() {
  const start = useServerFn(startConversation);
  const cont = useServerFn(continueConversation);
  const rate = useServerFn(rateTicket);
  const mark = useServerFn(markUserResolution);

  const [stage, setStage] = useState<"form" | "chat">("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState<(typeof DEPARTMENT_OPTIONS)[number]>("Engineering");
  const [first, setFirst] = useState("");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [resolutionChoice, setResolutionChoice] = useState<"resolved" | "escalated" | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const onStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (first.trim().length < 5) {
      toast.error("Please describe your issue (5+ characters).");
      return;
    }
    setBusy(true);
    try {
      const res = await start({ data: { name, email, department, message: first.trim() } });
      const t = res.ticket as Ticket;
      setTicket(t);
      setMessages(res.messages as Msg[]);
      setRating(t.rating);
      if (t.resolution_type === "escalated") setResolutionChoice("escalated");
      setStage("chat");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setBusy(false);
    }
  };

  const onSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticket || input.trim().length === 0) return;
    const text = input.trim();
    setInput("");
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, ticket_id: ticket.id, role: "user", message: text, created_at: new Date().toISOString() }]);
    setBusy(true);
    try {
      const res = await cont({ data: { ticketId: ticket.id, message: text } });
      setMessages((prev) => {
        const withoutTmp = prev.filter((m) => !m.id.startsWith("tmp-"));
        return [...withoutTmp, ...(res.messages as Msg[])];
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send");
      setMessages((prev) => prev.filter((m) => !m.id.startsWith("tmp-")));
    } finally {
      setBusy(false);
    }
  };

  const handleRate = async (r: "up" | "down") => {
    if (!ticket) return;
    setRating(r);
    try {
      await rate({ data: { ticketId: ticket.id, rating: r } });
      toast.success("Thanks for the feedback!");
    } catch {
      setRating(null);
      toast.error("Couldn't save rating");
    }
  };

  const handleResolution = async (resolved: boolean) => {
    if (!ticket) return;
    setBusy(true);
    try {
      const res = await mark({ data: { ticketId: ticket.id, resolved } });
      setResolutionChoice(resolved ? "resolved" : "escalated");
      if (resolved) {
        setMessages((prev) => [...prev, {
          id: `ack-${Date.now()}`, ticket_id: ticket.id, role: "assistant",
          message: "Glad we could help! Marking this ticket as resolved. 🎉",
          created_at: new Date().toISOString(),
        }]);
        setTicket({ ...ticket, status: "resolved" });
        toast.success("Marked as resolved");
      } else {
        const agentLine = res.assignedAgentName
          ? `Got it — escalating to our team. Your ticket has been assigned to **${res.assignedAgentName}** and they will contact you shortly. Expected response: ${res.expectedResponse}.`
          : `Got it — escalating to our team. They are at capacity; you are in the queue. Expected response: ${res.expectedResponse}.`;
        setMessages((prev) => [...prev, {
          id: `esc-${Date.now()}`, ticket_id: ticket.id, role: "assistant",
          message: agentLine, created_at: new Date().toISOString(),
        }]);
        setTicket({ ...ticket, status: "escalated", resolution_type: "escalated" });
        toast.success("Escalated to a human agent");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  if (stage === "form") {
    return (
      <Card className="w-full max-w-md p-8">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to home
        </Link>
        <div className="flex items-center gap-2 mb-2">
          <div className="h-9 w-9 rounded-lg bg-accent flex items-center justify-center">
            <MessageCircle className="h-5 w-5 text-accent-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Helix Help Desk</h1>
            <p className="text-xs text-muted-foreground">AI-powered support</p>
          </div>
        </div>
        <h2 className="text-2xl font-semibold mt-4 mb-1">How can we help?</h2>
        <p className="text-sm text-muted-foreground mb-6">Tell us about yourself and describe your issue — we'll respond in seconds.</p>
        <form onSubmit={onStart} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required maxLength={255} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dept">Your department</Label>
            <select
              id="dept"
              value={department}
              onChange={(e) => setDepartment(e.target.value as typeof department)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              {DEPARTMENT_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="msg">Describe your issue</Label>
            <Textarea id="msg" required minLength={5} maxLength={2000} rows={4} value={first} onChange={(e) => setFirst(e.target.value)} placeholder="e.g. I can't access the VPN since this morning…" />
          </div>
          <Button type="submit" disabled={busy} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
            {busy ? "Submitting…" : "Start chat"}
          </Button>
        </form>
      </Card>
    );
  }

  const resolutionBadge = ticket?.resolution_type === "self_service" && resolutionChoice !== "escalated"
    ? { icon: Bot, label: "Resolved by Assistant", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" }
    : ticket?.resolution_type === "escalated" || resolutionChoice === "escalated"
    ? { icon: UserIcon, label: "Escalated to Human Agent", cls: "bg-destructive/15 text-destructive" }
    : null;

  // Show Yes/No on the LAST assistant message if self-service & not yet answered
  const isSelfServicePending = ticket?.resolution_type === "self_service" && resolutionChoice === null;

  return (
    <Card className="w-full max-w-2xl h-[calc(100vh-2rem)] sm:h-[80vh] flex flex-col overflow-hidden">
      <header className="px-4 py-3 border-b flex items-center gap-3">
        <Link to="/" aria-label="Back to home" className="h-9 w-9 rounded-lg bg-accent flex items-center justify-center hover:opacity-80">
          <ArrowLeft className="h-4 w-4 text-accent-foreground" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">Helix Assistant</div>
          {ticket && (
            <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
              <TicketIcon className="h-3 w-3" />
              <span className="font-mono">#{ticket.id.slice(0, 8)}</span>
              <span>·</span>
              <span>{new Date(ticket.created_at).toLocaleString()}</span>
            </div>
          )}
        </div>
        {resolutionBadge && (
          <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold px-2 py-1 rounded-full ${resolutionBadge.cls}`}>
            <resolutionBadge.icon className="h-3 w-3" />
            {resolutionBadge.label}
          </span>
        )}
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto p-4 space-y-4 bg-secondary/30">
        {messages.map((m, i) => {
          const isLastAssistant = m.role === "assistant" && i === messages.length - 1 && !busy;
          return (
            <ChatBubble
              key={m.id}
              role={m.role as "user" | "assistant"}
              message={m.message}
              timestamp={m.created_at}
              category={m.role === "assistant" && i === 1 && ticket ? ticket.category : undefined}
              footer={isLastAssistant ? (
                <div className="flex items-center gap-1">
                  <button onClick={() => handleRate("up")} className={`p-1 rounded hover:bg-secondary ${rating === "up" ? "text-accent" : ""}`} aria-label="Helpful">
                    <ThumbsUp className="h-3 w-3" />
                  </button>
                  <button onClick={() => handleRate("down")} className={`p-1 rounded hover:bg-secondary ${rating === "down" ? "text-destructive" : ""}`} aria-label="Not helpful">
                    <ThumbsDown className="h-3 w-3" />
                  </button>
                </div>
              ) : undefined}
            />
          );
        })}
        {busy && <TypingIndicator />}

        {isSelfServicePending && !busy && (
          <div className="flex justify-start">
            <div className="flex flex-col gap-2 ml-1">
              <span className="text-xs text-muted-foreground">Did this resolve your issue?</span>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleResolution(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  <CheckCircle2 className="h-4 w-4 mr-1.5" />Yes, resolved
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleResolution(false)}>
                  <XCircle className="h-4 w-4 mr-1.5" />No, I still need help
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={onSend} className="p-3 border-t flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a follow-up…"
          disabled={busy}
          maxLength={2000}
        />
        <Button type="submit" disabled={busy || !input.trim()} className="bg-accent text-accent-foreground hover:bg-accent/90">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </Card>
  );
}
