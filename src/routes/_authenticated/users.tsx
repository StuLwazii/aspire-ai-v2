import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { adminListUsers, adminSetUserRole, adminPromoteToAgent } from "@/lib/tickets.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ShieldCheck, ShieldOff, UserCog } from "lucide-react";
import { useSupabaseSessionStatus } from "@/hooks/useSupabaseSessionStatus";

type Row = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  isAdmin: boolean;
  isAgent: boolean;
  isSelf: boolean;
};

const DEPTS = ["IT", "HR", "Finance", "Operations"] as const;

export const Route = createFileRoute("/_authenticated/users")({
  component: UsersPage,
  head: () => ({ meta: [{ title: "Users — Helix" }] }),
});

function UsersPage() {
  const list = useServerFn(adminListUsers);
  const setRole = useServerFn(adminSetUserRole);
  const promoteAgent = useServerFn(adminPromoteToAgent);
  const sessionStatus = useSupabaseSessionStatus();
  const { data: users = [], refetch, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => list() as Promise<Row[]>,
    enabled: sessionStatus === "authenticated",
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [agentDeptFor, setAgentDeptFor] = useState<string | null>(null);
  const [dept, setDept] = useState<(typeof DEPTS)[number]>("IT");

  const toggleAdmin = async (u: Row) => {
    setBusyId(u.id);
    try {
      await setRole({ data: { userId: u.id, role: "admin", grant: !u.isAdmin } });
      toast.success(u.isAdmin ? "Admin role revoked" : "Promoted to admin");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  };

  const makeAgent = async (u: Row) => {
    setBusyId(u.id);
    try {
      await promoteAgent({ data: { userId: u.id, department: dept } });
      toast.success(`Promoted to ${dept} agent`);
      setAgentDeptFor(null);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  };

  const revokeAgent = async (u: Row) => {
    setBusyId(u.id);
    try {
      await setRole({ data: { userId: u.id, role: "agent", grant: false } });
      toast.success("Agent role revoked");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-4">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Users & Admins</h1>
        <p className="text-muted-foreground mt-1">
          Promote signed-up users to admin or department agent. Admins manage everything; agents only see their own queue.
        </p>
      </header>

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left p-3 font-semibold">Email</th>
              <th className="text-left p-3 font-semibold">Joined</th>
              <th className="text-left p-3 font-semibold">Roles</th>
              <th className="text-right p-3 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">No users yet</td></tr>
            ) : users.map((u) => (
              <tr key={u.id} className="border-t align-top">
                <td className="p-3 font-medium">
                  {u.email} {u.isSelf && <span className="text-xs text-muted-foreground">(you)</span>}
                </td>
                <td className="p-3 text-muted-foreground text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1">
                    {u.isAdmin && <Badge>Admin</Badge>}
                    {u.isAgent && <Badge variant="outline">Agent</Badge>}
                    {!u.isAdmin && !u.isAgent && <Badge variant="outline">User</Badge>}
                  </div>
                </td>
                <td className="p-3 text-right space-y-2">
                  <div className="flex flex-wrap gap-2 justify-end">
                    <Button
                      size="sm"
                      variant={u.isAdmin ? "outline" : "default"}
                      disabled={busyId === u.id || u.isSelf}
                      onClick={() => toggleAdmin(u)}
                    >
                      {u.isAdmin
                        ? <><ShieldOff className="h-4 w-4 mr-1.5" />Revoke admin</>
                        : <><ShieldCheck className="h-4 w-4 mr-1.5" />Make admin</>}
                    </Button>
                    {u.isAgent ? (
                      <Button size="sm" variant="outline" disabled={busyId === u.id} onClick={() => revokeAgent(u)}>
                        Revoke agent
                      </Button>
                    ) : agentDeptFor === u.id ? (
                      <div className="inline-flex items-center gap-1">
                        <select
                          className="h-8 rounded border border-input bg-transparent px-1.5 text-xs"
                          value={dept}
                          onChange={(e) => setDept(e.target.value as typeof dept)}
                        >
                          {DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
                        </select>
                        <Button size="sm" disabled={busyId === u.id} onClick={() => makeAgent(u)}>Confirm</Button>
                        <Button size="sm" variant="ghost" onClick={() => setAgentDeptFor(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => { setAgentDeptFor(u.id); setDept("IT"); }}>
                        <UserCog className="h-4 w-4 mr-1.5" />Make agent
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
