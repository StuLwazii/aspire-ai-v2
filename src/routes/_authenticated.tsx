import { createFileRoute, redirect, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getMyRole } from "@/lib/tickets.functions";
import { LayoutDashboard, Ticket, LogOut, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/admin/login" });
  },
  component: AuthLayout,
});

function useIsAdmin() {
  const [state, setState] = useState<"loading" | "ok" | "denied">("loading");
  useEffect(() => {
    getMyRole().then((r) => setState(r.isAdmin ? "ok" : "denied")).catch(() => setState("denied"));
  }, []);
  return state;
}

function AuthLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const adminState = useIsAdmin();

  const logout = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out");
    navigate({ to: "/admin/login" });
  };

  if (adminState === "loading") {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Checking permissions…</div>;
  }
  if (adminState === "denied") {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-semibold">Admin access required</h1>
          <p className="text-sm text-muted-foreground">Your account isn't assigned the admin role. Ask an admin to grant access.</p>
          <Button onClick={logout} variant="outline">Sign out</Button>
        </div>
      </div>
    );
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
              <div className="font-bold text-sm">Helix</div>
              <div className="text-[11px] text-sidebar-foreground/60">Help Desk</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItem("/dashboard", "Dashboard", LayoutDashboard)}
          {navItem("/tickets", "Tickets", Ticket)}
          {navItem("/agents", "Agents", Users)}
        </nav>
        <div className="p-3 border-t border-sidebar-border">
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
            <span className="font-bold">Helix</span>
          </div>
          <Button size="sm" variant="ghost" onClick={logout}><LogOut className="h-4 w-4" /></Button>
        </div>
        <Outlet />
      </main>
    </div>
  );
}