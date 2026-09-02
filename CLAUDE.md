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

Lives in `src/data/schema.js` (shapes, defaults, factories, empty seed),
`src/data/store.js` (load, save, migrate, importJSON, exportJSON),
`src/data/ops.js` (writes that enforce rules), `src/data/templates.js`
(building templates as data), and `src/data/totals.js` (totals math).

```
State    { version, updatedAt, properties[] }          // version: 4
Property { id, name, address, shape, photo, photoSize, view, floors[], bills[] }
  shape: 'gable' | 'flat' | 'mansard' | 'custom'
  photo: null or a data-URL string (JPEG, resized to <= 1200px wide; the
         original file is never stored)
  photoSize: null or { w, h } pixel size of the stored photo
  view: 'drawing' | 'photo'             // which rendering the sheet shows
  bills: building-level costs — taxes, insurance, water, mortgage
Floor { id, label, units[] }            // label like "3F", "2F", "Street"
Unit {
  id, name, position,                   // position: 'left' | 'right' | 'full' | 'side'
  rent, status,                         // status: 'leased' | 'vacant' | 'renovating'
  tenant, leaseStart, leaseEnd,         // dates as 'YYYY-MM-DD' or null
  splittable, isSplit, splitRent,       // for the double single
  sideOf,                               // 'left' | 'right': side a 'side' unit hangs off (default 'left')
  photoBox,                             // null or { x, y, w, h } fractions (0-1) of the photo
  bills[], tasks[], notes[]
}
Bill  { id, label, amount, cadence, dueDay, paid }   // cadence: 'monthly'|'yearly'|'once'
Task  { id, text, done, createdAt }
Note  { id, text, createdAt }
```

Schema history: v1 initial; v2 added `photoSize`, `view`, `sideOf` (default
`'right'`), `photoBox`; v3 changed the `sideOf` default to `'left'`; v4 has no
field changes (empty seed, rules enforced in `ops.js`). All additive, filled
by `normalizeState`, no migration step needed. A stored `sideOf` is always
kept; the default only applies to units that have none. `npm test` runs
`tests/migration.test.mjs` (a saved v2 store loads with nothing lost) and
`tests/portfolio.test.mjs` (empty seed, templates, rules, selection, totals).

### Rules enforced in the data layer (`ops.js`)

- All unit and property writes from the UI go through `patchUnit` /
  `patchProperty` / `setSideAnnex` / `setSplittable` / `removeProperty`.
  A write that would break a rule throws `RuleError` and the state is
  unchanged; App shows the message as a notice.
- **Side annex** (`position: 'side'`): only on the bottom floor
  (`floors[floors.length - 1]`), one per floor. `sideAnnexCheck(state,
  unitId)` gives `{ ok, reason }` for the UI. Toggling an annex on or off
  relays out the floor's main units (one → full, two → left/right).
  Older data that already breaks the rule is never rejected for unrelated
  edits: a property patch is refused only if it adds a violation.
- **Splittable** is per unit. `splittable: false` forces `isSplit: false`;
  `splitRent` is kept (not counted) so splitting again restores it. The
  panel warns before turning splittable off on a split unit with a second
  rent.
- **Removing a building** is refused while it has units. The last building
  may be removed; an empty sheet is a valid store.

- **Split units.** When `isSplit` is true, `rent` is the first half and
  `splitRent` is the second half. When not split, `rent` is the whole unit and
  `splitRent` is ignored but kept.
- **Seed** (`seedData()`) is an EMPTY sheet. Buildings come from
  `src/data/templates.js`: Single family, Duplex (stacked), Duplex (side by
  side), Triplex, Fourplex, Mixed use w/ storefront, Blank. Templates are
  data only (floors top-first, units with positions, roof shape);
  `buildFromTemplate(id, name)` makes a Property with fresh ids, rents at 0,
  and four building bills at 0 (Mortgage, Property taxes, Insurance, Water).
  Never hardcode a building, unit count, or unit name into a component.
  The seed is only used when storage is empty or unreadable.
- **Ids** are stable strings. Seed ids are readable (`fairview-3f-left`);
  new entities get `newId(prefix)`.

### Storage rules

- localStorage key `rentroll:v1`. `SCHEMA_VERSION` is in `schema.js`.
- Every `save()` writes the whole state object stamped with `version` and
  `updatedAt`. It refuses to write a non-state value, and refuses to write
  zero properties while the stored state still holds units unless
  `{ allowEmpty: true }`. An empty sheet over a unit-less store is fine.
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
  default right).
- **Sheet layout** (`Elevation.jsx`): a figures row with feet on the grade
  line, then the grade line as a block, then a captions row. Each caption is
  given `figureWidthFor(property)` so it lines up under its figure, and can
  grow (structure editor) without moving the grade line.
- **Structure editor** (`StructureEditor.jsx`, behind the caption's Edit
  chip): add a floor on top, rename floors, add units, remove units. Guards:
  a unit is removable only when `isEmptyUnit()` (no rent, tenant, bills,
  tasks, notes) and with a two-tap confirm; a floor only when it has no
  units; a building only when it has no units and is not the last one.
  New buildings come from `newProperty()` in `App.jsx` (two floors, one unit
  each).
