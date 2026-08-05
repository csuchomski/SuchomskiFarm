# Suchomski Family Farm — integrated app

A single React + TypeScript app unifying Herd, Store, and Books behind one
nav shell, implementing the 5 screens from `../project/Integrated Farm
Mockups.dc.html`. Built fresh in this workspace per the decisions recorded
in `../IMPLEMENTATION_PLAN.md` — it is not wired into the real farm-app /
Herd / FarmFinanceTracker codebases.

## Run it

```sh
npm install
npm run dev       # dev server
npm run build     # typecheck + production build
npm run preview   # serve the production build
```

## Routes

| Route | Screen | Notes |
|---|---|---|
| `/` | **1a** Today — dashboard | home |
| `/animals` | (new) Animals index | not one of the 5 mockups; links the dashboard's "all 41 →" and the rail's "Animals" to something real |
| `/animals/:tag` | **1c** Animal record | fully data-faithful for Hazel (`1103`); other tags reuse the same layout with graceful placeholders where the mockup only ever specified Hazel's numbers (lactation curve detail, milk-destination table, health timeline, pedigree) |
| `/store/products` | **2a** Store · Products & inventory | |
| `/books/transactions` | **2b** Books · Transactions | |
| `/shop` | **1d** Customer farm store | separate `CustomerShell`, mobile-first, no ops nav |

1b (the tab-only nav alternative) was a rejected variant per the chat
transcript and isn't implemented — the whole app uses 1a's rail shell.

## Structure

- `src/styles/tokens.css` — design tokens (palette, type, metrics) lifted from the mockup's inline styles.
- `src/components/ui/` — shared primitives: `EarTag`, `Pill`, `Button`, `StatTile`, `GridRow` (the hairline rowlist/table shape used everywhere), `Callout`, `ProgressBar`, `Sparkline`/`CurveChart`, `WithdrawalBanner`.
- `src/components/shell/` — `OpsShell` (topbar + rail, used by the 4 internal screens) and `CustomerShell` (mobile header + bottom tab bar, used by the storefront).
- `src/lib/mockData.ts` — placeholder data transcribed from the mockup's literal numbers (the mockups themselves said `data: placeholders`).
- `src/routes/` — one file per screen.

## Known gaps (flagged, not silently dropped)

- Only Herd/Store/Products/Books-Transactions/Today/one-animal-record/shop are real routes; every other rail item (Milkings, Health, Lactations, Orders, Schedules, Customers, Accounts, Balance sheet, Reports) is inert text, matching what the mockups actually drew.
- No auth/roles — the Bookkeeper's narrower view mentioned in the brief was never drawn and isn't built.
- No backend — everything is static fixture data.
