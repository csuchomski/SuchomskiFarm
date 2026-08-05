import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "./supabase";

/**
 * The current user's farm membership, resolved once after sign-in.
 * Writes into the `herd` schema need farm_id (every table carries it for
 * multi-tenancy, and the RLS write policies check it), so screens need
 * this rather than hardcoding the UUID.
 */
interface FarmState {
  farmId: string | null;
  userId: string | null;
  role: string | null;
  loading: boolean;
}

const FarmContext = createContext<FarmState>({ farmId: null, userId: null, role: null, loading: true });

export function FarmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FarmState>({ farmId: null, userId: null, role: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData.user;
      if (!user) {
        if (!cancelled) setState({ farmId: null, userId: null, role: null, loading: false });
        return;
      }
      const { data } = await supabase
        .schema("herd")
        .from("farm_members")
        .select("farm_id, role")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled) {
        setState({
          farmId: data?.farm_id ?? null,
          userId: user.id,
          role: data?.role ?? null,
          loading: false,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <FarmContext.Provider value={state}>{children}</FarmContext.Provider>;
}

export function useFarm() {
  return useContext(FarmContext);
}