- **Photo mode** (`PhotoBuilding.jsx`): when `view === 'photo'` and a photo
  exists, the figure is the photo at `max(totalWidth, 480)` px wide with one
  translucent box per unit. Boxes drag and resize with Pointer Events
  (`touch-action: none` on the box and handle, pointer capture, commit on
  pointer up). Units without a `photoBox` get a starting position from
  `defaultBoxes()`. Removing the photo keeps every `photoBox`.
- **Photo storage**: `lib/image.js` resizes to <= 1200px wide and re-encodes
  as JPEG q0.82 before anything is stored. `App.setPhoto` does a trial
  `save()` first and refuses the photo with a sized error message if the
  browser quota is hit. The roof chip is hidden in photo view; the drawing
  data is untouched by photo mode.
- **Toolbar** (under the header): Raise rents, Undo (while a raise is
  undoable), Print / PDF, Backup. Chips are 40px tall for phones.
- **Building picker** (`BuildingPicker.jsx`, under the toolbar, hidden with
  fewer than two buildings): "All" or one building. Selection is UI state
  only (`lib/selection.js`): more than `SIDE_BY_SIDE_MAX` (3) buildings
  defaults to one at a time, otherwise side by side. The sheet draws
  `displayedProperties`; **the title block, header readout, raise-rents
  sheet, print view, and backup always use the whole portfolio**. The title
  block says "Showing X only · totals cover all N buildings" when filtered.
- **Template picker** (`TemplatePicker.jsx`): opened by the empty-state
  action and the "+ Building" ghost; asks for a name, maps over `TEMPLATES`.
- **Unit panel → Layout row**: Splittable toggle and Side annex toggle (with
  Left / Right when on). The annex box is disabled with the reason from
  `sideAnnexCheck`; the rule itself lives in `ops.js`.
- **Raise all rents** (`RaiseRents.jsx`): `planRaise()` builds a list of
  {unitId, before, after} for leased units with a rent (both halves of a
  split unit); `applyChanges(state, changes, 'after' | 'before')` applies or
  undoes. The undo record lives only in App state (no data field) and undo
  skips any unit whose rent was hand-edited after the raise.
- **Rent bars** (`RentBar` in `UnitBox.jsx`): 3px bar along the bottom of
  every box, `rentPerRental(unit) / totals.maxRent`; amber below 70%.
  `rentPerRental` is the larger half of a split unit. Hidden until any rent
  exists. `rentScale` is threaded App → Elevation → Building → boxes.
- **Title block** shows six cells: collected/mo, collected/yr, if fully
  leased (+vacancy), expenses/mo (property + unit bills), net/mo, net/yr.
  `computeTotals` returns every figure as a finite number, including on an
  empty sheet.
- **Print / Save as PDF** (`PrintView.jsx`): replaces the app while open.
  White paper; theme colours are re-pointed by overriding the CSS variables
  on the wrapper, so `Elevation readOnly` prints the same drawing in dark
  ink. Read-only boxes render `RentText` / `StatusMark` instead of inputs
  and buttons. `.print-fit` gets `--print-zoom` = min(1, 720 /
  `sheetContentWidth`) so the elevation fits a page. The user triggers the
  browser print dialog themselves; nothing opens automatically.
- **Backup** (`Backup.jsx`): `exportJSON` downloads `rent-roll-YYYY-MM-DD.json`;
  import reads the file with `importJSON`, shows the merge report, and only
  applies on "Apply import". Nothing is removed by an import.
- **Empty and error states**: `Elevation` shows "Empty sheet" with the add
  button when there are no properties; a mass with no floors says "No
  floors · tap Edit"; a floor with no main units says "No units on this
  floor"; a photo that fails to decode shows a message inside its frame; the
  print view prints "No units" / "No bills entered" rows. `ErrorBoundary`
  (mounted in `main.jsx`) replaces a crashed tree with the error, a Reload
  button, and a "Download backup" button that exports what is in storage.
  Every money display goes through `formatDollars`, which never yields NaN.
- Totals (`computeTotals` in `TitleBlock.jsx`): collected counts units whose
  status is `'leased'` only. Vacant and renovating units count toward "if
  fully leased" and the vacancy gap. `'once'` bills are excluded from monthly
  net.
- Components: `Elevation.jsx` (sheet + grade line), `Building.jsx` (roof,
  floors, side boxes, caption, geometry constants), `UnitBox.jsx` (box, rent
  input, status dot, split party wall), `TitleBlock.jsx` (totals),
  `UnitPanel.jsx` (detail panel: header fields + Bills / List / Updates tabs).
- Unit edits flow through `updateUnit(unitId, patch)` in `App.jsx`, which
  calls `ops.patchUnit`; `patch` is a partial unit or a function
  `(unit) => partial`. Use the function form for anything that appends to or
  filters `bills`, `tasks`, or `notes` so two quick edits never clobber each
  other. A `RuleError` from ops is shown as a notice and the state is kept.
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
