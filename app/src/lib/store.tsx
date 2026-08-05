import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";
import { batches as seedBatches, ledger as seedLedger, products as seedProducts } from "./mockData";
import type { Batch, LedgerEntry, Product } from "./types";

/**
 * A small in-memory store, not a backend. It exists so an action taken on
 * one screen (add a milking batch, post pickups to the books) is visible
 * on another (Today's stats, the ledger totals) within a session — the
 * "one entry, four places" pitch the dashboard makes. Nothing here
 * persists past a page reload; there's no server. See IMPLEMENTATION_PLAN.md.
 */

interface AppState {
  products: Product[];
  batches: Batch[];
  ledger: LedgerEntry[];
  arriving: { amount: number; count: number };
  awaitingCategory: number;
  splitRule: "evenly" | "production";
  /** July's income/expenses outside the 8 sample ledger rows above — see
   * BooksTransactions' original fix: the mockup's stat-row totals are the
   * authoritative month figures, the ledger is only a drawn sample. New
   * entries on top of the sample should still move the real totals. */
  monthBaseline: { income: number; expenses: number };
}

const initialState: AppState = {
  products: seedProducts.map((p) => ({ ...p })),
  batches: seedBatches.map((b) => ({ ...b })),
  ledger: seedLedger.map((l) => ({ ...l })),
  arriving: { amount: 164.5, count: 4 },
  awaitingCategory: 4,
  splitRule: "evenly",
  monthBaseline: { income: 5438.5, expenses: 2293.6 },
};

type Action =
  | { type: "ADD_BATCH"; dateLabel: string; quantity: number }
  | { type: "POST_ARRIVING_AS_MILK_SALES" }
  | { type: "ADD_LEDGER_ENTRY"; entry: LedgerEntry }
  | { type: "SET_SPLIT_RULE"; rule: "evenly" | "production" };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "ADD_BATCH": {
      const batch: Batch = {
        produced: action.dateLabel,
        source: "pooled · 9 animals",
        quantity: action.quantity,
        reserved: 0,
        available: action.quantity,
      };
      const round3 = (n: number) => Math.round(n * 1000) / 1000;
      const products = state.products.map((p) =>
        p.id === "raw-milk" && typeof p.onHand === "number" && typeof p.openToShop === "number"
          ? { ...p, onHand: round3(p.onHand + action.quantity), openToShop: round3(p.openToShop + action.quantity) }
          : p,
      );
      return { ...state, batches: [batch, ...state.batches], products };
    }
    case "POST_ARRIVING_AS_MILK_SALES": {
      if (state.arriving.count === 0) return state;
      const entry: LedgerEntry = {
        date: "4 Aug",
        description: `${state.arriving.count} pickups · posted from the store`,
        category: "Milk sales",
        attribution: { label: "Dairy herd" },
        account: "Venmo",
        amount: state.arriving.amount,
        highlight: true,
      };
      return {
        ...state,
        ledger: [entry, ...state.ledger],
        arriving: { amount: 0, count: 0 },
        awaitingCategory: Math.max(0, state.awaitingCategory - 4),
      };
    }
    case "ADD_LEDGER_ENTRY":
      return { ...state, ledger: [action.entry, ...state.ledger] };
    case "SET_SPLIT_RULE":
      return { ...state, splitRule: action.rule };
    default:
      return state;
  }
}

const StateContext = createContext<AppState | null>(null);
const DispatchContext = createContext<React.Dispatch<Action> | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(StateContext);
  if (!ctx) throw new Error("useAppState must be used inside AppStateProvider");
  return ctx;
}

function useAppDispatch() {
  const ctx = useContext(DispatchContext);
  if (!ctx) throw new Error("useAppDispatch must be used inside AppStateProvider");
  return ctx;
}

/** Today's date label the way the mock data spells it — matches the
 * "4 Aug" already seeded on batches/ledger so a fresh batch of milk shows
 * up as "today's" without needing a real clock/timezone story. */
export const TODAY_LABEL = "4 Aug";

export function useAppActions() {
  const dispatch = useAppDispatch();
  return useMemo(
    () => ({
      addBatch: (dateLabel: string, quantity: number) => dispatch({ type: "ADD_BATCH", dateLabel, quantity }),
      postArrivingAsMilkSales: () => dispatch({ type: "POST_ARRIVING_AS_MILK_SALES" }),
      addLedgerEntry: (entry: LedgerEntry) => dispatch({ type: "ADD_LEDGER_ENTRY", entry }),
      setSplitRule: (rule: "evenly" | "production") => dispatch({ type: "SET_SPLIT_RULE", rule }),
    }),
    [dispatch],
  );
}

export function monthTotals(state: AppState) {
  const ledgerIncome = state.ledger.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0);
  const ledgerExpenses = state.ledger.filter((l) => l.amount < 0).reduce((s, l) => s - l.amount, 0);
  const income = state.monthBaseline.income + ledgerIncome;
  const expenses = state.monthBaseline.expenses + ledgerExpenses;
  return { income, expenses, net: income - expenses };
}
