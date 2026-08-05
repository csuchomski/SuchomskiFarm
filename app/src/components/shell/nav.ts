export interface NavItem {
  label: string;
  to?: string; // omit for not-yet-built sections — rendered as plain, inert text
  count?: string | number;
  countColor?: "muted" | "ochre";
  dot?: "warn" | "ok";
}

export interface NavGroup {
  heading: string;
  items: NavItem[];
}

export const topLevel: NavItem = { label: "Today", to: "/" };

export const navGroups: NavGroup[] = [
  {
    heading: "Herd",
    items: [
      { label: "Animals", to: "/animals", count: 41 },
      { label: "Milkings" },
      { label: "Health", dot: "warn" },
      { label: "Lactations" },
    ],
  },
  {
    heading: "Store",
    items: [
      { label: "Products", to: "/store/products", count: 7 },
      { label: "Orders", count: 6 },
      { label: "Schedules" },
      { label: "Customers" },
    ],
  },
  {
    heading: "Books",
    items: [
      { label: "Transactions", to: "/books/transactions", count: 4, countColor: "ochre" },
      { label: "Accounts" },
      { label: "Balance sheet" },
      { label: "Reports" },
    ],
  },
];
