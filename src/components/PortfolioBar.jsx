import { Chip, InlineLabel, TwoTapChip } from './controls.jsx'

// All components at module scope (see UnitBox.jsx for why).

/**
 * Which portfolio the sheet and the totals are on. Sits top-left under the
 * header: add one, switch between them, rename the active one in place (the
 * same tap-to-rename as the drawing), remove it.
 *
 * `portfolios` are the summaries from lib/portfolios.js — id, name, and how
 * many buildings each holds. `removal` describes what removing the active
 * one would take with it, so the confirm can name it.
 */
export default function PortfolioBar({
  portfolios,
  activeId,
  removal,
  onSelect,
  onAdd,
  onRename,
  onRemove,
}) {
  const list = Array.isArray(portfolios) ? portfolios : []
  const active = list.find((f) => f.id === activeId) ?? list[0] ?? null
  const only = list.length <= 1

  return (
    <nav
      aria-label="Portfolios"
      className="flex flex-wrap items-center gap-1.5 border-b border-line/40 px-4 py-2 sm:px-8"
    >
      <Chip onClick={onAdd} className="min-h-10" title="Add a portfolio">
        + Portfolio
      </Chip>

      {list.map((f) =>
        f.id === active?.id ? (
          // the active one: amber outline, and its name edits in place
          <span
            key={f.id}
            aria-current="true"
            className="inline-flex min-h-10 items-center gap-1.5 border border-amber bg-amber/10 px-2.5 py-1 text-[9px] tracking-[0.18em] text-amber uppercase"
          >
            <InlineLabel
              value={f.name}
              onCommit={(name) => onRename(f.id, name)}
              placeholder="Portfolio"
              ariaLabel="Portfolio name"
              title="Tap to rename this portfolio"
              className="max-w-[50vw] text-[9px] tracking-[0.18em] uppercase"
              inputClassName="w-40 text-base sm:text-[9px]"
            />
            <span className="tabular-nums opacity-70">{f.buildings}</span>
          </span>
        ) : (
          <Chip
            key={f.id}
            onClick={() => onSelect(f.id)}
            className="min-h-10 max-w-[50vw]"
            title={`Show ${f.name || 'this portfolio'} on the sheet`}
          >
            <span className="truncate">{f.name || 'Portfolio'}</span>
            <span className="tabular-nums opacity-60">{f.buildings}</span>
          </Chip>
        ),
      )}

      {active && !only && (
        <TwoTapChip
          onConfirm={() => onRemove(active.id)}
          confirmLabel={`Remove ${active.name || 'portfolio'}?`}
          detail={removal?.text}
          className="min-h-10"
          title="Remove this portfolio"
        >
          ✕ Portfolio
        </TwoTapChip>
      )}

      {only && (
        <span className="text-[9px] tracking-[0.15em] text-line/40 uppercase">
          Last portfolio · always one
        </span>
      )}
    </nav>
  )
}
