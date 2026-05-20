import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type SupabaseSessionStatus = "loading" | "authenticated" | "signed-out";

export function useSupabaseSessionStatus(): SupabaseSessionStatus {
  const [status, setStatus] = useState<SupabaseSessionStatus>("loading");

  useEffect(() => {
    let alive = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setStatus(data.session?.access_token ? "authenticated" : "signed-out");
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      setStatus(session?.access_token ? "authenticated" : "signed-out");
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  return status;
}