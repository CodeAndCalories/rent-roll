import Building, { CAPTION_H } from './Building.jsx'

// All components at module scope (see UnitBox.jsx for why).

const BUILDING_GAP = 64
const GRADE_LINE = 2
const GRADE_HATCH_H = 22

/**
 * The drawing sheet: every property side by side on one grade line.
 * Sized to its content and at least the viewport width; the parent scrolls
 * it horizontally on narrow screens.
 */
export default function Elevation({ properties, onUnitChange, onPropertyChange, onOpenUnit }) {
  return (
    <div className="relative w-max min-w-full">
      {/* side margins leave room for the floor level markers */}
      <div className="mx-auto w-max px-20 pt-12">
        <div className="relative z-10 flex items-end" style={{ gap: BUILDING_GAP }}>
          {properties.map((p) => (
            <Building
              key={p.id}
              property={p}
              onUnitChange={onUnitChange}
              onPropertyChange={onPropertyChange}
              onOpenUnit={onOpenUnit}
            />
          ))}
        </div>
      </div>
      <GradeLine />
    </div>
  )
}

/** Ground: a heavy line across the whole sheet with 45° earth hatching below. */
function GradeLine() {
  return (
    <div
      aria-hidden
      className="absolute inset-x-0 z-0"
      style={{ bottom: CAPTION_H - GRADE_LINE - GRADE_HATCH_H }}
    >
      <span className="absolute -top-4 left-3 text-[9px] tracking-[0.3em] text-line/60 uppercase">
        Grade
      </span>
      <div className="border-line" style={{ borderTopWidth: GRADE_LINE }} />
      <div className="hatch-grade" style={{ height: GRADE_HATCH_H }} />
    </div>
  )
}
