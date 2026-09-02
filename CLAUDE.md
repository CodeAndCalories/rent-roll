# CLAUDE.md — Rent Roll

## Project

"Rent Roll" — a private tool for managing my two adjacent rental buildings in
Cleveland Heights. Building A is 2107 Fairview: 6 units (a storefront that juts
off the side at street level, a "double single" first-floor unit that can
optionally be split into two rentals, 2 units on the second floor, 2 on the
third). Building B next door is a stacked duplex, 2 units. The look is an
architectural blueprint elevation — dark navy sheet with a grid, cyan line work,
mono type — where each unit is a box on the drawing and I type the rent directly
into it.

## Machine-safety rules (non-negotiable)

Foreground only — never start detached/background/puppet servers (no &, nohup,
setsid, start /b). Never auto-open a browser or steal window/cursor/keyboard
focus — print URLs and let me click. Check the port is free before binding; if
it's taken, stop and tell me. Clean up fully on exit/Ctrl-C — release the port,
kill child processes. Don't start the dev server for me — tell me when it's
ready and I'll launch it. I need full control of my PC at all times.

## Data-safety rule (non-negotiable)

This app holds my real rental data. Never delete or overwrite `localStorage`
without an explicit migration. Never ship a change that can drop existing
units. Any change to the stored shape must:

1. Read the existing data first and keep it intact if anything fails.
2. Migrate forward in code (old shape → new shape), never by clearing.
3. Leave unknown fields alone rather than stripping them.

## Data model

Lives in `src/data/schema.js` (shapes, defaults, factories, seed) and
`src/data/store.js` (load, save, migrate, importJSON, exportJSON).

```
State    { version, updatedAt, properties[] }
Property { id, name, address, shape, photo, floors[], bills[] }
  shape: 'gable' | 'flat' | 'mansard' | 'custom'
  photo: null or a data-URL string
  bills: building-level costs — taxes, insurance, water, mortgage
Floor { id, label, units[] }            // label like "3F", "2F", "Street"
Unit {
  id, name, position,                   // position: 'left' | 'right' | 'full' | 'side'
  rent, status,                         // status: 'leased' | 'vacant' | 'renovating'
  tenant, leaseStart, leaseEnd,         // dates as 'YYYY-MM-DD' or null
  splittable, isSplit, splitRent,       // for the double single
  bills[], tasks[], notes[]
}
Bill  { id, label, amount, cadence, dueDay, paid }   // cadence: 'monthly'|'yearly'|'once'
Task  { id, text, done, createdAt }
Note  { id, text, createdAt }
```

- **Split units.** When `isSplit` is true, `rent` is the first half and
  `splitRent` is the second half. When not split, `rent` is the whole unit and
  `splitRent` is ignored but kept.
- **Seed** (`seedData()`): "2107 Fairview" (gable) with floors 3F (left/right),
  2F (left/right), Street ("Double single" full-width + splittable, "Storefront"
  side); "Duplex" (gable) with 2F "Upper" and 1F "Lower". Rents are 0. Each
  property starts with four building bills at 0: Mortgage, Property taxes,
  Insurance, Water.
- **Ids** are stable strings. Seed ids are readable (`fairview-3f-left`);
  new entities get `newId(prefix)`.

### Storage rules

- localStorage key `rentroll:v1`. `SCHEMA_VERSION` is in `schema.js`.
- Every `save()` writes the whole state object stamped with `version` and
  `updatedAt`. It refuses to write a non-state value, and refuses to write
  zero properties over a non-empty store unless `{ allowEmpty: true }`.
- On `load()`, an older `version` runs `migrate()`, which ADDS missing fields
  with defaults via `normalizeState()`. Unknown fields are never dropped.
  Explicit steps go in `MIGRATIONS[n]` (n → n+1) and must be additive and
  idempotent.
- Never wipe on a parse error. If `JSON.parse` fails or the shape is not a
  state object, the raw string is kept in `rentroll:backup` (an existing
  backup is first moved to `rentroll:backup:<timestamp>`) and the app starts
  fresh from seed.
