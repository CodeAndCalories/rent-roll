import { useEffect, useRef, useState } from 'react'
import { formatDollars, toAmount } from '../data/schema.js'
import { isEmptyUnit } from '../data/ops.js'
import { paymentMarker } from '../data/payments.js'
import { monthKey } from '../lib/months.js'
import { InlineLabel, TwoTapChip } from './controls.jsx'
import { rentPerRental } from './TitleBlock.jsx'

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
 *   onOpen     () => void              tap -> detail panel
 *   onFlip     () => void              side units only: flip left/right
 *   style      geometry from the parent (width/height)
 *   rentScale  highest rent on the sheet; drives the bar along the bottom
 *   readOnly   print view: text instead of inputs, no controls
 *   build      Build is on for this building: rename in place, remove if empty
 *   onRemove   () => void              build mode: drop this (empty) unit
 *   month      'YYYY-MM' the marker is about; the current local month by default
 */
export default function UnitBox({
  unit,
  variant = 'main',
  onChange,
  onOpen,
  onFlip,
  style,
  rentScale = 0,
  readOnly = false,
  build = false,
  onRemove,
  month,
}) {
  const vacant = unit.status === 'vacant'
  const renovating = unit.status === 'renovating'
  const split = Boolean(unit.splittable && unit.isSplit)
  const label = unit.name || 'Unit'
  const building = build && !readOnly
  const removable = building && Boolean(onRemove) && isEmptyUnit(unit)
  // only a month explicitly marked unpaid or late; an untracked month is silent
  const marker = paymentMarker(unit, month ?? monthKey())

  // Tapping anywhere on the box opens the detail panel, except on its own
  // controls (rent input, status dot, split, flip), which keep their jobs.
  const handleBoxTap = (e) => {
    if (readOnly) return
    if (e.target.closest('button, input, select, textarea, label, a')) return
    onOpen?.()
  }

  return (
    <div
      onClick={handleBoxTap}
      className={cx(
        'relative flex min-w-0 flex-col p-2 pb-3',
        !readOnly && 'cursor-pointer',
        // width comes from the parent's flex style (see FloorRow)
        variant === 'main' && 'border-r border-line last:border-r-0',
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
        {readOnly ? (
          <span className={cx('min-w-0 flex-1', labelClass(label))}>{label}</span>
        ) : building ? (
          <InlineLabel
            value={unit.name}
            onCommit={(name) => onChange({ name })}
            placeholder="Unit"
            ariaLabel={`${label} name`}
            title="Tap to rename"
            className="min-w-0 flex-1"
            textClassName={labelClass(label)}
            inputClassName="text-base leading-tight text-ink uppercase sm:text-[10px] sm:tracking-[0.12em]"
          />
        ) : (
          <button
            type="button"
            onClick={onOpen}
            className={cx('-my-1 min-h-8 flex-1 py-1 hover:text-amber', labelClass(label))}
            title="Open unit"
          >
            {label}
          </button>
        )}

        <div className="flex shrink-0 items-center gap-1">
          {marker && <PaymentMark text={marker} />}
          {removable && (
            <TwoTapChip
              onConfirm={onRemove}
              confirmLabel="Sure?"
              aria-label={`Remove ${label}`}
              title="Remove this empty unit"
              size="compact"
              className="-my-1.5 px-1"
            >
              ✕
            </TwoTapChip>
          )}
          {!readOnly && !building && unit.splittable && (
            <button
              type="button"
              onClick={() => onChange({ isSplit: !unit.isSplit })}
              className="-my-3 flex min-h-11 items-center border border-line/40 px-1.5 text-[9px] tracking-widest text-line uppercase hover:border-amber hover:text-amber"
              title={split ? 'Join into one rental' : 'Split into two rentals'}
            >
              {split ? 'Join' : 'Split'}
            </button>
          )}
          {!readOnly && onFlip && (
            <button
              type="button"
              onClick={onFlip}
              className="-my-3 flex h-11 w-7 items-center justify-center text-sm text-line hover:text-amber"
              aria-label="Flip to the other side of the building"
              title="Flip side"
            >
              ⇄
            </button>
          )}
          {readOnly ? (
            <StatusMark status={unit.status} />
          ) : (
            <StatusDot
              status={unit.status}
              onClick={() => onChange({ status: NEXT_STATUS[unit.status] ?? 'leased' })}
            />
          )}
        </div>
      </div>

      <div className="relative mt-auto flex items-end gap-4">
        {readOnly ? (
          <RentText value={unit.rent} />
        ) : (
          <RentInput
            value={unit.rent}
            onCommit={(rent) => onChange({ rent })}
            ariaLabel={split ? `${label} first half rent` : `${label} rent`}
          />
        )}
        {split &&
          (readOnly ? (
            <RentText value={unit.splitRent} />
          ) : (
            <RentInput
              value={unit.splitRent}
              onCommit={(splitRent) => onChange({ splitRent })}
              ariaLabel={`${label} second half rent`}
            />
          ))}
      </div>

      <RentBar unit={unit} scale={rentScale} />
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
      className="-my-3 -mr-3 flex h-11 w-11 shrink-0 items-center justify-center"
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
 * The small marker on a box whose current month is explicitly unpaid or
 * late: 'late', 'unpaid', or per half when split. Never shown for a month
 * nobody tracked. A plain span, so tapping it opens the panel like the
 * rest of the box; it costs the figure no width.
 */
export function PaymentMark({ text }) {
  return (
    <span
      role="img"
      aria-label={`This month: ${text}`}
      title={`This month: ${text}`}
      className="border border-alert/70 bg-alert/10 px-1 text-[8px] leading-4 tracking-[0.12em] whitespace-nowrap text-alert uppercase"
    >
      {text}
    </span>
  )
}

/** Non-interactive status dot for the print view. */
export function StatusMark({ status }) {
  return (
    <span
      role="img"
      aria-label={`Status ${status}`}
      title={status}
      className={cx(
        'mt-0.5 mr-0.5 block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-line/60',
        DOT[status] ?? 'bg-transparent',
      )}
    />
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

/** Read-only rent for the print view. Zero shows as a dash, never "$0". */
export function RentText({ value, compact = false }) {
  const n = toAmount(value)
  return (
    <span className={cx('min-w-0 flex-1 leading-tight text-ink tabular-nums', compact ? 'text-sm' : 'text-lg')}>
      {n > 0 ? formatDollars(n) : <span className="text-line/40">—</span>}
    </span>
  )
}

/**
 * Thin bar along the bottom edge: this unit's rent per rental as a share of
 * the highest rent on the sheet. Below 70% it turns amber so an underpriced
 * unit stands out. Hidden until at least one rent is entered.
 */
export function RentBar({ unit, scale }) {
  if (!(scale > 0)) return null
  const value = rentPerRental(unit)
  const ratio = Math.max(0, Math.min(1, value / scale))
  const low = value > 0 && ratio < 0.7
  return (
    <div
      aria-hidden
      title={`${Math.round(ratio * 100)}% of highest rent`}
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-line/15"
    >
      <div className={cx('h-full', low ? 'bg-amber' : 'bg-line/80')} style={{ width: `${ratio * 100}%` }} />
    </div>
  )
}

/**
 * Unit labels on a narrow box: two lines before anything is cut, and one size
 * step down for a long name, so "STOREFRONT" reads instead of "STORE…".
 */
export function labelClass(label) {
  const long = String(label ?? '').length > 12
  return cx(
    'line-clamp-2 min-w-0 text-left leading-tight break-words text-ink uppercase',
    long ? 'text-[9px] tracking-[0.08em]' : 'text-[10px] tracking-[0.18em]',
  )
}

function toDraft(n) {
  const amount = toAmount(n)
  return amount === 0 ? '' : String(amount)
}

function cx(...parts) {
  return parts.filter(Boolean).join(' ')
}
