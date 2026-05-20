import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { adminListUsers, adminSetUserRole } from "@/lib/tickets.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ShieldCheck, ShieldOff } from "lucide-react";

type Row = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  isAdmin: boolean;
  isSelf: boolean;
};

export const Route = createFileRoute("/_authenticated/users")({
  component: UsersPage,
  head: () => ({ meta: [{ title: "Users — Helix" }] }),
});

function UsersPage() {
  const list = useServerFn(adminListUsers);
  const setRole = useServerFn(adminSetUserRole);
  const { data: users = [], refetch, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => list() as Promise<Row[]>,
  });
  const [busyId, setBusyId] = useState<string | null>(null);

  const toggle = async (u: Row) => {
    setBusyId(u.id);
    try {
      await setRole({ data: { userId: u.id, makeAdmin: !u.isAdmin } });
      toast.success(u.isAdmin ? "Admin role revoked" : "Promoted to admin");
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
          Approve other signed-up users to be administrators. Admins can manage tickets, agents, and grant admin to others.
        </p>
      </header>

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left p-3 font-semibold">Email</th>
              <th className="text-left p-3 font-semibold">Joined</th>
              <th className="text-left p-3 font-semibold">Last sign-in</th>
              <th className="text-left p-3 font-semibold">Role</th>
              <th className="text-right p-3 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No users yet</td></tr>
            ) : users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="p-3 font-medium">
                  {u.email} {u.isSelf && <span className="text-xs text-muted-foreground">(you)</span>}
                </td>
                <td className="p-3 text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</td>
                <td className="p-3 text-muted-foreground">
                  {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : "—"}
                </td>
                <td className="p-3">
                  {u.isAdmin
                    ? <Badge>Admin</Badge>
                    : <Badge variant="outline">User</Badge>}
                </td>
                <td className="p-3 text-right">
                  <Button
                    size="sm"
                    variant={u.isAdmin ? "outline" : "default"}
                    disabled={busyId === u.id || u.isSelf}
                    onClick={() => toggle(u)}
                  >
                    {u.isAdmin
                      ? <><ShieldOff className="h-4 w-4 mr-1.5" />Revoke admin</>
                      : <><ShieldCheck className="h-4 w-4 mr-1.5" />Make admin</>}
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