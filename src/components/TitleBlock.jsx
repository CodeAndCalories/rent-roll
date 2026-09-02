import { formatDollars } from '../data/schema.js'
import { billMonthly, computeTotals, rentPerRental, unitMonthly } from '../data/totals.js'

// All components at module scope (see UnitBox.jsx for why).
// The totals math lives in src/data/totals.js; re-exported here so existing
// imports keep working.
export { billMonthly, computeTotals, rentPerRental, unitMonthly }

/**
 * The drafting title block. Totals cover the ACTIVE PORTFOLIO, whatever the
 * sheet is drawing: `portfolioName` names it, and `showing` names the one
 * building drawn when the sheet is filtered, so neither is ambiguous.
 */
export default function TitleBlock({ totals: t, saveError, showing = null, portfolioName = '' }) {
  const today = new Date().toISOString().slice(0, 10)

  return (
    <footer className="sticky bottom-0 z-20 border-t-2 border-line bg-sheet/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      {/* 1px gaps over a line-coloured background draw the cell dividers */}
      <div className="grid grid-cols-2 gap-px bg-line/40 sm:grid-cols-3 lg:grid-cols-6">
        <Cell label="Collected / mo" value={formatDollars(t.collected)} sub={`${t.leased}/${t.units} leased`} />
        <Cell label="Collected / yr" value={formatDollars(t.annual)} />
        <Cell
          label="If fully leased"
          value={formatDollars(t.potential)}
          sub={t.vacancy > 0 ? `vacancy −${formatDollars(t.vacancy)}` : 'no vacancy'}
          tone={t.vacancy > 0 ? 'alert' : 'line'}
        />
        <Cell
          label="Expenses / mo"
          value={formatDollars(t.bills)}
          sub={`bldg ${formatDollars(t.propertyBills)} · units ${formatDollars(t.unitBills)}`}
        />
        <Cell label="Net / mo" value={formatDollars(t.net)} tone={t.net < 0 ? 'alert' : 'line'} valueTone={t.net < 0 ? 'alert' : 'ink'} />
        <Cell label="Net / yr" value={formatDollars(t.annualNet)} valueTone={t.annualNet < 0 ? 'alert' : 'ink'} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line/40 px-3 py-1.5 text-[9px] tracking-[0.2em] text-line/70 uppercase sm:px-4">
        <span className="font-display truncate text-ink">{portfolioName || 'Portfolio'} · totals</span>
        <span>
          {t.properties} {t.properties === 1 ? 'bldg' : 'bldgs'} · {t.units} units · {t.billCount} bills
        </span>
        {showing && (
          <span className="text-amber">
            Showing {showing} only · totals cover {portfolioName || 'this portfolio'} ({t.properties}{' '}
            {t.properties === 1 ? 'building' : 'buildings'})
          </span>
        )}
        <span>Sheet A-1 · {today}</span>
        {saveError ? (
          <span className="text-alert normal-case tracking-normal">Not saved: {saveError}</span>
        ) : (
          <span>Saved locally</span>
        )}
      </div>
    </footer>
  )
}

const TONE = {
  line: 'text-line/70',
  alert: 'text-alert',
  amber: 'text-amber',
}
const VALUE_TONE = {
  ink: 'text-ink',
  alert: 'text-alert',
}

function Cell({ label, value, sub, tone = 'line', valueTone = 'ink' }) {
  return (
    <div className="bg-sheet/95 px-3 py-2 sm:px-4 sm:py-3">
      <div className="text-[9px] tracking-[0.2em] text-line/70 uppercase">{label}</div>
      <div className={`mt-0.5 text-xl leading-tight tabular-nums sm:text-2xl ${VALUE_TONE[valueTone] ?? VALUE_TONE.ink}`}>
        {value}
      </div>
      {sub && <div className={`mt-0.5 truncate text-[10px] tabular-nums ${TONE[tone] ?? TONE.line}`}>{sub}</div>}
    </div>
  )
}
