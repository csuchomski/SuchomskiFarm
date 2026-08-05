import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "./supabase";

/**
 * The current workspace: which business you're working in, what modules it
 * has, and (for a farm) which herd farm_id its records hang off.
 *
 * Works either side of migrations 004-007. Before they run there's no
 * business_members or business_type_modules, so membership falls back to
 * herd.farm_members and modules to a built-in map. `migrated` says which
 * mode it's in rather than leaving that invisible.
 */

export interface Business {
  id: number;
  name: string;
  type: string;
}

export interface WorkspaceState {
  loading: boolean;
  error: string | null;
  businesses: Business[];
  business: Business | null;
  /** Module codes for the current business, e.g. ["books","herd","store"]. */
  modules: string[];
  /** herd.farms.id for the current business, when it has one. */
  farmId: string | null;
  role: string | null;
  userId: string | null;
  migrated: boolean;
  setBusinessId: (id: number) => void;
}

/** Used until business_type_modules exists. Mirrors what migration 004 seeds. */
const FALLBACK_MODULES: Record<string, string[]> = {
  farm: ["books", "herd", "store"],
  rental: ["books", "properties", "leases"],
  other: ["books"],
};

const STORAGE_KEY = "suchomski.businessId";

const WorkspaceContext = createContext<WorkspaceState | null>(null);

const missingRelation = (message: string) => /does not exist|schema cache|not find the table|relation/i.test(message);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<WorkspaceState, "setBusinessId">>({
    loading: true,
    error: null,
    businesses: [],
    business: null,
    modules: [],
    farmId: null,
    role: null,
    userId: null,
    migrated: false,
  });
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? Number(stored) : null;
  });

  const setBusinessId = useCallback((id: number) => {
    localStorage.setItem(STORAGE_KEY, String(id));
    setSelectedId(id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const user = userData.user;
        if (!user) {
          if (!cancelled) setState((s) => ({ ...s, loading: false }));
          return;
        }

        const membership = await loadMembership(user.id);
        if (cancelled) return;

        const businesses = membership.businesses;
        const chosen =
          businesses.find((b) => b.id === selectedId) ??
          businesses.find((b) => b.type === "farm") ??
          businesses[0] ??
          null;

        const [modules, farmId] = await Promise.all([
          chosen ? loadModules(chosen) : Promise.resolve([]),
          chosen ? loadFarmId(chosen) : Promise.resolve(null),
        ]);

        if (cancelled) return;
        setState({
          loading: false,
          error: null,
          businesses,
          business: chosen,
          modules,
          farmId,
          role: membership.roleFor(chosen?.id ?? -1),
          userId: user.id,
          migrated: membership.migrated,
        });
      } catch (err) {
        if (!cancelled) {
          setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : String(err) }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const value = useMemo<WorkspaceState>(() => ({ ...state, setBusinessId }), [state, setBusinessId]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}

export function useHasModule(code: string) {
  const { modules } = useWorkspace();
  return modules.includes(code);
}

// ─── loading ───────────────────────────────────────────────────────────

interface Membership {
  businesses: Business[];
  roleFor: (businessId: number) => string | null;
  migrated: boolean;
}

async function loadMembership(userId: string): Promise<Membership> {
  const viaBusiness = await supabase
    .from("business_members")
    .select("role, business_id, businesses(id, name, type)")
    .eq("user_id", userId);

  if (!viaBusiness.error) {
    // An embedded relation comes back as an object for a to-one FK but is
    // typed as an array; accept either rather than depending on which.
    type Row = { role: string; business_id: number; businesses: Business | Business[] | null };
    const rows = (viaBusiness.data ?? []) as unknown as Row[];
    const roles = new Map(rows.map((r) => [r.business_id, r.role]));
    const businesses = rows
      .flatMap((r) => (Array.isArray(r.businesses) ? r.businesses : r.businesses ? [r.businesses] : []))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { businesses, roleFor: (id) => roles.get(id) ?? null, migrated: true };
  }
  if (!missingRelation(viaBusiness.error.message)) throw new Error(`business_members: ${viaBusiness.error.message}`);

  // Pre-migration: membership lives on the farm, so the only business
  // reachable is the one that farm belongs to.
  const viaFarm = await supabase.schema("herd").from("farm_members").select("role, farm_id").eq("user_id", userId);
  if (viaFarm.error) throw new Error(`herd.farm_members: ${viaFarm.error.message}`);

  const farmRows = (viaFarm.data ?? []) as { role: string; farm_id: string }[];
  if (farmRows.length === 0) return { businesses: [], roleFor: () => null, migrated: false };

  const businesses = await supabase.from("businesses").select("id, name, type").eq("type", "farm").order("name");
  if (businesses.error) throw new Error(`businesses: ${businesses.error.message}`);

  const role = farmRows[0].role;
  return {
    businesses: (businesses.data ?? []) as Business[],
    roleFor: () => role,
    migrated: false,
  };
}

async function loadModules(business: Business): Promise<string[]> {
  const res = await supabase.from("business_type_modules").select("module_code").eq("type_code", business.type);
  if (!res.error) {
    const codes = (res.data ?? []).map((r) => (r as { module_code: string }).module_code);
    if (codes.length > 0) return codes;
  } else if (!missingRelation(res.error.message)) {
    throw new Error(`business_type_modules: ${res.error.message}`);
  }
  return FALLBACK_MODULES[business.type] ?? ["books"];
}

async function loadFarmId(business: Business): Promise<string | null> {
  // Post-migration: the farm points at its business.
  const linked = await supabase.schema("herd").from("farms").select("id").eq("business_id", business.id).maybeSingle();
  if (!linked.error) return (linked.data as { id: string } | null)?.id ?? null;
  if (!/business_id|column|schema cache/i.test(linked.error.message)) {
    throw new Error(`herd.farms: ${linked.error.message}`);
  }

  // Pre-migration: no link exists, so fall back to the single farm.
  if (business.type !== "farm") return null;
  const any = await supabase.schema("herd").from("farms").select("id").limit(1).maybeSingle();
  if (any.error) throw new Error(`herd.farms: ${any.error.message}`);
  return (any.data as { id: string } | null)?.id ?? null;
}
