import { useState } from 'react'
import Building, { BuildingCaption, figureWidthFor } from './Building.jsx'
import { Chip } from './controls.jsx'

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
 * The drawing sheet: the given properties side by side on one grade line,
 * with a caption strip under the ground for names and controls. Sized to its
 * content and at least the viewport width; the parent scrolls it
 * horizontally on narrow screens.
 *
 * readOnly (print view): no captions, no add button, no inputs.
 * With no properties at all the sheet shows the first-run empty state.
 *
 * One building at a time can be in Build mode (the handles drawn on the
 * figure). Which one is UI state and is never stored.
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
  structure = {},
  rentScale = 0,
  readOnly = false,
}) {
  const [buildId, setBuildId] = useState(null)
  const list = Array.isArray(properties) ? properties : []

  if (list.length === 0 && !readOnly) {
    return <EmptyState onAddProperty={onAddProperty} />
  }

  return (
    <div className="relative w-max min-w-full">
      {/* figures, feet on the grade line; side margins leave room for floor markers */}
      <div className="mx-auto w-max pt-12" style={{ paddingLeft: SHEET_PAD_X, paddingRight: SHEET_PAD_X }}>
        <div className="flex items-end" style={{ gap: BUILDING_GAP }}>
          {list.length === 0 && <NoBuildings />}
          {list.map((p) => (
            <Building
              key={p.id}
              property={p}
              onUnitChange={onUnitChange}
              onOpenUnit={onOpenUnit}
              build={buildId === p.id}
              structure={structure}
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
            {list.map((p) => (
              <BuildingCaption
                key={p.id}
                property={p}
                width={figureWidthFor(p)}
                build={buildId === p.id}
                onToggleBuild={() => setBuildId((cur) => (cur === p.id ? null : p.id))}
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

/** Dashed ghost footprint at the end of the row for adding a building. */
function AddBuilding({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-28 shrink-0 items-center justify-center border border-dashed border-line/40 text-[10px] tracking-[0.2em] text-line/60 uppercase hover:border-amber hover:text-amber"
      style={{ width: ADD_W }}
      title="Add a building"
    >
      + Building
    </button>
  )
}

/** First run: nothing on the sheet yet. Fits a phone without scrolling. */
function EmptyState({ onAddProperty }) {
  return (
    <div className="min-w-full">
      <div className="mx-auto max-w-sm px-6 pt-16 pb-10 text-center">
        <p className="font-display text-sm tracking-[0.25em] text-ink uppercase">Nothing on the sheet yet</p>
        <p className="mt-3 text-xs leading-relaxed text-line/70">
          Rent Roll draws each building as a blueprint elevation with a rent box on every unit, and keeps
          the totals live as you type. Everything stays in this browser.
        </p>
        <Chip active onClick={onAddProperty} className="mt-5 min-h-10 px-4">
          + Add building
        </Chip>
      </div>
      <GradeLine />
      <div className="h-6" />
    </div>
  )
}

/** Print view with an empty portfolio. */
function NoBuildings() {
  return (
    <div
      className="flex h-28 items-center justify-center border border-dashed border-line/30 px-4 text-center text-[10px] tracking-[0.2em] text-line/60 uppercase"
      style={{ width: ADD_W }}
    >
      No buildings
    </div>
  )
}