- `exportJSON()` downloads `rent-roll-YYYY-MM-DD.json` in the stored shape.
  `importJSON()` merges by id at every level: matched entities take the
  file's scalar fields, nested lists merge recursively, unmatched entities
  are appended, and entities missing from the file are kept. Nothing is ever
  removed by an import.

### Money

Amounts are plain numbers in dollars. Round only at display with
`Math.round` (`formatDollars()`). Empty input means 0, never NaN
(`toAmount()` is the only way input becomes a stored amount).

## Stack

- Vite + React (JavaScript, **not** TypeScript)
- Tailwind CSS v4 via `@tailwindcss/vite` (theme tokens live in `src/index.css`
  under `@theme`; the drafting grid is the `bg-blueprint-grid` utility)
- No backend. All data in `localStorage` for now.
- No state library, no router yet, no UI kit. Keep dependencies minimal.
- No animation libraries.

## UI rules

- **Every component is declared at module scope.** Never define a component
  inside another component's body. An inline component gets a new identity
  each render, React remounts it, and the rent input drops keyboard focus
  after every keystroke. This has bitten the project before.
- Keys are stable ids (`unit.id`, `floor.id`, `property.id`). Never use array
  index as a key on anything that contains an input.
- Rent inputs: `type="text" inputMode="decimal"`, font-size ≥ 16px (iOS zoom),
  local text draft committed through `toAmount()` on every change.
- The elevation is drawn from data. Nothing about the user's units, floors,
  or buildings is hardcoded in components.
- `floors[0]` is the top floor (seed order: 3F, 2F, Street).
- A `'side'` unit hangs off the mass on `unit.sideOf` (`'left'` | `'right'`,
  default right). `sideOf` is written by the UI and preserved by the data
  layer as an unknown field; promote it to a `makeUnit()` default in the next
  schema change.
- Totals (`computeTotals` in `TitleBlock.jsx`): collected counts units whose
  status is `'leased'` only. Vacant and renovating units count toward "if
  fully leased" and the vacancy gap. `'once'` bills are excluded from monthly
  net.
- Components: `Elevation.jsx` (sheet + grade line), `Building.jsx` (roof,
  floors, side boxes, caption, geometry constants), `UnitBox.jsx` (box, rent
  input, status dot, split party wall), `TitleBlock.jsx` (totals),
  `UnitPanel.jsx` (detail panel: header fields + Bills / List / Updates tabs).
- Unit edits flow through `updateUnit(unitId, patch)` in `App.jsx`, where
  `patch` is a partial unit or a function `(unit) => partial`. Use the
  function form for anything that appends to or filters `bills`, `tasks`, or
  `notes` so two quick edits never clobber each other.
- The panel is a bottom sheet under `sm` and a right drawer from `sm` up.
  Tapping anywhere on a unit box opens it, except on the box's own controls
  (`UnitBox.handleBoxTap` ignores buttons, inputs, selects, labels).
- Deleting a bill, list item, or note is two taps (arm, then confirm within
  3s). Nothing in the panel can delete a unit.
- Lease flag: `leaseFlag()` in `UnitPanel.jsx` shows amber "renews soon" when
  `leaseEnd` is 0–60 days out (inclusive), alert "ended" when past.
- Unit-level bills are summed per unit in the panel (`unitBillsMonthly`).
  `computeTotals` already includes both property bills and unit bills in
  "net after bills"; the panel reuses `billMonthly` so the two agree.
- Theme: sheet `#08202E`, line `#5FB6D0`, text `#A8E8F5`, amber `#F2B441`,
  alert `#F2704B`; 22px grid at 7%; DM Mono for numbers and labels, Archivo
  uppercase wide-tracked for headings. Fonts load from Google Fonts in
  `index.html`.

## Dev server

- `npm run dev` → <http://localhost:5173>
- `strictPort: true` and `open: false` are set in `vite.config.js`. Do not
  change them.
- Check the port is free before telling the user it's ready
  (`netstat -ano | findstr :5173` on Windows).

## Git rules

- Never force push, never rewrite history.
- Never commit `.env` or any key.
- Commit in small logical chunks with clear messages.
- Remote: `https://github.com/CodeAndCalories/rent-roll.git`, branch `main`.
