import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type SupabaseSessionStatus = "loading" | "authenticated" | "signed-out";

export function useSupabaseSessionStatus(): SupabaseSessionStatus {
  const { status } = useSupabaseSession();
  return status;
}

export function useSupabaseSession() {
  const [state, setState] = useState<{
    status: SupabaseSessionStatus;
    accessToken: string | null;
  }>({ status: "loading", accessToken: null });

  useEffect(() => {
    let alive = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      const token = data.session?.access_token ?? null;
      setState({ status: token ? "authenticated" : "signed-out", accessToken: token });
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      const token = session?.access_token ?? null;
      setState({ status: token ? "authenticated" : "signed-out", accessToken: token });
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  return state;
}
