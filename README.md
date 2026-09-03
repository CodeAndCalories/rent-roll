# Rent Roll

A private, single-user tool for managing a small rental portfolio: any
number of buildings, floors, and units, each drawn as a blueprint elevation.
Built first for two adjacent buildings in Cleveland Heights, Ohio:

- **Building A — 2107 Fairview.** 6 units: a street-level storefront that juts
  off the side, a "double single" first-floor unit that can optionally be split
  into two rentals, two units on the second floor, two on the third.
- **Building B — next door.** A stacked duplex, 2 units.

The UI is an architectural blueprint elevation: a dark navy sheet with a
drafting grid, cyan line work, and monospace type. Each unit is a box on the
drawing, and rent is typed directly into the box.

A fresh install starts with an empty sheet; buildings are added from templates
(single family, duplexes, triplex, fourplex, blank). A template is only a
starting point: floors, units, names, the roof shape, and a side annex are all
changed afterwards on the drawing with Build.

Payments are tracked per unit, per month, apart from the rent a lease says
to expect: mark a month paid, partial, late, unpaid, or waived in the unit
panel, or in the month view on the toolbar, which shows what the month
expected, what came in, and what is still owed across the portfolio. A
month you never marked is untracked — grey, not unpaid — and a unit whose
current month is late or unpaid gets a small marker on the drawing.

Leases on the toolbar lists every unit in the portfolio by lease end,
soonest first — ended, within 30 days, within 90 days, later — and puts the
units with no end date in their own group at the bottom rather than hiding
them. A chip beside the title counts the leases ending within 90 days.

Scenarios are alternate versions of a portfolio to compare against reality:
forking copies the real buildings whole — rents, statuses, floors, units,
widths, splits, bills — into a snapshot that is independent from then on.
Editing a scenario never touches real data, and real data never changes a
scenario. The sheet turns violet with a banner while a scenario is open,
and Compare puts Actual beside every scenario with the differences in
colour. Photos, payments, tenants, and lease dates are never copied.

There is no backend. All data lives in the browser's `localStorage`.

## Stack

- [Vite](https://vite.dev/) + [React](https://react.dev/) (JavaScript, not TypeScript)
- [Tailwind CSS v4](https://tailwindcss.com/) via `@tailwindcss/vite`
- No state library, no router, no UI kit

## Run locally

Requires Node 20+ (developed on Node 24).

```sh
npm install
npm run dev
```

The dev server binds to <http://localhost:5173> and will **fail rather than
pick another port** if 5173 is taken (`strictPort: true`). It never opens a
browser on its own; open the URL yourself. Stop it with `Ctrl-C`.

Other scripts:

```sh
npm run build     # production build to ./dist (also writes dist/sw.js)
npm run preview   # serve ./dist on http://localhost:4173 (also strictPort)
npm run icons     # redraw the app icons into public/icons
npm test          # the node test suites
```

There is no service worker on the dev server — it exists only in a build —
so `npm run dev` is never shadowed by a cache.

## Install it on a phone

The app ships a web manifest and an offline service worker, so it can live
on a home screen:

- **Android (Chrome):** open the deployed site and Chrome offers **Install
  app** — in the ⋮ menu, or as a prompt at the bottom of the screen. It
  appears once the site is served over HTTPS with the manifest and a
  registered worker, which a production build on Vercel satisfies.
- **iPhone (Safari):** open the site, then **Share → Add to Home Screen**.
  iOS uses `apple-touch-icon.png` and opens the app without Safari chrome.

After a deploy, a copy that is already open shows **"Update available —
reload"** instead of swapping the app out underneath you. Nothing reloads
on its own.

## Deploy to Vercel

This is a static Vite site, so Vercel's zero-config Vite preset works.

1. Push the repo to GitHub (`CodeAndCalories/rent-roll`).
2. In Vercel, **Add New → Project**, import the GitHub repo.
3. Vercel auto-detects **Framework Preset: Vite**. Confirm the defaults:
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`
4. No environment variables are needed.
5. Click **Deploy**. Every push to `main` redeploys automatically.

Or from the CLI:

```sh
npm i -g vercel
vercel          # first deploy, follow the prompts
vercel --prod   # production deploy
```

Because data is stored in `localStorage`, it is per browser and per device.
Nothing is synced to Vercel or anywhere else.

## Data safety

This app holds real rental data. See `CLAUDE.md` for the rules about never
deleting or overwriting `localStorage` without an explicit migration.
