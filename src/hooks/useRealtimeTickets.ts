import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useRealtimeTickets(onChange: () => void) {
  useEffect(() => {
    const ch = supabase
      .channel("tickets-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets" }, onChange)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, onChange)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [onChange]);
}
