import { useState } from 'react'
import { SCENARIO_CAP, SCENARIO_CAP_REASON, countScenario } from '../data/scenarios.js'
import { formatWhen } from './ScenarioBanner.jsx'
import { Chip, InlineLabel, Sheet, TwoTapChip } from './controls.jsx'

// All components at module scope (see UnitBox.jsx for why).
//
// The Scenarios sheet: the active portfolio's scenarios, "+ New scenario"
// (a fork from actual, named first), open / rename / delete, and Compare.
// Delete is two taps and names what goes. The cap and its reason are
// shown when it is hit.

/**
 * props
 *   scenarios      the active portfolio's scenarios, in stored order
 *   portfolioName  the portfolio a fork copies
 *   currentId      the scenario the sheet is in, or null
 *   describe       (id) => { text } from ops.describeScenario, for the delete confirm
 *   onCreate       (name) => void     fork from actual (App checks storage first)
 *   onOpen         (id) => void       enter scenario mode
 *   onRename       (id, name) => void
 *   onDelete       (id) => void
 *   onCompare      () => void
 *   onClose        () => void
 */
export default function ScenariosSheet({
  scenarios,
  portfolioName,
  currentId,
  describe,
  onCreate,
  onOpen,
  onRename,
  onDelete,
  onCompare,
  onClose,
}) {
  const [name, setName] = useState('')
  const full = scenarios.length >= SCENARIO_CAP
  const ready = name.trim().length > 0 && !full

  const submit = (e) => {
    e.preventDefault()
    if (!ready) return
    onCreate(name.trim())
    setName('')
  }

  return (
    <Sheet
      title="Scenarios"
      onClose={onClose}
      footer={
        <>
          {scenarios.length > 0 && <Chip onClick={onCompare}>Compare</Chip>}
          <Chip onClick={onClose}>Close</Chip>
        </>
      }
    >
      <div className="space-y-5">
        <p className="text-[10px] leading-relaxed text-line/60">
          A scenario is a copy of {portfolioName} from the moment you make it — every building with its
          floors, units, rents, statuses, widths, splits, and bills. From then on it is independent: changes
          in it never touch your real data, and changes to your real data never reach it. Photos, payments,
          tenants, lease dates, list items, and notes are not copied.
        </p>

        <form onSubmit={submit} className="space-y-2">
          <h3 className="text-[9px] tracking-[0.2em] text-line/70 uppercase">New scenario</h3>
          <div className="flex items-end gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name it (3% raise, split the 1F…)"
              aria-label="New scenario name"
              autoComplete="off"
              enterKeyHint="done"
              disabled={full}
              className="min-w-0 flex-1 border-b border-line/50 bg-transparent py-1 text-base text-ink outline-none placeholder:text-line/30 focus:border-amber disabled:opacity-40"
            />
            <Chip type="submit" active={ready} disabled={!ready} title="Copy the real buildings into a new scenario">
              + Fork from actual
            </Chip>
          </div>
          {full ? (
            <p className="text-[10px] leading-relaxed text-alert">
              No room for another — {SCENARIO_CAP_REASON} Delete one you are done with first.
            </p>
          ) : (
            <p className="text-[10px] text-line/50">
              {scenarios.length} of {SCENARIO_CAP}. A fork copies your real data as it is right now.
            </p>
          )}
        </form>

        <section>
          <h3 className="mb-1 text-[9px] tracking-[0.2em] text-line/70 uppercase">Saved</h3>
          {scenarios.length === 0 && (
            <p className="py-2 text-xs text-line/50">No scenarios yet for {portfolioName}.</p>
          )}
          <ul className="divide-y divide-line/20 border-t border-line/40">
            {scenarios.map((s) => {
              const c = countScenario(s)
              const current = s.id === currentId
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <div className="min-w-0 flex-1">
                    <InlineLabel
                      value={s.name}
                      onCommit={(n) => onRename(s.id, n)}
                      placeholder="Scenario"
                      ariaLabel={`Rename ${s.name || 'scenario'}`}
                      className="text-sm text-ink"
                      inputClassName="w-full text-base sm:text-sm"
                    />
                    <div className="text-[9px] tracking-widest text-line/60 uppercase">
                      {c.buildings} {c.buildings === 1 ? 'bldg' : 'bldgs'} · {c.units} units · from{' '}
                      {formatWhen(s.createdAt)}
                      {current && <span className="text-amber"> · open now</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip active={current} onClick={() => onOpen(s.id)} title="Edit this scenario on the sheet">
                      {current ? 'Open now' : 'Open'}
                    </Chip>
                    <TwoTapChip
                      onConfirm={() => onDelete(s.id)}
                      confirmLabel="Delete?"
                      detail={describe(s.id).text}
                      aria-label={`Delete ${s.name || 'scenario'}`}
                      title="Delete this scenario (two taps)"
                    >
                      ✕
                    </TwoTapChip>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </Sheet>
  )
}
