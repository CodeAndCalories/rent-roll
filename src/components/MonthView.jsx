import { formatDollars } from '../data/schema.js'
import { monthSummary } from '../data/payments.js'
import { monthKey, monthLabel, shiftMonth } from '../lib/months.js'
import { Chip, Sheet, cx } from './controls.jsx'

// All components at module scope (see UnitBox.jsx for why).
//
// The month view: one month of the ACTIVE PORTFOLIO, a row per rental (a
// unit, or each half of a split unit), with what the month expected, what
// came in, and what is still owed. Tapping a status cycles it through
// ops.cyclePayment; tapping the unit opens its panel on the Payments tab.
// An untracked month is grey with a dash: nothing has been said about it,
// and it adds nothing to "outstanding".

/**
 * props
 *   properties     the active portfolio's buildings (never the filtered view)
 *   portfolioName  for the caption
 *   month          'YYYY-MM' being shown (App state, kept while the app is open)
 *   onMonth        (month) => void
 *   onCycle        (unitId, month, half) => void   ops.cyclePayment behind it
 *   onOpenUnit     (unitId) => void                 opens the panel on Payments
 *   onClose        () => void
 */
export default function MonthView({ properties, portfolioName, month, onMonth, onCycle, onOpenUnit, onClose }) {
  const s = monthSummary(properties, month)
  const now = monthKey()
  const groups = groupRows(s.rows)

  return (
    <Sheet title="Payments" onClose={onClose} wide footer={<Chip onClick={onClose}>Close</Chip>}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Chip onClick={() => onMonth(shiftMonth(month, -1))} aria-label="Previous month" title="Previous month" className="px-4">
            ‹
          </Chip>
          <div className="min-w-0 text-center">
            <div className="font-display truncate text-sm tracking-[0.25em] text-ink uppercase">
              {monthLabel(month, { long: true })}
            </div>
            <div className="truncate text-[9px] tracking-[0.2em] text-line/60 uppercase">{portfolioName}</div>
            {month !== now && (
              <button
                type="button"
                onClick={() => onMonth(now)}
                className="mt-0.5 min-h-8 text-[9px] tracking-[0.2em] text-amber uppercase underline decoration-dashed underline-offset-4"
              >
                Back to this month
              </button>
            )}
          </div>
          <Chip onClick={() => onMonth(shiftMonth(month, 1))} aria-label="Next month" title="Next month" className="px-4">
            ›
          </Chip>
        </div>

        <div className="grid grid-cols-3 gap-px border border-line/40 bg-line/40">
          <Cell label="Expected" value={formatDollars(s.expected)} />
          <Cell label="Collected" value={formatDollars(s.collected)} />
          <Cell label="Outstanding" value={formatDollars(s.outstanding)} tone={s.outstanding > 0 ? 'alert' : 'ink'} />
        </div>

        <p className="text-[10px] leading-relaxed text-line/60">
          {s.tracked} tracked · {s.untracked} untracked
          {s.waived > 0 && <> · {formatDollars(s.waived)} waived</>}. Tap a status to change it, tap a unit to
          open it. A month you never marked is untracked, not unpaid, and owes nothing here.
        </p>

        {groups.length === 0 && <p className="py-2 text-xs text-line/50">No units in this portfolio.</p>}

        {groups.map((g) => (
          <section key={g.propertyId}>
            <h3 className="font-display mb-1 truncate text-[10px] tracking-[0.25em] text-line/70 uppercase">
              {g.building}
            </h3>
            <ul className="divide-y divide-line/20 border-t border-line/40">
              {g.rows.map((r) => (
                <li key={r.key} className="flex items-center gap-2 py-1">
                  <button
                    type="button"
                    onClick={() => onOpenUnit(r.unitId)}
                    title="Open this unit on its Payments tab"
                    className="min-h-11 min-w-0 flex-1 py-1 text-left hover:text-amber"
                  >
                    <span className="block truncate text-sm text-ink">
                      {r.unitName}
                      {r.split && <span className="text-line/70"> · {r.half}</span>}
                    </span>
                    <span className="block truncate text-[9px] tracking-widest text-line/60 uppercase">
                      {[r.floor, r.unit.tenant && String(r.unit.tenant).trim()].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </button>
                  <span
                    className={cx(
                      'w-20 shrink-0 text-right text-sm tabular-nums',
                      r.record ? 'text-ink' : 'text-line/40',
                    )}
                    title={r.record ? 'Amount on the record' : r.expected > 0 ? 'Expected from the lease' : ''}
                  >
                    {r.record ? formatDollars(r.record.amount) : r.expected > 0 ? formatDollars(r.expected) : '—'}
                  </span>
                  <StatusCell status={r.status} onClick={() => onCycle(r.unitId, month, r.half)} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Sheet>
  )
}

/** Rows in drawing order, grouped by building, keeping that order. */
function groupRows(rows) {
  const groups = []
  for (const r of rows) {
    const last = groups[groups.length - 1]
    if (last && last.propertyId === r.propertyId) last.rows.push(r)
    else groups.push({ propertyId: r.propertyId, building: r.building, rows: [r] })
  }
  return groups
}

export const STATUS_TONE = {
  paid: 'border-line bg-line/15 text-ink',
  partial: 'border-amber bg-amber/10 text-amber',
  late: 'border-alert bg-alert/15 text-alert',
  unpaid: 'border-alert/70 text-alert',
  waived: 'border-dashed border-line/50 text-line/60',
  untracked: 'border-dashed border-line/30 text-line/40',
}

/** The tappable status: a 44px target, coloured by status; a dash when untracked. */
function StatusCell({ status, onClick }) {
  const untracked = status === 'untracked'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={untracked ? 'Untracked. Tap to mark paid.' : `${status}. Tap to change.`}
      title={untracked ? 'Untracked · tap to mark paid' : 'Tap to change'}
      className={cx(
        'flex min-h-11 w-20 shrink-0 items-center justify-center border text-[9px] tracking-[0.18em] uppercase select-none sm:min-h-9',
        STATUS_TONE[status] ?? STATUS_TONE.untracked,
      )}
    >
      {untracked ? '—' : status}
    </button>
  )
}

const CELL_TONE = { ink: 'text-ink', alert: 'text-alert' }

function Cell({ label, value, tone = 'ink' }) {
  return (
    <div className="bg-sheet px-2 py-2 sm:px-3">
      <div className="text-[9px] tracking-[0.2em] text-line/70 uppercase">{label}</div>
      <div className={cx('mt-0.5 text-lg leading-tight tabular-nums', CELL_TONE[tone] ?? CELL_TONE.ink)}>{value}</div>
    </div>
  )
}
