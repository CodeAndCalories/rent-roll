import { describeDays, leaseGroups, leaseSummary } from '../lib/leases.js'
import { dayKey } from '../lib/months.js'
import { Chip, Sheet, cx } from './controls.jsx'

// All components at module scope (see UnitBox.jsx for why).
//
// The lease overview: every unit in the ACTIVE PORTFOLIO, soonest lease end
// first, grouped into ended / within 30 days / within 90 days / later, and
// then — visible, never hidden — the units with no end date at all. Days
// count local midnights (lib/leases.js), so a lease ending today reads 0.
// Tapping a row opens that unit's panel.

/**
 * props
 *   properties     the active portfolio's buildings (never the filtered view)
 *   portfolioName  for the caption
 *   onOpenUnit     (unitId) => void
 *   onClose        () => void
 */
export default function LeaseView({ properties, portfolioName, onOpenUnit, onClose }) {
  const today = new Date()
  const groups = leaseGroups(properties, today).filter((g) => g.rows.length > 0)
  const s = leaseSummary(properties, today)

  return (
    <Sheet title="Leases" onClose={onClose} wide footer={<Chip onClick={onClose}>Close</Chip>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-px border border-line/40 bg-line/40">
          <Cell label="Ended" value={s.ended} tone={s.ended > 0 ? 'alert' : 'ink'} />
          <Cell label="Within 90 days" value={s.within90} tone={s.within90 > 0 ? 'amber' : 'ink'} />
          <Cell label="No date set" value={s.noDate} tone={s.noDate > 0 ? 'amber' : 'ink'} />
        </div>

        <p className="text-[10px] leading-relaxed text-line/60">
          {portfolioName} · {s.total} {s.total === 1 ? 'unit' : 'units'} · soonest first · as of {dayKey(today)}.
          Days count local midnights, so a lease ending today reads 0. Tap a unit to open it.
        </p>

        {groups.length === 0 && <p className="py-2 text-xs text-line/50">No units in this portfolio.</p>}

        {groups.map((g) => (
          <section key={g.id}>
            <h3
              className={cx(
                'font-display mb-1 flex items-baseline justify-between gap-2 text-[10px] tracking-[0.25em] uppercase',
                GROUP_TONE[g.tone] ?? GROUP_TONE.line,
              )}
            >
              <span>{g.label}</span>
              <span className="font-mono tracking-normal tabular-nums">{g.rows.length}</span>
            </h3>
            <ul className="divide-y divide-line/20 border-t border-line/40">
              {g.rows.map((r) => (
                <li key={r.key}>
                  <button
                    type="button"
                    onClick={() => onOpenUnit(r.unitId)}
                    title="Open this unit"
                    className="flex min-h-11 w-full items-center gap-3 py-1 text-left hover:text-amber"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">
                        {r.unitName}
                        <span className="text-line/70"> · {r.building}</span>
                      </span>
                      <span className="block truncate text-[9px] tracking-widest text-line/60 uppercase">
                        {[r.floor, r.tenant, r.group === 'none' && r.status].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </span>
                    {r.days == null ? (
                      <span className="shrink-0 text-[9px] tracking-widest text-amber uppercase">No end date</span>
                    ) : (
                      <>
                        <span className="w-24 shrink-0 text-right text-xs text-ink tabular-nums">{r.leaseEnd}</span>
                        <span className={cx('w-16 shrink-0 text-right', DAYS_TONE[r.group] ?? DAYS_TONE.later)}>
                          <span className="block text-sm leading-tight tabular-nums">{r.days}</span>
                          <span className="block text-[8px] tracking-widest uppercase">{describeDays(r.days)}</span>
                        </span>
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Sheet>
  )
}

const GROUP_TONE = {
  alert: 'text-alert',
  amber: 'text-amber',
  line: 'text-line',
  muted: 'text-line/60',
}

const DAYS_TONE = {
  ended: 'text-alert',
  soon: 'text-amber',
  quarter: 'text-ink',
  later: 'text-line/70',
}

const CELL_TONE = { ink: 'text-ink', amber: 'text-amber', alert: 'text-alert' }

function Cell({ label, value, tone = 'ink' }) {
  return (
    <div className="bg-sheet px-2 py-2 sm:px-3">
      <div className="text-[9px] tracking-[0.2em] text-line/70 uppercase">{label}</div>
      <div className={cx('mt-0.5 text-lg leading-tight tabular-nums', CELL_TONE[tone] ?? CELL_TONE.ink)}>{value}</div>
    </div>
  )
}
