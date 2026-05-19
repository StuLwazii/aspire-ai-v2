import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { createTicket } from "@/lib/tickets.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

const TONES = [
  { id: "formal", label: "Formal" },
  { id: "friendly", label: "Friendly" },
  { id: "urgent", label: "Urgent" },
] as const;

export function TicketForm({ onCreated }: { onCreated: () => void }) {
  const submit = useServerFn(createTicket);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<(typeof TONES)[number]["id"]>("formal");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim().length < 5) {
      toast.error("Please describe the issue (5+ characters).");
      return;
    }
    setBusy(true);
    try {
      await submit({ data: { message: message.trim(), tone } });
      toast.success("Ticket classified and response drafted.");
      setMessage("");
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create ticket");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="h-4 w-4 text-accent" />
        <h2 className="font-semibold">New ticket</h2>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="msg">Describe the issue</Label>
          <Textarea
            id="msg"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. My laptop won't connect to the VPN since this morning…"
            rows={5}
            maxLength={2000}
          />
        </div>
        <div className="space-y-2">
          <Label>Response tone</Label>
          <div className="grid grid-cols-3 gap-2">
            {TONES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTone(t.id)}
                className={`px-3 py-2 rounded-md text-sm border transition-colors ${
                  tone === t.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background hover:bg-secondary border-border"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <Button type="submit" disabled={busy} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
          {busy ? "Classifying with AI…" : "Submit ticket"}
        </Button>
      </form>
    </Card>
  );
}