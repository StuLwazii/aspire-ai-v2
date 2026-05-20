import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { adminListAgents, adminCreateAgent, adminUpdateAgent, adminDeleteAgent } from "@/lib/tickets.functions";
import type { Agent } from "@/components/admin/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Trash2, Plus } from "lucide-react";
import { useSupabaseSessionStatus } from "@/hooks/useSupabaseSessionStatus";

const DEPTS = ["IT", "HR", "Finance", "Operations"] as const;
const STATUSES = ["available", "busy", "offline"] as const;

export const Route = createFileRoute("/_authenticated/agents")({
  component: AgentsPage,
  head: () => ({ meta: [{ title: "Agents — Aspire AI" }] }),
});

function AgentsPage() {
  const list = useServerFn(adminListAgents);
  const create = useServerFn(adminCreateAgent);
  const update = useServerFn(adminUpdateAgent);
  const del = useServerFn(adminDeleteAgent);
  const sessionStatus = useSupabaseSessionStatus();

  const { data: agents = [], refetch, isLoading } = useQuery({
    queryKey: ["agents"], queryFn: () => list() as Promise<Agent[]>,
    enabled: sessionStatus === "authenticated",
  });

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState<(typeof DEPTS)[number]>("IT");
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await create({ data: { full_name: name, email, department, status: "available" } });
      toast.success("Agent added");
      setName(""); setEmail(""); refetch();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Failed"); }
    finally { setBusy(false); }
  };

  const setStatus = async (id: string, status: (typeof STATUSES)[number]) => {
    try { await update({ data: { id, status } }); refetch(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this agent?")) return;
    try { await del({ data: { id } }); toast.success("Agent removed"); refetch(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-4">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Agents</h1>
        <p className="text-muted-foreground mt-1">Manage human agents per department. Escalated tickets auto-assign to the least loaded available agent.</p>
      </header>

      <Card className="p-4">
        <form onSubmit={add} className="grid md:grid-cols-[1fr_1fr_auto_auto] gap-3 items-end">
          <div className="space-y-1.5">
            <Label>Full name</Label>
            <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@helpdesk.com" />
          </div>
          <div className="space-y-1.5">
            <Label>Department</Label>
            <select className="h-9 rounded-md border border-input bg-transparent px-2 text-sm" value={department} onChange={(e) => setDepartment(e.target.value as typeof department)}>
              {DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <Button type="submit" disabled={busy}><Plus className="h-4 w-4 mr-1.5" />Add agent</Button>
        </form>
      </Card>

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left p-3 font-semibold">Name</th>
              <th className="text-left p-3 font-semibold">Email</th>
              <th className="text-left p-3 font-semibold">Department</th>
              <th className="text-left p-3 font-semibold">Status</th>
              <th className="text-left p-3 font-semibold">Open</th>
              <th className="text-right p-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : agents.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No agents yet</td></tr>
            ) : agents.map((a) => (
              <tr key={a.id} className="border-t">
                <td className="p-3 font-medium">{a.full_name}</td>
                <td className="p-3 text-muted-foreground">{a.email}</td>
                <td className="p-3">{a.department}</td>
                <td className="p-3">
                  <select className="h-8 rounded border border-input bg-transparent px-1.5 text-xs"
                    value={a.status} onChange={(e) => setStatus(a.id, e.target.value as typeof STATUSES[number])}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="p-3">{a.current_ticket_count}</td>
                <td className="p-3 text-right">
                  <Button size="sm" variant="ghost" onClick={() => remove(a.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
