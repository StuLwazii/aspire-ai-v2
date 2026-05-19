import type { Database } from "@/integrations/supabase/types";
type Ticket = Database["public"]["Tables"]["tickets"]["Row"];
export type AdminTicket = Ticket & {
  resolution_type?: "self_service" | "escalated" | "pending";
  escalation_reason?: string | null;
  assigned_agent_id?: string | null;
  priority?: "low" | "medium" | "high" | "critical";
  app_users: { name: string; email: string; department: string } | null;
  agents?: { id: string; full_name: string; department: string; status: string } | null;
};

export type Agent = {
  id: string;
  full_name: string;
  email: string;
  department: "IT" | "HR" | "Finance" | "Operations";
  status: "available" | "busy" | "offline";
  current_ticket_count: number;
  created_at: string;
};
