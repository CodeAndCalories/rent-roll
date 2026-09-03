import { Chip, InlineLabel } from './controls.jsx'

// All components at module scope (see UnitBox.jsx for why).
//
// The banner that makes scenario mode unmistakable: sticky under the
// header, in the scenario accent, naming the scenario and saying plainly
// what it is — a snapshot from when it was made, which never touches real
// data. The name renames in place; Exit goes back to actual.

export default function ScenarioBanner({ scenario, portfolioName, onRename, onExit, onCompare, onManage }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-20 border-b-2 border-line bg-line/15 px-4 py-2 backdrop-blur sm:px-8"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
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
        <span className="min-w-0 text-[10px] leading-snug text-ink/80">
          A snapshot of {portfolioName} from {formatWhen(scenario.createdAt)}. Changes here never touch your real
          data, and changes to your real data never reach this.
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Chip onClick={onCompare} title="Actual beside every scenario">
            Compare
          </Chip>
          <Chip onClick={onManage} title="Switch, rename, or delete scenarios">
            Scenarios
          </Chip>
          <Chip active onClick={onExit} title="Back to your real data">
            Exit scenario
          </Chip>
        </div>
      </div>
    </div>
  )
}

export function formatWhen(iso) {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
