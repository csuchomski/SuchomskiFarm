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

/** Above the sections, beside Today, because it is the same kind of thing:
 * what today needs rather than what a subject holds. It was the first item
 * under Herd, which buried a daily page inside a subject heading. */
export const alerts: NavItem = { label: "Alerts", to: "/alerts" };

/** Below every section. Reference data the rest of the app picks from —
 * not part of any module, because a business with no herd still configures
 * things. */
export const settings: NavItem = { label: "Settings", to: "/settings" };

/** Every group the app knows how to render, across all business types. What
 * a given business actually sees is the intersection of this and its
 * modules — a rental business has no Herd, a farm has no Properties. */
export const allGroups: NavGroup[] = [
  {
    module: "herd",
    heading: "Herd",
    /**
     * Eleven items became three subjects.
     *
     * Genetics folded into Animals, Lactations into Milking, and Sires and
     * Calvings into Breeding — in each case the pages were different views
     * of one subject rather than different subjects, and the rail was
     * listing the views.
     *
     * Four things left rather than folded. Alerts went up beside Today,
     * being a daily job rather than a subject. Depreciation went to Books,
     * where the tax work is. Breeds went to Settings, being a table edited
     * twice a year. And Health was never built — an inert label with no
     * route, promising a page that does not exist.
     */
    items: [
      { label: "Animals", to: "/animals" },
      { label: "Milking", to: "/milking" },
      { label: "Breeding", to: "/breeding" },
    ],
  },
  {
    /**
     * Grazing is its own section, not a tail on Herd.
     *
     * Ten pages had accumulated at the bottom of the Herd list, below Breeds
     * and above Depreciation, which put the thing done every morning under a
     * reference page consulted twice a year. It is a section in its own right
     * and reads as one now.
     *
     * It stays on the **herd** module rather than getting one of its own.
     * Grazing means nothing without livestock, so there is no business that
     * would want one and not the other, and a module of its own would need a
     * `business_type_modules` row plus a line in this app's fallback map —
     * two places to forget, and forgetting either makes every page here
     * unreachable. `moduleForPath` keeps returning "herd" for these paths, so
     * route gating is exactly what it was.
     *
     * Two items, because there are two things: the day's work, and the
     * record it leaves. Paddocks, Mobs, Rotation and the payment record were
     * four separate stops to reach the one that gets printed, so they are
     * tabs on one page now.
     *
     * Plan and Record are still routed and still work — a bookmark to either
     * opens as it always did. They are off the rail because nothing on this
     * farm is done from them, and a nav is a list of what you use rather
     * than a list of what exists.
     */
    module: "herd",
    heading: "Grazing",
    items: [
      { label: "Move", to: "/grazing/move" },
      // The form, the rounds behind it, the ground and the mob — one page.
      { label: "Grazing records", to: "/grazing/records" },
    ],
  },
  {
    module: "store",
    heading: "Store",
    items: [
      { label: "Products", to: "/store/products" },
      { label: "Orders", to: "/store/orders" },
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
      { label: "Balance sheet", to: "/books/balance-sheet" },
      { label: "Reports", to: "/books/reports" },
      { label: "Taxes", to: "/books/taxes" },
      // Cattle depreciation. It sat under Herd, which is where the animals
      // are — but what it produces is a tax figure, and this is where the
      // rest of that work happens.
      { label: "Depreciation", to: "/depreciation" },
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
