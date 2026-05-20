import { createFileRoute, redirect, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getMyRole } from "@/lib/tickets.functions";
import { LayoutDashboard, Ticket, LogOut, Users, ShieldCheck, Inbox, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useTheme } from "@/components/theme-provider";
import { useSupabaseSessionStatus } from "@/hooks/useSupabaseSessionStatus";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/admin/login" });
  },
  component: AuthLayout,
});

type RoleState =
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "ok"; isAdmin: boolean; isAgent: boolean };

function useMyRole(): RoleState {
  const [state, setState] = useState<RoleState>({ kind: "loading" });
  const sessionStatus = useSupabaseSessionStatus();
  const getRole = useServerFn(getMyRole);
  const navigate = useNavigate();
  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (sessionStatus === "signed-out") {
      navigate({ to: "/admin/login" });
      return;
    }

    getRole()
      .then((r) => {
        if (!r.isAdmin && !r.isAgent) setState({ kind: "denied" });
        else setState({ kind: "ok", isAdmin: r.isAdmin, isAgent: r.isAgent });
      })
      .catch(async (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes("unauthorized")) {
          await supabase.auth.signOut().catch(() => {});
          navigate({ to: "/admin/login" });
          return;
        }
        setState({ kind: "denied" });
      });
  }, [getRole, navigate, sessionStatus]);
  return state;
}

function AuthLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const roleState = useMyRole();
  const { theme, toggle } = useTheme();

  const logout = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/admin/login" });
  };

  if (roleState.kind === "loading") {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Checking permissions…</div>;
  }
  if (roleState.kind === "denied") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-semibold">Access required</h1>
          <p className="text-sm text-muted-foreground">Your account isn't assigned an admin or agent role yet. Ask an admin to grant access.</p>
          <Button onClick={logout} variant="outline">Sign out</Button>
        </div>
      </div>
    );
  }

  const { isAdmin, isAgent } = roleState;

  // Agent-only users should only see their queue. Redirect them if they land on admin pages.
  if (!isAdmin && isAgent) {
    const allowed = pathname.startsWith("/my-queue");
    if (!allowed) {
      navigate({ to: "/my-queue" });
    }
  }

  const navItem = (to: string, label: string, Icon: typeof Ticket) => {
    const active = pathname === to || (to !== "/dashboard" && pathname.startsWith(to));
    return (
      <Link
        to={to}
        className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
          active
            ? "bg-sidebar-accent text-sidebar-primary font-medium"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
        }`}
      >
        <Icon className="h-4 w-4" />
        {label}
      </Link>
    );
  };

  return (
    <div className="min-h-screen flex w-full bg-background">
      <aside className="hidden md:flex w-60 bg-sidebar text-sidebar-foreground flex-col border-r border-sidebar-border">
        <div className="p-5 border-b border-sidebar-border">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-sidebar-primary flex items-center justify-center">
              <Ticket className="h-5 w-5 text-sidebar-primary-foreground" />
            </div>
            <div>
              <div className="font-bold text-sm">Aspire AI</div>
              <div className="text-[11px] text-sidebar-foreground/60">
                {isAdmin ? "Admin" : "Agent"} portal
              </div>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {isAdmin && navItem("/dashboard", "Dashboard", LayoutDashboard)}
          {isAdmin && navItem("/tickets", "Tickets", Ticket)}
          {isAdmin && navItem("/agents", "Agents", Users)}
          {isAdmin && navItem("/users", "Users & Admins", ShieldCheck)}
          {isAgent && navItem("/my-queue", "My queue", Inbox)}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-1">
          <Button
            variant="ghost"
            className="w-full justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            onClick={toggle}
          >
            {theme === "dark" ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </Button>
          <Button variant="ghost" className="w-full justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground" onClick={logout}>
            <LogOut className="h-4 w-4 mr-2" /> Sign out
          </Button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <div className="md:hidden flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-primary flex items-center justify-center">
              <Ticket className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold">Aspire AI</span>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={toggle}>
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={logout}><LogOut className="h-4 w-4" /></Button>
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
