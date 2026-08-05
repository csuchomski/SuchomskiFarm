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
      { label: "Animals", to: "/animals" },
      { label: "Milkings" },
      { label: "Health" },
      { label: "Lactations" },
    ],
  },
  {
    module: "store",
    heading: "Store",
    items: [
      { label: "Products", to: "/store/products" },
      { label: "Orders" },
      { label: "Schedules" },
      { label: "Customers" },
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
      { label: "Accounts" },
      { label: "Balance sheet" },
      { label: "Reports" },
    ],
  },
];

export function groupsForModules(modules: string[]): NavGroup[] {
  return allGroups.filter((g) => modules.includes(g.module));
}
