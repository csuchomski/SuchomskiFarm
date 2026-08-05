# Implementation plan — Integrated Farm App

Status: **QUEUED — not started.** Waiting for explicit go-ahead from Chris.

## Source of truth
- `README.md` — handoff instructions
- `chats/chat1.md` — design conversation / rationale
- `project/Integrated Farm Mockups.dc.html` — the 5 target screens (read in full)
- `project/Integration Brief.dc.html` — early working brief (superseded by the mockups, but useful for the "cow → lactation → gallons → inventory lot → store order → ledger entry" spine)
- `project/uploads/` — snapshots of the three existing apps, imported into the design tool as style/data reference:
  - `App.tsx` / `main.tsx` / `vite-env.d.ts` — **Herd app**: React + TypeScript, react-router-dom, rail+tabbar shell, routes: Animals list, Animal profile, Animal form, Settings, Auth (SignIn/FarmSetup). This is the "already retheme'd to Herd's design language" base the mockups build on.
  - `App.jsx` / `main.jsx` / `index.html` / `index.css` — **farm-app / Store**: React + JS, lucide-react icons, product/inventory management with per-animal milk attribution (pooled batches), already has an icon catalog + matcher for products.
  - `index-727e3d9c.html`, `index-fadfd18b.css`, `_finance_unpacked.txt` — **FarmFinanceTracker / "Ledger"**: NOT plain React — built on a declarative template runtime (`sc-if`, `sc-for`, `sc-camel-on-click`, `{{ }}` bindings), Supabase-backed, off-system visually today (green/rounded/shadowed). This one gets rebuilt natively rather than ported as-is.

## Decisions confirmed with Chris (2026-08-05)
1. **Where it lives:** Build fresh in this workspace as a new unified codebase (not wired into the real farm-app/Herd/FarmFinanceTracker repos — those aren't attached and GitHub isn't connected this session).
2. **Merge strategy:** Real single-app merge. One React + TypeScript app, one router, one nav shell, one data layer. Port Herd's routing/shell patterns and farm-app's inventory/attribution logic in; rebuild Books/Ledger functionality natively in the same stack (not preserved as the declarative/Supabase runtime).
3. **Scope — all 5 screens**, matching `Integrated Farm Mockups.dc.html`:
   - **1a** — "Today" home dashboard: topbar + 208px rail (Today / Herd / Store / Books groups), stat row, "This morning, end to end" 4-step chain (Herd→Inventory→Store→Books), Profit-per-head rowlist, "Needs you" panel (withdrawal banner, uncategorised pickups, alerts).
   - **1c** — Animal record (Hazel): withdrawal banner, profile header w/ ear-tag block + stats, tabs (Milk & money / Health / Lactations / Pedigree / Calves), lactation curve chart (L2 vs L1 vs discarded), "Where her milk went" table, costs-on-her-line bars, health timeline, pedigree grid.
   - **1d** — Customer farm store (mobile 390, no operational vocabulary): Fresh-today product list w/ reserve, sold-out state, "Your pickups" (weekly subscription + one-off), bottom tab bar (Store/Pickups/Account).
   - **2a** — Store · Products & inventory: product rowlist (on hand/claimed/open to shop/held weekly), sold-out state, selected-product panel with milking-batch entry, per-animal attribution grid (incl. excluded/withdrawal cow), batches-on-hand table.
   - **2b** — Books · Transactions: stat row (Income/Expenses/Net/Cash/Awaiting category), "Arriving from the store" queue, ledger rowlist with Category + **Attributed to** (per-animal or split-across-herd) + Account columns, "Where July went" bar breakdown, "Unallocated" split-rule decision card (evenly vs by production).
   - 1b (tab-only nav variant) is a rejected alternative — reference only, not being built.

## Design system to encode (from the mockup CSS, not to be copied verbatim — recreate the *rules*)
- Palette: paper `#efece3`, page bg `#e8e4d8`, ink `#191a16`, hairline `#d6d2c6`, muted text `#767263`/`#43443c`/`#a9a496`, herd green `#5c6248` (active/links), ochre `#8a6a2e` (shortfall/held-back), red `#8a2f22` (loss/expense), hazard yellow `#f2c230` (**withdrawal only** — strict rule per the assistant's note in the chat), sold-green-tint `#dfe0d3`.
- Type: Newsreader serif for headings/numbers-as-headline (`.serif`), IBM Plex Sans for UI text, IBM Plex Mono (tabular nums) for all data/numbers (`.mono`), uppercase-tracked 11px IBM Plex Sans eyebrows for labels/section heads.
- Flat paper aesthetic: no shadows, no rounded corners (`border-radius:0` globally), 1px hairline borders/dividers, 2px left-border for active nav / accent callouts, ear-tag chips (mono number, 6px colored left-border keyed to herd group), pedigree/chain grids as 1px-gap CSS grid on hairline background (looks like a table without being one).
- Two shells: internal ops shell (208px rail, topbar w/ search + farm/user meta) vs. customer shell (mobile, simple header, bottom tab bar, no ear tags/operational language).

## Open items to sort out once work starts (not blocking the queue, but flag before finalizing)
- Real data model: mockups use placeholder data throughout. First pass should mirror that (mock/fixture data matching the mockups) unless Chris wants live data wired from day one.
- Auth/roles: Herd app already has SignIn/FarmSetup + session lib — decide whether to reuse that pattern for Owner/Bookkeeper/Customer roles or design fresh.
- Bookkeeper's narrower view and the balance sheet / accounts / reports / schedules / customers screens are referenced in nav but not drawn in the mockups — out of scope until designed.

## Next step
Wait for Chris to say go. Then: scaffold the unified React+TS app (Vite), build the shared design-system primitives (tokens, ear-tag chip, eyebrow, rowlist/grid patterns, nav shell), then implement the 5 screens in order 1a → 1c → 2a → 2b → 1d.
