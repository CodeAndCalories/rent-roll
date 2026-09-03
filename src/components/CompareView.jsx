import { formatDollars } from '../data/schema.js'
import { formatWhen } from './ScenarioBanner.jsx'
import { Chip, Sheet, cx } from './controls.jsx'

// All components at module scope (see UnitBox.jsx for why).
//
// The compare table, the point of scenarios: Actual in the first column,
// each scenario beside it, one row per figure. Every cell is that source's
// own computeTotals number (compareTable in data/scenarios.js); under a
// scenario's figure is its difference from actual, amber when better,
// alert when worse. The row labels are pinned so the columns can scroll
// sideways on a phone.

/**
 * props
 *   table          compareTable(actualProperties, scenarios)
 *   portfolioName  what "Actual" is
 *   onOpenScenarios () => void
 *   onClose        () => void
 */
export default function CompareView({ table, portfolioName, onOpenScenarios, onClose }) {
  const { columns, rows } = table

  return (
    <Sheet
      title="Compare"
      onClose={onClose}
      wide
      footer={
        <>
          <Chip onClick={onOpenScenarios}>Scenarios</Chip>
          <Chip onClick={onClose}>Close</Chip>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[10px] leading-relaxed text-line/60">
          Actual is {portfolioName} as it is now. Each scenario is its own copy from the day it was forked.
          Under a scenario's figure is its difference from actual: <span className="text-amber">amber</span>{' '}
          is better, <span className="text-alert">red</span> is worse.
        </p>

        {columns.length === 1 && (
          <p className="py-2 text-xs text-line/50">No scenarios yet. Fork one from the Scenarios sheet to compare.</p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-line">
                <th
                  scope="col"
                  className="sticky left-0 z-10 bg-sheet px-2 py-1.5 text-left text-[9px] tracking-[0.2em] text-line/70 uppercase"
                >
                  <span className="sr-only">Figure</span>
                </th>
                {columns.map((c) => (
                  <th key={c.id} scope="col" className="min-w-[6.5rem] px-2 py-1.5 text-right align-bottom">
                    <span
                      className={cx(
                        'font-display block truncate text-[10px] tracking-[0.2em] uppercase',
                        c.actual ? 'text-ink' : 'text-amber',
                      )}
                    >
                      {c.name}
                    </span>
                    <span className="block text-[8px] tracking-widest text-line/60 uppercase">
                      {c.actual ? 'now' : `from ${formatWhen(c.createdAt)}`}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line/20">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-sheet px-2 py-2 text-left text-[9px] font-normal tracking-[0.2em] whitespace-nowrap text-line/70 uppercase"
                  >
                    {r.label}
                  </th>
                  {r.cells.map((cell, i) => (
                    <td key={columns[i].id} className="px-2 py-2 text-right align-top tabular-nums">
                      <span className="block text-sm text-ink">{formatValue(r.kind, cell.value)}</span>
                      {!columns[i].actual && (
                        <span className={cx('block text-[10px]', DELTA_TONE[cell.tone] ?? DELTA_TONE.none)}>
                          {formatDelta(r.kind, cell.delta)}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Sheet>
  )
}

const DELTA_TONE = {
  amber: 'text-amber',
  alert: 'text-alert',
  none: 'text-line/40',
}

function formatValue(kind, value) {
  return kind === 'count' ? String(value) : formatDollars(value)
}

/** '+$120', '−$80', '+1', or a dash for no difference. */
function formatDelta(kind, delta) {
  if (!delta) return '—'
  const sign = delta > 0 ? '+' : '−'
  const magnitude = kind === 'count' ? String(Math.abs(delta)) : formatDollars(Math.abs(delta))
  return `${sign}${magnitude}`
}
