export interface NavItem {
  label: string;
  /** Omitted for sections that aren't built — rendered as inert text. */
  to?: string;
}

export interface NavGroup {
  /** The module this group belongs to; the rail only shows groups whose
   * module the current business has. See docs/business-as-tenant.md. */
  module: string;
  heading: string;
  items: NavItem[];
}

export const topLevel: NavItem = { label: "Today", to: "/" };

/** Every group the app knows how to render, across all business types. What
 * a given business actually sees is the intersection of this and its
 * modules — a rental business has no Herd, a farm has no Properties. */
export const allGroups: NavGroup[] = [
  {
    module: "herd",
    heading: "Herd",
    items: [
      // First in the group on purpose: it is the only page that says what
      // needs doing rather than what happened.
      { label: "Alerts", to: "/alerts" },
      { label: "Animals", to: "/animals" },
      { label: "Lactations", to: "/lactations" },
      { label: "Milkings", to: "/milkings" },
      { label: "Genetics", to: "/genetics" },
      { label: "Sires", to: "/sires" },
      { label: "Breedings", to: "/breedings" },
      { label: "Calvings", to: "/calvings" },
      { label: "Breeds", to: "/breeds" },
      // First thing you want in a pasture, so it sits above the reference
      // pages rather than at the bottom of the group.
      { label: "Grazing", to: "/grazing" },
      { label: "Rotation", to: "/grazing/rotation" },
      { label: "Pasture map", to: "/grazing/map" },
      { label: "Forage balance", to: "/grazing/balance" },
      { label: "Monitoring", to: "/grazing/monitoring" },
      { label: "Depreciation", to: "/depreciation" },
      { label: "Health" },
    ],
  },
  {
    module: "store",
    heading: "Store",
    items: [
      { label: "Products", to: "/store/products" },
      { label: "Orders", to: "/store/orders" },
      { label: "Schedules", to: "/store/schedules" },
      { label: "Forecast", to: "/store/forecast" },
      { label: "Customers", to: "/store/customers" },
    ],
  },
  {
    module: "properties",
    heading: "Properties",
    items: [{ label: "Units" }, { label: "Maintenance" }],
  },
  {
    module: "leases",
    heading: "Leases",
    items: [{ label: "Tenants" }, { label: "Renewals" }],
  },
  {
    module: "books",
    heading: "Books",
    items: [
      { label: "Transactions", to: "/books/transactions" },
      { label: "Accounts", to: "/books/accounts" },
      { label: "Balance sheet", to: "/books/balance-sheet" },
      { label: "Reports", to: "/books/reports" },
      { label: "Taxes", to: "/books/taxes" },
    ],
  },
];

export function groupsForModules(modules: string[]): NavGroup[] {
  return allGroups.filter((g) => modules.includes(g.module));
}

/**
 * The module a path belongs to, or null when the path isn't module-gated —
 * the home route, which every business has whatever its type.
 *
 * Derived from `allGroups` rather than a second hand-maintained table, so a
 * nav item added above is gated automatically. The two can't drift apart,
 * because there's only one of them.
 *
 * Matching is by longest prefix so a record page (/animals/1103) gates the
 * same as its index (/animals) without needing its own entry.
 */
export function moduleForPath(path: string): string | null {
  let best: { module: string; length: number } | null = null;

  for (const group of allGroups) {
    for (const item of group.items) {
      // "/" would prefix-match everything; it's the ungated home route.
      if (!item.to || item.to === "/") continue;
      if (path !== item.to && !path.startsWith(`${item.to}/`)) continue;
      if (!best || item.to.length > best.length) best = { module: group.module, length: item.to.length };
    }
  }

  return best?.module ?? null;
}
