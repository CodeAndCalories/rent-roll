import Building, { BuildingCaption, figureWidthFor } from './Building.jsx'

// All components at module scope (see UnitBox.jsx for why).

export const BUILDING_GAP = 64
export const ADD_W = 160
export const SHEET_PAD_X = 80
const GRADE_LINE = 2
const GRADE_HATCH_H = 22

const noop = () => {}

/** Total px width of the figures row, used by the print view to fit a page. */
export function sheetContentWidth(properties, { readOnly = false } = {}) {
  const figures = properties.reduce((w, p) => w + figureWidthFor(p), 0)
  const gaps = Math.max(0, properties.length - (readOnly ? 1 : 0)) * BUILDING_GAP
  return figures + gaps + (readOnly ? 0 : ADD_W) + SHEET_PAD_X * 2
}

/**
 * The drawing sheet: every property side by side on one grade line, with a
 * caption strip under the ground for names and controls. Sized to its
 * content and at least the viewport width; the parent scrolls it
 * horizontally on narrow screens.
 *
 * readOnly (print view): no captions, no add button, no inputs.
 */
export default function Elevation({
  properties,
  onUnitChange = noop,
  onPropertyChange = noop,
  onOpenUnit = noop,
  onAddProperty = noop,
  onRemoveProperty = noop,
  onSetPhoto = noop,
  onNotice = noop,
  rentScale = 0,
  readOnly = false,
}) {
  const list = Array.isArray(properties) ? properties : []

  return (
    <div className="relative w-max min-w-full">
      {/* figures, feet on the grade line; side margins leave room for floor markers */}
      <div className="mx-auto w-max pt-12" style={{ paddingLeft: SHEET_PAD_X, paddingRight: SHEET_PAD_X }}>
        <div className="flex items-end" style={{ gap: BUILDING_GAP }}>
          {list.length === 0 && <EmptySheet readOnly={readOnly} />}
          {list.map((p) => (
            <Building
              key={p.id}
              property={p}
              onUnitChange={onUnitChange}
              onOpenUnit={onOpenUnit}
              rentScale={rentScale}
              readOnly={readOnly}
            />
          ))}
          {!readOnly && <AddBuilding onClick={onAddProperty} />}
        </div>
      </div>

      <GradeLine />

      {/* captions, one per figure, same widths so they line up */}
      {!readOnly && (
        <div className="mx-auto w-max pb-6" style={{ paddingLeft: SHEET_PAD_X, paddingRight: SHEET_PAD_X }}>
          <div className="flex items-start" style={{ gap: BUILDING_GAP }}>
            {list.length === 0 && <div style={{ width: ADD_W }} aria-hidden />}
            {list.map((p) => (
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
      )}
      {readOnly && <div className="h-4" />}
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

/** Shown on the grade line when there are no properties at all. */
function EmptySheet({ readOnly }) {
  return (
    <div
      className="flex h-28 items-center justify-center border border-dashed border-line/30 px-4 text-center text-[10px] tracking-[0.2em] text-line/60 uppercase"
      style={{ width: ADD_W }}
    >
      {readOnly ? 'No buildings' : 'Empty sheet'}
    </div>
  )
}
