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
State     { version, updatedAt, portfolios[], properties[] }   // version: 6
Portfolio { id, name, propertyIds[] }   // the buildings it holds, by id
Property  { id, name, address, shape, photo, photoSize, view, floors[], bills[] }
  shape: 'gable' | 'flat' | 'mansard' | 'custom'
  photo: null or a data-URL string (JPEG, resized to <= 1200px wide; the
         original file is never stored)
  photoSize: null or { w, h } pixel size of the stored photo
  view: 'drawing' | 'photo'             // which rendering the sheet shows
  bills: building-level costs — taxes, insurance, water, mortgage
Floor { id, label, units[] }            // label like "3F", "2F", "Street"
Unit {
  id, name, position,                   // position: 'left' | 'right' | 'full' | 'side'
  widthWeight,                          // share of the floor's width (default 1)
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
field changes (empty seed, rules enforced in `ops.js`); v5 added
`widthWeight` (default 1); v6 added `state.portfolios`. All additive, filled
by `normalizeState`, no migration step needed. A stored `sideOf` or
`widthWeight` is always kept; the default only applies to units that have
none. **No existing field has ever moved**: v6 buildings stay exactly where
they were, at the top level, and a portfolio only lists ids. `npm test` runs
`tests/migration.test.mjs` (a saved v2 store loads with nothing lost),
`tests/portfolio.test.mjs` (empty seed, templates, rules, selection, totals),
`tests/structure.test.mjs` (add floor / unit / annex, the empty-unit and
empty-floor guards, a rename through a save and reload), and
`tests/widths.test.mjs` (weight normalization, the drag arithmetic and its
15% floor, the annex staying out of the split, `setUnitWidths`), and
`tests/portfolios.test.mjs` (a pre-v6 store gathered into one portfolio with
nothing lost, totals following the active portfolio, the last portfolio
staying put, a removal naming what it holds, export/import across
portfolios).

### Portfolios

A portfolio holds its buildings **by id**, so adding, renaming, or removing
one never moves a building. Two invariants are kept by `normalizeState`
(`withPortfolios` in `schema.js`), never by a component:

- there is always at least one portfolio (a new one is named
  `DEFAULT_PORTFOLIO_NAME`, "My properties")
- every building is in exactly one portfolio — first claim wins, dead ids
  are dropped, and a building no list claims is **adopted by the first**, so
  it can never fall off the sheet

Which portfolio is active is UI state, like the building selection
(`src/lib/portfolios.js`: `resolvePortfolioId`, `activePortfolio`,
`propertiesOf`, `portfolioState`, `portfolioSummaries`). The sheet, the
building picker, the raise-rents sheet, the print view, and **the totals**
cover the active portfolio; **Backup covers every portfolio**.

### Rules enforced in the data layer (`ops.js`)

- All unit and property writes from the UI go through `patchUnit` /
  `patchProperty` / `setSideAnnex` / `setSplittable` / `removeProperty`,
  and every structural write through `addFloor` / `addUnit` /
  `addSideAnnex` / `removeUnit` / `removeFloor` / `renameFloor`.
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
- **Removing a building** is refused while it has units, unless the caller
  passes `{ force: true }` — what the caption's confirm sends after naming
  the contents. Either way the id leaves its portfolio. The last building
  may be removed; an empty sheet is a valid store.
- **`describeContents(property)`** counts what a building holds (units, how
  many with rent, tenants, bills, list items, notes) and writes the line the
  confirm shows. Building bills at 0 are not counted: every template starts
  with four of them.
- **Portfolios**: `addPortfolio` (the caller makes it with `makePortfolio`,
  so it knows the id), `renamePortfolio`, `removePortfolio`. The last
  portfolio can never be removed; one holding buildings needs
  `{ force: true }` and takes its buildings with it.
  `describePortfolio(state, id)` writes that confirm's line.
- **Removing a unit** is refused unless `isEmptyUnit()` (no rent, no second
  rent, no tenant, no bills, list items, or notes). **Removing a floor** is
  refused while anything is on it, the annex included. Both relayout what is
  left (one main unit → full, two → left/right).
- **Unit widths**: `setUnitWidths(state, propertyId, floorId, weights)`
  writes `widthWeight` on the units it names and leaves the rest alone, so a
  drag only ever stores the pair it moved. A weight that is not a positive
  number falls back to 1, one aimed at a side annex is ignored, and a write
  that changes nothing returns the very same state.
- **Adding**: `addFloor` puts a floor on top, labelled off the old top
  floor (`nextFloorLabel`), with one unit on it. `addUnit` appends to a
  floor and relays it out. `addSideAnnex(state, id, side)` hangs one off the
  bottom floor and is refused when that floor already has one, or when the
  building has no floors.

- **Split units.** When `isSplit` is true, `rent` is the first half and
  `splitRent` is the second half. When not split, `rent` is the whole unit and
  `splitRent` is ignored but kept.
- **Seed** (`seedData()`) is an EMPTY sheet. Buildings come from
  `src/data/templates.js`: Single family, Duplex (stacked), Duplex (side by
  side), Triplex, Fourplex, Blank — common layouts only, and a template is
  a starting point, not the finished building. No template ships a side
  annex; that stays a per-unit toggle. Templates are data only (floors
  top-first, units with positions, roof shape);
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
  `importJSON()` merges by id at every level — portfolio included: matched
  entities take the file's scalar fields, nested lists merge recursively, a
  matched portfolio takes the file's name and the **union** of both lists of
  buildings, unmatched entities are appended, and entities missing from the
  file are kept. Nothing is ever removed by an import, and `withPortfolios`
  runs after so an imported building always lands in a portfolio.

### Unit widths

The main units on a floor split its width in proportion to their
`widthWeight` (default 1), so a floor of all-1s is the equal split every
store drew before v5. The arithmetic lives in `src/lib/widths.js` — no React
in it, so the drag handle's behaviour is tested in node:

- `sharesOf(units)` → fractions summing to 1; `growOf(units)` → the same
  scaled to the unit count, which is what goes on the box as `flex-grow`
  (equal weights give 1 each, exactly what `flex-1` did).
- `resizePair(units, i, delta)` moves the shared edge between units `i` and
  `i + 1` by a fraction of the floor. The pair's combined share never
  changes, so no other unit moves, and neither side drops below
  `MIN_SHARE` (0.15) — or half the pair, when the pair itself holds less
  than twice that.
- `equalizePair(units, i)` is the double-tap reset.
- A side annex is never in the split: it keeps `SIDE_W` and its weight is
  ignored.

### Money

Amounts are plain numbers in dollars. Round only at display with
`Math.round` (`formatDollars()`). Empty input means 0, never NaN
(`toAmount()` is the only way input becomes a stored amount).

## Installed app (PWA)

- `public/manifest.webmanifest`: standalone, navy theme and background,
  icons at 192 and 512 in both `any` and `maskable`. iOS gets
  `apple-touch-icon` plus the `apple-mobile-web-app-*` meta in
  `index.html`.
- **Icons are generated, not drawn by hand**: `npm run icons`
  (`scripts/make-icons.mjs`) renders the blueprint elevation at 4x and
  encodes the PNGs with node's own zlib — no image dependency. Maskable
  variants keep the drawing inside the safe circle. Re-run it if the theme
  colours change.
- **Service worker** (`src/sw.js` is the SOURCE; a build-only plugin in
  `vite.config.js` emits `dist/sw.js`):
  - `__BUILD_ID__` is a hash of the build's asset names, which are content
    hashes, so the cache name changes exactly when the build does.
  - `activate` deletes every other `rentroll-shell-*` cache.
  - Documents are network-first (a deploy is picked up on the next reload,
    with the cache as the offline fallback); hashed assets are cache-first.
  - A waiting worker never takes over on its own: `UpdatePrompt.jsx` shows
    "Update available — reload" and only that button posts `SKIP_WAITING`.
    `src/lib/sw.js` reloads once on `controllerchange`.
  - **It must never touch localStorage**, cache anything that stands in for
    it, or intercept a non-GET or cross-origin request.
- Registration is production-only (`import.meta.env.DEV` guard) and the dev
  server has no `sw.js` to serve, so `npm run dev` is never shadowed.

## Mobile rules

- Every tap target is at least 44px on a phone: `Chip` carries the size
  (`size="tap"` default, 44px under `sm` and the 36px drafting size above),
  status dots, width handles, the + floor and + unit tabs, panel rows, and
  close buttons. Controls inside a unit box use negative margins so a 44px
  target never changes the box's geometry, and `size="compact"` (36px) is
  only for the chips that live in one — three 44px targets do not fit a
  160px column. Split/Join is hidden while Build is on, which is what makes
  room for the ✕.
- **Every input is 16px or larger on a phone** (`text-base`, with the
  drafting size restored at `sm:`), so iOS never zooms on focus. That is
  why the viewport has no `maximum-scale`: pinch zoom stays available.
- `viewport-fit=cover` plus `env(safe-area-inset-*)` on the header, the
  title block, both bottom sheets, and the body.
- `interactive-widget=resizes-content` and `keepFocusedFieldVisible`
  (`controls.jsx`) keep the field being edited above the keyboard.
- The page never scrolls sideways: `overflow-x: clip` on `body` (clip, not
  hidden, so the sticky title block still works). Only the elevation
  scrolls horizontally.
- The toolbar's labels collapse under `sm` so its chips stay on one line at
  380px.

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
  grow (the Build hint line) without moving the grade line.
- **Build handles** (`Building.jsx`, behind the caption's Build chip; which
  building is in Build mode is `buildId` state in `Elevation.jsx`, never
  stored, one at a time). The handles are drawn on the figure itself: a
  dashed `+ floor` strip above the roof, a dashed `+` tab on the right edge
  of each floor, a dashed `+ annex` tab at the free outside edge of the
  bottom floor (only when that floor has none), a two-tap ✕ on every empty
  unit and empty floor, and `✕ Building` in the caption once a building has
  no units. The `+` tab sits inside the mass and the annex tab is positioned
  absolutely, so Build never changes a figure's width or moves a caption.
  Build is hidden in photo view, and never renders in the print view. Every
  handle calls `ops.js`; the guards live there, not in the component.
- **Width handles** (`WidthHandle` in `Building.jsx`, Build mode only): a
  zero-width flex item on each shared wall with a 24px target over it, so it
  costs the drawing no space and the figure never moves. Pointer Events with
  pointer capture and `touch-action: none` (as in photo mode), so a thumb
  can drag it without scrolling the sheet. The drag previews through draft
  weights held in `FloorRow`; the release commits once through
  `structure.setWidths` → `ops.setUnitWidths`. A second tap within
  `DOUBLE_TAP_MS` (350) resets the pair to equal, and a real drag never
  counts as the first of two taps. Floor heights are never touched.
- **Inline rename**: with Build on, a unit or floor label is an
  `InlineLabel` (`controls.jsx`) — tap to edit in place, Enter or blur
  commits, Escape cancels (a ref marks the cancel before the blur, which
  still closes over the old draft). Renaming from the unit panel is
  unaffected.
- **Unit labels** wrap to two lines and drop one size step past 12
  characters (`labelClass()` in `UnitBox.jsx`) rather than truncating, so a
  narrow box still reads.
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
- **Portfolio bar** (`PortfolioBar.jsx`, under the header, top-left):
  "+ Portfolio", then one chip per portfolio with its building count. The
  active one is outlined amber and its name is an `InlineLabel` (tap to
  rename). A two-tap `✕ Portfolio` names what would go with it; with one
  portfolio there is no remove control at all. Switching is UI state and
  also clears the building selection.
- **Saved indicator** (`SaveState.jsx`, beside the title): after a write it
  shows "Saved" and fades (`animate-save-flash`, 2s, `motion-reduce`); a
  failed write shows "● Not saved — <reason>" and stays until one succeeds.
  **There is no save button and there must never be one** — App's effect
  writes on every state change. An explicit confirmed removal sets
  `emptyingOnPurpose` for exactly one write, which is how `save()` is told
  an empty sheet is deliberate.
- **Removing a building** (caption, Build mode): a building with units shows
  "Remove building" and the armed chip names its contents through
  `TwoTapChip`'s `detail`; an empty one keeps the quiet `✕ Building`.
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
- **Title block** is labelled with the active portfolio's name, and shows
  six cells: collected/mo, collected/yr, if fully
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
- **First run**: `EmptyState` in `Elevation.jsx` is one line saying what
  this is and one "+ Add building" chip. Nothing else — no tour, no sample
  data.
- **Empty and error states**: `Elevation` shows the first-run line with the
  add button when there are no properties; a mass with no floors says "No
  floors · tap Build" ("· use + floor" while Build is on); a floor with no
  main units says "No units on this floor"; a photo that fails to decode shows a message inside its frame; the
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
