import { formatDollars } from '../data/schema.js'
import { countScenario } from '../data/scenarios.js'
import { computeTotals } from '../data/totals.js'
import Elevation from './Elevation.jsx'
import { formatDelta } from './CompareView.jsx'
import { formatWhen } from './ScenarioBanner.jsx'
import { Chip, InlineLabel, Sheet, TwoTapChip, cx } from './controls.jsx'

// All components at module scope (see UnitBox.jsx for why).
//
// Side by side: the ACTIVE PORTFOLIO's real buildings in one pane and a
// scenario of it in the other, each drawn with its own totals, and a delta
// bar pinned to the bottom of the screen. Side by side from `md` up (a
// desktop, or a phone in landscape); stacked on a phone, actual on top.
//
// The ACTUAL pane is read-only by construction, not by a flag checked on
// write: ActualPane takes no callbacks at all and renders the elevation
// readOnly, so it holds no input, no button, no handle, no status toggle —
// nothing in it CAN write. The collapse control lives in the bar above,
// outside the pane. The SCENARIO pane is the full editor in the scenario
// accent; every write from it is App's `write`, which aims at the scenario
// through ops.applyTo.

/**
 * The actual side's own colours. The app root wears the scenario accent
 * while a scenario is open; this pane puts the real-data line work back.
 */
const ACTUAL_ACCENT = { '--color-line': '#5fb6d0', '--color-ink': '#a8e8f5' }

/** The actual side draws its buildings, never a photo — like for like with the scenario. Nothing is written. */
const asDrawing = (p) => (p.view === 'photo' ? { ...p, view: 'drawing' } : p)

/**
 * props
 *   actual         the active portfolio's real buildings
 *   portfolioName  for the actual pane's label
 *   scenario       the scenario on the right
 *   stale          true when actual changed since the fork, null when unknown
 *   collapsed      the actual pane shows its totals only
 *   onRename       (name) => void           renames the scenario
 *   onRefresh      () => void               re-fork from actual (two taps here)
 *   onExpenses     () => void               the scenario's expenses summary
 *   editor         props for the scenario pane's Elevation: every callback,
 *                  `structure`, and nothing else — the same editor as the sheet
 *   rentScale      shared by both panes, so the rent bars compare across them
 */
export default function SplitView({
  actual,
  portfolioName,
  scenario,
  stale = null,
  collapsed = false,
  onRename,
  onRefresh,
  onExpenses,
  editor,
  rentScale = 0,
}) {
  return (
    <div className="flex flex-1 flex-col md:flex-row md:items-stretch">
      <section
        aria-label={`Actual: ${portfolioName}, read only`}
        style={ACTUAL_ACCENT}
        className="bg-blueprint-grid @container flex min-w-0 flex-col border-b-2 border-line md:w-1/2 md:border-r-2 md:border-b-0"
      >
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-line/40 px-4 py-2">
          <span className="font-display border border-ink px-1.5 py-0.5 text-[9px] tracking-[0.3em] text-ink uppercase">
            Actual
          </span>
          <span className="font-display min-w-0 truncate text-sm tracking-[0.2em] text-ink uppercase">{portfolioName}</span>
          <span className="text-[9px] tracking-widest text-line/60 uppercase">read only · as it is now</span>
        </div>
        <ActualPane properties={actual} collapsed={collapsed} rentScale={rentScale} />
      </section>

      <section aria-label={`Scenario: ${scenario.name || 'unnamed'}, editable`} className="@container flex min-w-0 flex-col md:w-1/2">
        <ScenarioHeader scenario={scenario} stale={stale} onRename={onRename} onRefresh={onRefresh} />
        <div className="overflow-x-auto overflow-y-hidden">
          <Elevation {...editor} properties={scenario.properties} rentScale={rentScale} photos={false} />
        </div>
        <PaneTotals totals={computeTotals(scenario.properties)} onExpenses={onExpenses} />
      </section>
    </div>
  )
}

/**
 * The real buildings, drawn read-only, with their totals. No callbacks
 * in, so no way out: every unit renders as text, nothing is wired.
 * `collapsed` keeps the totals and drops the drawing, for room on a phone.
 */
