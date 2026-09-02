import Building, { BuildingCaption, figureWidthFor } from './Building.jsx'

// All components at module scope (see UnitBox.jsx for why).

const BUILDING_GAP = 64
const ADD_W = 160
const GRADE_LINE = 2
const GRADE_HATCH_H = 22

/**
 * The drawing sheet: every property side by side on one grade line, with a
 * caption strip under the ground for names and controls. Sized to its
 * content and at least the viewport width; the parent scrolls it
 * horizontally on narrow screens.
 */
export default function Elevation({
  properties,
  onUnitChange,
  onPropertyChange,
  onOpenUnit,
  onAddProperty,
  onRemoveProperty,
  onSetPhoto,
  onNotice,
}) {
  return (
    <div className="relative w-max min-w-full">
      {/* figures, feet on the grade line; side margins leave room for floor markers */}
      <div className="mx-auto w-max px-20 pt-12">
        <div className="flex items-end" style={{ gap: BUILDING_GAP }}>
          {properties.map((p) => (
            <Building key={p.id} property={p} onUnitChange={onUnitChange} onOpenUnit={onOpenUnit} />
          ))}
          <AddBuilding onClick={onAddProperty} />
        </div>
      </div>

      <GradeLine />

      {/* captions, one per figure, same widths so they line up */}
      <div className="mx-auto w-max px-20 pb-6">
        <div className="flex items-start" style={{ gap: BUILDING_GAP }}>
          {properties.map((p) => (
            <BuildingCaption
              key={p.id}
              property={p}
              width={figureWidthFor(p)}
              onPropertyChange={onPropertyChange}
              onRemoveProperty={onRemoveProperty}
              onSetPhoto={onSetPhoto}
              onNotice={onNotice}
            />
          ))}
          <div style={{ width: ADD_W }} aria-hidden />
        </div>
      </div>
    </div>
  )
}

/** Ground: a heavy line across the whole sheet with 45° earth hatching below. */
function GradeLine() {
  return (
    <div aria-hidden className="relative">
      <span className="absolute -top-4 left-3 text-[9px] tracking-[0.3em] text-line/60 uppercase">
        Grade
      </span>
      <div className="border-line" style={{ borderTopWidth: GRADE_LINE }} />
      <div className="hatch-grade" style={{ height: GRADE_HATCH_H }} />
    </div>
  )
}

/** Dashed ghost footprint at the end of the row for modelling a new building. */
function AddBuilding({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-28 shrink-0 items-center justify-center border border-dashed border-line/40 text-[10px] tracking-[0.2em] text-line/60 uppercase hover:border-amber hover:text-amber"
      style={{ width: ADD_W }}
      title="Add a building to model"
    >
      + Building
    </button>
  )
}
