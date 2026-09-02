import { useEffect, useRef, useState } from 'react'
import { toAmount } from '../data/schema.js'

// Every component in this file is declared at MODULE scope. Never declare a
// component inside another component's body: it gets a new identity each
// render, React remounts it, and the rent input loses focus on every
// keystroke.

const NEXT_STATUS = { leased: 'vacant', vacant: 'renovating', renovating: 'leased' }

/**
 * One unit box on the drawing.
 *
 * props
 *   unit       the Unit record
 *   variant    'main' (in the building mass) | 'side' (hangs off the side)
 *   onChange   (patch) => void         partial update of this unit
 *   onOpen     () => void              tap on the label -> detail panel
 *   onFlip     () => void              side units only: flip left/right
 *   style      geometry from the parent (width/height)
 */
export default function UnitBox({ unit, variant = 'main', onChange, onOpen, onFlip, style }) {
  const vacant = unit.status === 'vacant'
  const renovating = unit.status === 'renovating'
  const split = Boolean(unit.splittable && unit.isSplit)
  const label = unit.name || 'Unit'

  // Tapping anywhere on the box opens the detail panel, except on its own
  // controls (rent input, status dot, split, flip), which keep their jobs.
  const handleBoxTap = (e) => {
    if (e.target.closest('button, input, select, textarea, label, a')) return
    onOpen?.()
  }

  return (
    <div
      onClick={handleBoxTap}
      className={cx(
        'relative flex min-w-0 cursor-pointer flex-col p-2',
        variant === 'main' && 'flex-1 border-r border-line last:border-r-0',
        variant === 'side' && 'shrink-0 border border-line bg-line/5',
        renovating && 'outline-dashed outline-1 -outline-offset-4 outline-amber/70',
      )}
      style={style}
    >
      {/* vacant hatching: always mounted, toggled by opacity so status changes
          never restructure the tree around the inputs */}
      <div
        aria-hidden
        className={cx(
          'hatch-45 pointer-events-none absolute inset-0 transition-opacity',
          vacant ? 'opacity-100' : 'opacity-0',
        )}
      />

      {/* party wall for a split double single: same box, one line down the middle */}
      {split && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 border-x border-line"
        />
      )}

      <div className="relative flex items-start justify-between gap-1">
        <button
          type="button"
          onClick={onOpen}
          className="-my-1 min-h-8 truncate py-1 text-left text-[10px] leading-tight tracking-[0.18em] text-ink uppercase hover:text-amber"
          title="Open unit"
        >
          {label}
        </button>

        <div className="flex shrink-0 items-center gap-1">
          {unit.splittable && (
            <button
              type="button"
              onClick={() => onChange({ isSplit: !unit.isSplit })}
              className="border border-line/40 px-1.5 py-0.5 text-[9px] tracking-widest text-line uppercase hover:border-amber hover:text-amber"
              title={split ? 'Join into one rental' : 'Split into two rentals'}
            >
              {split ? 'Join' : 'Split'}
            </button>
          )}
          {onFlip && (
            <button
              type="button"
              onClick={onFlip}
              className="-my-1 flex h-8 w-7 items-center justify-center text-sm text-line hover:text-amber"
              aria-label="Flip to the other side of the building"
              title="Flip side"
            >
              ⇄
            </button>
          )}
          <StatusDot
            status={unit.status}
            onClick={() => onChange({ status: NEXT_STATUS[unit.status] ?? 'leased' })}
          />
        </div>
      </div>

      <div className="relative mt-auto flex items-end gap-4">
        <RentInput
          value={unit.rent}
          onCommit={(rent) => onChange({ rent })}
          ariaLabel={split ? `${label} first half rent` : `${label} rent`}
        />
        {split && (
          <RentInput
            value={unit.splitRent}
            onCommit={(splitRent) => onChange({ splitRent })}
            ariaLabel={`${label} second half rent`}
          />
        )}
      </div>
    </div>
  )
}

const DOT = {
  leased: 'bg-line',
  vacant: 'bg-alert',
  renovating: 'bg-amber',
}

/** Corner dot; tap cycles leased -> vacant -> renovating. */
export function StatusDot({ status, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-my-2 -mr-2 flex h-9 w-9 shrink-0 items-center justify-center"
      aria-label={`Status ${status}. Tap to change.`}
      title={status}
    >
      <span
        className={cx(
          'block h-2.5 w-2.5 rounded-full ring-1 ring-line/60',
          DOT[status] ?? 'bg-transparent',
        )}
      />
    </button>
  )
}

/**
 * Rent field. Keeps a local text draft so "1200." survives while typing;
 * commits toAmount(draft) on every change so totals update live; tidies the
 * draft on blur. External changes (import) are picked up when unfocused.
 */
export function RentInput({ value, onCommit, ariaLabel, compact = false }) {
  const [draft, setDraft] = useState(() => toDraft(value))
  const ref = useRef(null)

  useEffect(() => {
    if (typeof document !== 'undefined' && document.activeElement === ref.current) return
    setDraft(toDraft(value))
  }, [value])

  return (
    <label className="flex min-w-0 flex-1 items-baseline gap-1 border-b border-line/50 focus-within:border-amber">
      <span className="text-sm text-line/70">$</span>
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        placeholder="0"
        aria-label={ariaLabel}
        value={draft}
        onChange={(e) => {
          const raw = e.target.value
          setDraft(raw)
          onCommit(toAmount(raw))
        }}
        onBlur={() => setDraft(toDraft(value))}
        className={cx(
          'w-full min-w-0 bg-transparent leading-tight text-ink tabular-nums outline-none placeholder:text-line/30',
          compact ? 'text-sm' : 'text-lg',
        )}
      />
    </label>
  )
}

function toDraft(n) {
  const amount = toAmount(n)
  return amount === 0 ? '' : String(amount)
}

function cx(...parts) {
  return parts.filter(Boolean).join(' ')
}