export function ActualPane({ properties, collapsed = false, rentScale = 0 }) {
  const list = Array.isArray(properties) ? properties : []
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {!collapsed && (
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <Elevation properties={list.map(asDrawing)} readOnly names rentScale={rentScale} />
        </div>
      )}
      <PaneTotals totals={computeTotals(list)} />
    </div>
  )
}

/** The scenario's label, its snapshot date, the stale marker, and Refresh from actual. */
function ScenarioHeader({ scenario, stale, onRename, onRefresh }) {
  const name = scenario.name || 'this scenario'
  return (
    <div className="border-b border-line/40 bg-line/10 px-4 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-display shrink-0 border border-ink px-1.5 py-0.5 text-[9px] tracking-[0.3em] text-ink uppercase">
          Scenario
        </span>
        <InlineLabel
          value={scenario.name}
          onCommit={onRename}
          placeholder="Name this scenario"
          ariaLabel="Scenario name"
          title="Tap to rename"
          className="font-display min-w-0 text-sm tracking-[0.2em] text-ink uppercase"
          inputClassName="text-base sm:text-sm"
        />
        <span className="text-[9px] tracking-widest text-ink/70 uppercase">
          editable · a copy from {formatWhen(scenario.createdAt)}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <TwoTapChip
            onConfirm={onRefresh}
            confirmLabel="Replace it?"
            detail={`Re-forks "${name}" from your real data as it is right now. Every edit you made in this scenario is lost; only its name stays.`}
            title="Start this scenario over from your real data as it is now"
          >
            ⟳ Refresh from actual
          </TwoTapChip>
        </div>
      </div>
      {stale && (
        <p className="mt-1 text-[10px] leading-snug text-amber/80" role="status">
          ● Actual has changed since this was forked — the left side is newer.
        </p>
      )}
    </div>
  )
}

/**
 * One side's own totals, straight from computeTotals: the four figures the
 * delta bar compares, with leased count and "if fully leased" under
 * collected. With `onExpenses` the Expenses cell is a button (the scenario
 * side); without it nothing here is.
 */
export function PaneTotals({ totals: t, onExpenses }) {
  return (
    <div className="grid grid-cols-2 gap-px border-t border-line/60 bg-line/30 @md:grid-cols-4">
      <Figure
        label="Collected / mo"
        value={formatDollars(t.collected)}
        sub={`${t.leased}/${t.units} leased · full ${formatDollars(t.potential)}`}
      />
      <Figure label="Expenses / mo" value={formatDollars(t.bills)} onClick={onExpenses} />
      <Figure label="Net / mo" value={formatDollars(t.net)} alert={t.net < 0} />
      <Figure label="Net / yr" value={formatDollars(t.annualNet)} alert={t.annualNet < 0} />
    </div>
  )
}

function Figure({ label, value, sub, alert = false, onClick }) {
  const body = (
    <>
      <span className="flex items-baseline justify-between gap-1 text-[9px] tracking-[0.18em] text-line/70 uppercase">
        <span className="truncate">{label}</span>
        {onClick && <span aria-hidden>›</span>}
      </span>
      <span className={cx('block text-base leading-tight tabular-nums', alert ? 'text-alert' : 'text-ink')}>{value}</span>
      {sub && <span className="block truncate text-[9px] text-line/60 tabular-nums">{sub}</span>}
    </>
  )
  if (!onClick) return <div className="bg-sheet/95 px-3 py-1.5">{body}</div>
  return (
    <button
      type="button"
      onClick={onClick}
      title="Every bill in this scenario"
      className="w-full min-w-0 bg-sheet/95 px-3 py-1.5 text-left hover:bg-line/10"
    >
      {body}
    </button>
  )
}

const DELTA_TONE = { amber: 'text-amber', alert: 'text-alert' }

/**
 * Pinned to the bottom of the screen: scenario − actual for each of
 * DELTA_ROWS (splitDeltas), amber where the scenario is better, alert
 * where worse. Recomputed on every render, so it follows each keystroke.
 */
