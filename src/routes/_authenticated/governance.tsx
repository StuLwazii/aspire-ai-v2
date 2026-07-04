import { createFileRoute } from "@tanstack/react-router";
import { GovernanceDashboard } from "@/components/admin/GovernanceDashboard";

export const Route = createFileRoute("/_authenticated/governance")({
  component: GovernancePage,
  head: () => ({ meta: [{ title: "AI Governance & Compliance — Aspire AI" }] }),
});

function GovernancePage() {
  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">AI Governance &amp; Compliance</h1>
        <p className="text-muted-foreground mt-1">
          Centralized audit of every AI and admin response. The chat experience is unaffected — all findings live here.
        </p>
      </header>
      <GovernanceDashboard />
    </div>
  );
}
