import { ALL } from '../lib/selection.js'
import { Chip } from './controls.jsx'

// All components at module scope (see UnitBox.jsx for why).

/**
 * Chips that choose which buildings the sheet draws: "All" or one of them.
 * Hidden with fewer than two buildings. Scrolls sideways on a phone.
 */
export default function BuildingPicker({ properties, selection, onSelect }) {
  if (!Array.isArray(properties) || properties.length < 2) return null
  return (
    <nav aria-label="Buildings on the sheet" className="border-b border-line/40">
      <div
        role="radiogroup"
        className="flex items-center gap-1.5 overflow-x-auto px-4 py-2 sm:px-8"
        style={{ scrollbarWidth: 'thin' }}
      >
        <Chip
          role="radio"
          aria-checked={selection === ALL}
          active={selection === ALL}
          onClick={() => onSelect(ALL)}
          className="shrink-0"
          title="Draw every building side by side"
        >
          All
          <span className="font-mono text-[9px] tracking-normal opacity-70 tabular-nums">{properties.length}</span>
        </Chip>
        {properties.map((p) => (
          <Chip
            key={p.id}
            role="radio"
            aria-checked={selection === p.id}
            active={selection === p.id}
            onClick={() => onSelect(p.id)}
            className="max-w-[60vw] shrink-0"
            title={p.name || 'Building'}
          >
            <span className="truncate">{p.name || 'Building'}</span>
          </Chip>
        ))}
      </div>
    </nav>
  )
}