export function DeltaBar({ rows }) {
  return (
    <footer
      aria-label="Scenario minus actual"
      className="sticky bottom-0 z-20 border-t-2 border-line bg-sheet/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <div className="grid grid-cols-4 gap-px bg-line/40">
        {rows.map((r) => (
          <div key={r.id} className="min-w-0 bg-sheet/95 px-2 py-1.5 sm:px-4 sm:py-2">
            <div className="truncate text-[9px] tracking-[0.16em] text-line/70 uppercase">Δ {r.label}</div>
            <div className={cx('text-base leading-tight tabular-nums sm:text-xl', DELTA_TONE[r.tone] ?? 'text-line/50')}>
              {formatDelta('money', r.delta)}
            </div>
            <div className="hidden truncate text-[10px] text-line/60 tabular-nums sm:block">
              {formatDollars(r.actual)} → {formatDollars(r.scenario)}
            </div>
          </div>
        ))}
      </div>
      <div className="hidden px-4 py-1 text-[9px] tracking-[0.16em] text-line/60 uppercase sm:block">
        Scenario minus actual · <span className="text-amber">amber</span> is better ·{' '}
        <span className="text-alert">red</span> is worse
      </div>
    </footer>
  )
}

/**
 * Under the header while side by side: what this is, the collapse control
 * for the actual pane, switching the scenario, and the way out.
 */
export function SplitBar({ collapsed, onToggleCollapsed, onSwitch, onExit }) {
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b-2 border-line bg-sheet/90 px-4 py-2 backdrop-blur sm:px-8">
      <span className="font-display text-sm tracking-[0.25em] text-ink uppercase">Side by side</span>
      <span className="hidden text-[10px] text-ink/70 lg:inline">
        Actual is read only. Everything you change happens in the scenario.
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <Chip
          active={collapsed}
          aria-pressed={collapsed}
          onClick={onToggleCollapsed}
          title={collapsed ? 'Draw the actual buildings again' : 'Show only the actual totals, for room'}
        >
          {collapsed ? 'Show actual' : 'Actual: totals only'}
        </Chip>
        <Chip onClick={onSwitch} title="Put a different scenario on the scenario side, or fork a new one">
          Switch
        </Chip>
        <Chip active onClick={onExit} title="Back to your real data">
          Exit
        </Chip>
      </div>
    </div>
  )
}

/**
 * Asked when the portfolio already has scenarios: which goes beside
 * actual. "+ New fork" is first; at the cap it is disabled and says why.
 *
 * props
 *   plan           planSideBySide(...) with action 'pick'
 *   portfolioName  what a new fork copies
 *   currentId      the scenario open now, if any
 *   staleOf        (scenario) => true | false | null
 *   onNewFork      () => void
 *   onPick         (id) => void
 *   onClose        () => void
 */
export function SideBySidePicker({ plan, portfolioName, currentId, staleOf, onNewFork, onPick, onClose }) {
  const { newFork, scenarios } = plan
  return (
    <Sheet title="Side by side" onClose={onClose} footer={<Chip onClick={onClose}>Cancel</Chip>}>
      <div className="space-y-3">
        <p className="text-[10px] leading-relaxed text-line/60">
          {portfolioName} as it is now on one side, read only; a scenario on the other, yours to edit. Which
          scenario?
        </p>
        <ul className="divide-y divide-line/20 border-y border-line/40">
          <li>
            <button
              type="button"
              onClick={onNewFork}
              disabled={!newFork.ok}
              className="flex min-h-11 w-full flex-col items-start py-2 text-left hover:text-amber disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="text-sm text-amber">+ New fork</span>
              <span className="text-[9px] tracking-widest text-line/60 uppercase">
                “{newFork.name}” · a copy of {portfolioName} as it is right now
              </span>
            </button>
            {!newFork.ok && <p className="pb-2 text-[10px] leading-relaxed text-alert">No room — {newFork.reason}</p>}
          </li>
          {scenarios.map((s) => {
            const c = countScenario(s)
            const stale = staleOf(s)
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onPick(s.id)}
                  className="flex min-h-11 w-full flex-col items-start py-2 text-left hover:text-amber"
                >
                  <span className="text-sm text-ink">
                    {s.name || 'Scenario'}
                    {s.id === currentId && <span className="text-[9px] tracking-widest text-amber uppercase"> · open now</span>}
                  </span>
                  <span className="text-[9px] tracking-widest text-line/60 uppercase">
                    from {formatWhen(s.createdAt)} · {c.buildings} {c.buildings === 1 ? 'bldg' : 'bldgs'} · {c.units}{' '}
                    units
                    {stale && <span className="text-amber/80"> · actual changed since</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </Sheet>
  )
}
