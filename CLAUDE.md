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

_To be added in the next session. Do not invent one; wait for the prompt that
defines it, then record it here verbatim._

## Stack

- Vite + React (JavaScript, **not** TypeScript)
- Tailwind CSS v4 via `@tailwindcss/vite` (theme tokens live in `src/index.css`
  under `@theme`; the drafting grid is the `bg-blueprint-grid` utility)
- No backend. All data in `localStorage` for now.
- No state library, no router yet, no UI kit. Keep dependencies minimal.

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
