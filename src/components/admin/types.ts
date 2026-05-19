import type { Database } from "@/integrations/supabase/types";
type Ticket = Database["public"]["Tables"]["tickets"]["Row"];
export type AdminTicket = Ticket & {
  app_users: { name: string; email: string; department: string } | null;
};
