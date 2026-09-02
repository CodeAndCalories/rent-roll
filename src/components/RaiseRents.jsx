import { useState } from 'react'
import { formatDollars, toAmount } from '../data/schema.js'
import { computeTotals } from './TitleBlock.jsx'
import { Chip, Sheet, cx } from './controls.jsx'

// All components at module scope (see UnitBox.jsx for why).
//
// "Raise all rents": model a +% or +$ change across every leased unit, see
// the new totals before applying, and undo afterwards. The undo record lives
// in App state only (no new data fields); it reverts a unit only if its rent
// is still exactly what the raise set, so later manual edits are kept.

const MODES = [
  { id: 'percent', label: '+ %' },
  { id: 'dollar', label: '+ $' },
]

/**
 * Plan the change without touching state. Returns one entry per affected
 * unit: { unitId, name, building, before: {rent, splitRent}, after: {...} }.
 * Only 'leased' units with a rent above 0 are affected; a split unit gets
 * both halves raised.
 */
export function planRaise(properties, { mode, amount, round = true }) {
  const amt = toAmount(amount)
  const changes = []
  if (!amt) return changes

  const bump = (v) => {
    if (v <= 0) return v
    const n = mode === 'percent' ? v * (1 + amt / 100) : v + amt
    const safe = Math.max(0, n)
    return round ? Math.round(safe) : Math.round(safe * 100) / 100
  }

  for (const p of properties ?? []) {
    for (const f of p.floors ?? []) {
      for (const u of f.units ?? []) {
        if (u.status !== 'leased') continue
        const before = { rent: toAmount(u.rent), splitRent: toAmount(u.splitRent) }
        const split = Boolean(u.splittable && u.isSplit)
        const after = { rent: bump(before.rent), splitRent: split ? bump(before.splitRent) : before.splitRent }
        if (after.rent !== before.rent || after.splitRent !== before.splitRent) {
          changes.push({ unitId: u.id, name: u.name || 'Unit', building: p.name || 'Building', before, after })
        }
      }
    }
  }
  return changes
}

/**
 * Apply ('after') or undo ('before') a plan. Undo skips any unit whose rent
 * no longer matches what the raise set, so manual edits made since are kept.
 */
export function applyChanges(state, changes, dir = 'after') {
  const map = new Map(changes.map((c) => [c.unitId, c]))
  const other = dir === 'after' ? 'before' : 'after'
  return {
    ...state,
    properties: state.properties.map((p) => ({
      ...p,
      floors: p.floors.map((f) => ({
        ...f,
        units: f.units.map((u) => {
          const c = map.get(u.id)
          if (!c) return u
          if (
            dir === 'before' &&
            (toAmount(u.rent) !== c[other].rent || toAmount(u.splitRent) !== c[other].splitRent)
          ) {
            return u
          }
          return { ...u, rent: c[dir].rent, splitRent: c[dir].splitRent }
        }),
      })),
    })),
  }
}

export function describeRaise(mode, amount) {
  const amt = toAmount(amount)
  const sign = amt < 0 ? '−' : '+'
  return mode === 'percent' ? `${sign}${Math.abs(amt)}%` : `${sign}${formatDollars(Math.abs(amt))}`
}

export default function RaiseRentsSheet({ properties, onApply, onClose }) {
  const [mode, setMode] = useState('percent')
  const [draft, setDraft] = useState('3')
  const [round, setRound] = useState(true)
  const amount = toAmount(draft)
  const changes = planRaise(properties, { mode, amount, round })
  const before = computeTotals(properties)
  const after = computeTotals(applyChanges({ properties }, changes).properties)
  const delta = after.collected - before.collected
  const leasedCount = before.leased

  return (
    <Sheet
      title="Raise all rents"
      onClose={onClose}
      footer={
        <>
          <Chip onClick={onClose}>Cancel</Chip>
          <Chip
            active
            disabled={changes.length === 0}
            onClick={() => onApply({ changes, mode, amount })}
            className="min-h-10"
          >
            Apply to {changes.length} {changes.length === 1 ? 'unit' : 'units'}
          </Chip>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div role="radiogroup" aria-label="Raise by" className="inline-flex">
            {MODES.map((m) => (
              <Chip
                key={m.id}
                role="radio"
                aria-checked={mode === m.id}
                active={mode === m.id}
                onClick={() => setMode(m.id)}
                className={cx('min-h-10', m.id !== 'percent' && '-ml-px')}
              >
                {m.label}
              </Chip>
            ))}
          </div>
          <label className="flex items-baseline gap-1 border-b border-line/50 focus-within:border-amber">
            <span className="text-sm text-line/70">{mode === 'percent' ? '%' : '$'}</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              enterKeyHint="done"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={mode === 'percent' ? 'Percent increase' : 'Dollar increase'}
              className="w-24 bg-transparent text-lg text-ink tabular-nums outline-none"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[10px] tracking-widest text-line/70 uppercase">
            <input
              type="checkbox"
              checked={round}
              onChange={(e) => setRound(e.target.checked)}
              className="h-4 w-4 accent-amber"
            />
            Whole dollars
          </label>
        </div>

        <p className="text-[10px] text-line/60">
          Applies to leased units with a rent entered. Vacant and renovating units are left alone. A
          negative number lowers rents. Undo is available afterwards.
        </p>

        <div className="border border-line/40 p-3">
          <div className="text-[9px] tracking-[0.2em] text-line/70 uppercase">Preview</div>
          {leasedCount === 0 ? (
            <p className="mt-1 text-xs text-line/60">No leased units yet. Set a unit's status to leased first.</p>
          ) : changes.length === 0 ? (
            <p className="mt-1 text-xs text-line/60">
              {amount === 0 ? 'Enter an amount to see the effect.' : 'No leased unit has a rent to change.'}
            </p>
          ) : (
            <>
              <div className="mt-1 text-lg text-ink tabular-nums">
                {formatDollars(before.collected)} → {formatDollars(after.collected)}
                <span className={cx('ml-2 text-sm', delta >= 0 ? 'text-amber' : 'text-alert')}>
                  {delta >= 0 ? '+' : '−'}
                  {formatDollars(Math.abs(delta))} / mo
                </span>
              </div>
              <div className="text-[10px] text-line/70 tabular-nums">
                {formatDollars(before.annual)} → {formatDollars(after.annual)} / yr · net{' '}
                {formatDollars(after.net)} / mo
              </div>
              <ul className="mt-2 max-h-48 divide-y divide-line/20 overflow-y-auto text-xs">
                {changes.map((c) => (
                  <li key={c.unitId} className="flex items-center justify-between gap-2 py-1">
                    <span className="min-w-0 truncate">
                      <span className="text-line/60">{c.building} · </span>
                      {c.name}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {formatDollars(c.before.rent)} → <span className="text-ink">{formatDollars(c.after.rent)}</span>
                      {c.after.splitRent !== c.before.splitRent && (
                        <span className="text-line/70">
                          {' '}
                          · B {formatDollars(c.before.splitRent)} → {formatDollars(c.after.splitRent)}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </Sheet>
  )
}
