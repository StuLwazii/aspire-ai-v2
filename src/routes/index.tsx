import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Bot, ShieldCheck, Sparkles, Ticket as TicketIcon, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/")({
  component: LandingPage,
  head: () => ({
    meta: [
      { title: "Helix Help Desk — Log a ticket" },
      { name: "description", content: "Get instant AI answers to IT, HR, Finance and Operations tickets, or escalate to a human." },
    ],
  }),
});

function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-secondary">
      <header className="max-w-6xl mx-auto flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
            <TicketIcon className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <div className="font-bold">Helix</div>
            <div className="text-[11px] text-muted-foreground -mt-0.5">AI Help Desk</div>
          </div>
        </div>
        <Link to="/admin/login" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4" /> Admin login
        </Link>
      </header>

      <main className="max-w-4xl mx-auto px-6 pt-10 pb-16 text-center">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-accent/10 text-accent px-3 py-1 rounded-full mb-6">
          <Sparkles className="h-3 w-3" /> Powered by AI triage
        </span>
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
          Get help in seconds, not days.
        </h1>
        <p className="text-base md:text-lg text-muted-foreground mt-5 max-w-2xl mx-auto">
          Describe your IT, HR, Finance, or Operations issue. Our assistant solves what it can on the spot, and routes the rest to the right human agent — automatically.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90">
            <Link to="/chat">
              Log a ticket <ArrowRight className="h-4 w-4 ml-1.5" />
            </Link>
          </Button>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 mt-16 text-left">
          {[
            { icon: Bot, title: "Instant AI answers", body: "Password resets, how-tos and common fixes resolved automatically." },
            { icon: TicketIcon, title: "Always tracked", body: "Every conversation is logged and classified by department." },
            { icon: ShieldCheck, title: "Human when needed", body: "Complex issues escalate to the right team with full context." },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border bg-card p-5">
              <div className="h-9 w-9 rounded-lg bg-secondary flex items-center justify-center mb-3">
                <f.icon className="h-4 w-4" />
              </div>
              <div className="font-semibold text-sm">{f.title}</div>
              <p className="text-sm text-muted-foreground mt-1">{f.body}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
