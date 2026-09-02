import { Fragment, useRef, useState } from 'react'
import UnitBox from './UnitBox.jsx'
import PhotoBuilding, { PHOTO_MIN_W } from './PhotoBuilding.jsx'
import { Chip, InlineLabel, TwoTapChip, cx } from './controls.jsx'
import { countUnits } from '../data/ops.js'
import { equalizePair, growOf, isMainUnit, resizePair } from '../lib/widths.js'
import { PHOTO_MAX_WIDTH, resizeImageFile } from '../lib/image.js'

// All components at module scope (see UnitBox.jsx for why).

// Geometry, in px. Everything is derived from the data; nothing about the
// user's units is hardcoded here.
export const COL_W = 160 // width of one left/right unit column
export const MIN_MASS_W = 240 // a building is never narrower than this
export const FLOOR_H = 104 // one storey
export const SIDE_W = 128 // the box that hangs off the side
export const SIDE_H = 80 // shorter than a storey
export const ROOF_OVERHANG = 12
export const ROOF_CYCLE = ['gable', 'flat', 'mansard']

// Build handles. The unit tab sits inside the mass and the annex tab is
// absolutely positioned beside it, so turning Build on never changes the
// figure's width and captions stay lined up under their buildings.
const UNIT_TAB_W = 26
const ANNEX_TAB_W = 56
// A second tap on a width handle within this long resets the pair to equal.
const DOUBLE_TAP_MS = 350

const isMain = isMainUnit
const POSITION_ORDER = { left: 0, full: 1, right: 2 }

/** Layout facts other components need (Elevation uses these for spacing). */
export function layoutFor(property) {
  const floors = Array.isArray(property.floors) ? property.floors : []
  const cols = Math.max(1, ...floors.map((f) => f.units.filter(isMain).length))
  const massWidth = Math.max(MIN_MASS_W, cols * COL_W)
  const sideUnits = floors.flatMap((f) => f.units.filter((u) => u.position === 'side'))
  const left = sideUnits.filter((u) => sideOf(u) === 'left')
  const right = sideUnits.filter((u) => sideOf(u) === 'right')
  return {
    cols,
    massWidth,
    left,
    right,
    totalWidth: massWidth + (left.length + right.length) * SIDE_W,
  }
}

/** Which side a 'side' unit hangs off. */
export function sideOf(unit) {
  return unit.sideOf === 'left' ? 'left' : 'right'
}

export function hasPhoto(property) {
  return typeof property.photo === 'string' && property.photo.startsWith('data:image/')
}

export function isPhotoView(property) {
  return property.view === 'photo' && hasPhoto(property)
}

/** On-sheet width of the figure, whichever mode it is drawn in. */
export function figureWidthFor(property) {
  const layout = layoutFor(property)
  return isPhotoView(property) ? Math.max(layout.totalWidth, PHOTO_MIN_W) : layout.totalWidth
}

export function nextShape(shape) {
  const i = ROOF_CYCLE.indexOf(shape)
  return ROOF_CYCLE[(i + 1) % ROOF_CYCLE.length]
}

/** The bottom floor is where a side annex is allowed to hang. */
export function bottomFloorOf(property) {
  const floors = Array.isArray(property.floors) ? property.floors : []
  return floors.length ? floors[floors.length - 1] : null
}

/**
 * One property's figure: the photo with boxes, or the drawing (side boxes,
 * roof, stacked floors). floors[0] is the top floor.
 *
 * With `build` on, dashed handles are drawn on the figure: a + floor strip
 * above the roof, a + tab on each floor, a + annex tab at the outside edge of
 * the bottom floor, and a ✕ on every empty unit and empty floor. Labels
 * become editable in place. With it off the drawing is untouched.
 */
export default function Building({
  property,
  onUnitChange,
  onOpenUnit,
  rentScale = 0,
  readOnly = false,
  build = false,
  structure = {},
}) {
  if (isPhotoView(property)) {
    return (
      <PhotoBuilding
        property={property}
        width={figureWidthFor(property)}
        onUnitChange={onUnitChange}
        onOpenUnit={onOpenUnit}
        rentScale={rentScale}
        readOnly={readOnly}
      />
    )
  }

  const { massWidth, left, right } = layoutFor(property)
  // Floor level markers go on the side with no hanging unit.
  const markerSide = left.length > 0 && right.length === 0 ? 'right' : 'left'
  const boxProps = { onUnitChange, onOpenUnit, rentScale, readOnly }
  const buildOn = build && !readOnly

  // The annex tab goes on the free edge, and the annex it makes hangs there.
  const annexSide = right.length === 0 ? 'right' : 'left'
  const bottom = bottomFloorOf(property)
  const canAddAnnex = Boolean(bottom) && !(bottom.units ?? []).some((u) => u.position === 'side')

  return (
    <div className="flex items-end">
      {left.map((u) => (
        <SideBox
          key={u.id}
          unit={u}
          edge="left"
          build={buildOn}
          onRemove={() => structure.removeUnit?.(u.id)}
          {...boxProps}
        />
      ))}

      <div className="relative" style={{ width: massWidth }}>
        {buildOn && <AddFloorTab onClick={() => structure.addFloor?.(property.id)} />}
        {buildOn && canAddAnnex && (
          <AddAnnexTab side={annexSide} onClick={() => structure.addAnnex?.(property.id, annexSide)} />
        )}

        <Roof shape={property.shape} width={massWidth} />
        <div className="border-x border-b border-line bg-line/5">
          {property.floors.length === 0 && (
            <div className="flex h-16 items-center justify-center border-t border-dashed border-line/50 text-[9px] tracking-widest text-line/50 uppercase">
              No floors{readOnly ? '' : buildOn ? ' · use + floor' : ' · tap Build'}
            </div>
          )}
          {property.floors.map((floor) => (
            <FloorRow
              key={floor.id}
              floor={floor}
              propertyId={property.id}
              markerSide={markerSide}
              build={buildOn}
              structure={structure}
              {...boxProps}
            />
          ))}
        </div>
      </div>

      {right.map((u) => (
        <SideBox
          key={u.id}
          unit={u}
          edge="right"
          build={buildOn}
          onRemove={() => structure.removeUnit?.(u.id)}
          {...boxProps}
        />
      ))}
    </div>
  )
}

function FloorRow({
  floor,
  propertyId,
  markerSide,
  build,
  structure,
  onUnitChange,
  onOpenUnit,
  rentScale,
  readOnly,
}) {
  const areaRef = useRef(null)
  // Weights while a handle is being dragged. Preview only: the store is
  // written on release, never on every pointer move.
  const [draft, setDraft] = useState(null)

  const units = floor.units
    .filter(isMain)
    .slice()
    .sort((a, b) => (POSITION_ORDER[a.position] ?? 1) - (POSITION_ORDER[b.position] ?? 1))
  // A floor only goes when nothing at all is on it, annex included.
  const bare = floor.units.length === 0
  const shown = draft
    ? units.map((u) => (draft[u.id] != null ? { ...u, widthWeight: draft[u.id] } : u))
    : units
  const grow = growOf(shown)

  const commitWidths = (weights) => {
    setDraft(null)
    if (weights) structure.setWidths?.(propertyId, floor.id, weights)
  }

  return (
    <div className="relative flex border-t border-line" style={{ height: FLOOR_H }}>
      <FloorMarker
        floor={floor}
        side={markerSide}
        build={build}
        onRename={(label) => structure.renameFloor?.(propertyId, floor.id, label)}
      />

      {/* the units' share of the row: what a width handle measures against */}
      <div ref={areaRef} className="flex min-w-0 flex-1">
        {units.length === 0 && (
          <div className="flex flex-1 items-center justify-center gap-2 text-[9px] tracking-widest text-line/40 uppercase">
            <span>No units on this floor</span>
            {build && bare && (
              <TwoTapChip
                onConfirm={() => structure.removeFloor?.(propertyId, floor.id)}
                confirmLabel="Remove floor?"
                aria-label={`Remove floor ${floor.label || ''}`}
                className="min-h-7 px-1.5 py-0"
              >
                ✕ Floor
              </TwoTapChip>
            )}
          </div>
        )}

        {units.map((u, i) => (
          <Fragment key={u.id}>
            {build && i > 0 && (
              <WidthHandle
                units={units}
                index={i - 1}
                areaRef={areaRef}
                onPreview={setDraft}
                onCommit={commitWidths}
              />
            )}
            <UnitBox
              unit={u}
              variant="main"
              style={{ flexGrow: grow[i], flexBasis: 0 }}
              rentScale={rentScale}
              readOnly={readOnly}
              build={build}
              onRemove={() => structure.removeUnit?.(u.id)}
              onChange={(patch) => onUnitChange(u.id, patch)}
              onOpen={() => onOpenUnit(u.id)}
            />
          </Fragment>
        ))}
      </div>

      {build && (
        <AddUnitTab label={floor.label} onClick={() => structure.addUnit?.(propertyId, floor.id)} />
      )}
    </div>
  )
}

/**
 * The draggable edge between two neighbouring units: a zero-width flex item
 * sitting on the shared wall with a thumb-sized target over it, so it costs
 * the drawing no space. Pointer Events with capture keep the drag when a
 * thumb slides off the target, and `touch-action: none` stops it scrolling
 * the sheet instead. Dragging only previews; the release commits. A second
 * tap within DOUBLE_TAP_MS puts the pair back to equal halves.
 */
function WidthHandle({ units, index, areaRef, onPreview, onCommit }) {
  const gesture = useRef(null)
  const lastTap = useRef(0)
  const [live, setLive] = useState(false)
  const a = units[index]
  const b = units[index + 1]

  const begin = (e) => {
    if (e.button != null && e.button !== 0) return
    const width = areaRef.current?.getBoundingClientRect().width
    if (!width) return

    const now = Date.now()
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0
      onCommit(equalizePair(units, index))
      return
    }
    lastTap.current = now

    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // capture is best-effort; the events still arrive here
    }
    gesture.current = { id: e.pointerId, x0: e.clientX, width, last: null }
    setLive(true)
  }

  const move = (e) => {
    const g = gesture.current
    if (!g || e.pointerId !== g.id) return
    const next = resizePair(units, index, (e.clientX - g.x0) / g.width)
    if (!next) return
    g.last = next
    onPreview(next)
  }

  const end = (e) => {
    const g = gesture.current
    if (!g || e.pointerId !== g.id) return
    gesture.current = null
    setLive(false)
    if (g.last) {
      lastTap.current = 0 // a real drag is never the first of two taps
      onCommit(g.last)
    } else {
      onPreview(null)
    }
  }

  return (
    <div className="relative z-10 w-0 shrink-0">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Drag to move the wall between ${a?.name || 'unit'} and ${b?.name || 'unit'}`}
        title="Drag to move the wall · double-tap for equal halves"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="group absolute inset-y-0 left-1/2 flex w-6 -translate-x-1/2 cursor-ew-resize items-center justify-center"
        style={{ touchAction: 'none' }}
      >
        <span
          aria-hidden
          className={cx(
            'block h-10 w-[3px] rounded-full',
            live ? 'bg-amber' : 'bg-line/50 group-hover:bg-amber',
          )}
        />
      </div>
    </div>
  )
}

/** Level marker outside the wall: label and a short tick. */
function FloorMarker({ floor, side, build, onRename }) {
  return (
    <span
      className={cx(
        'absolute top-2 flex items-center gap-1 text-[9px] tracking-[0.2em] whitespace-nowrap text-line/70 uppercase',
        !build && 'pointer-events-none',
        side === 'left' ? 'right-full mr-1 flex-row' : 'left-full ml-1 flex-row-reverse',
      )}
    >
      {build ? (
        <InlineLabel
          value={floor.label}
          onCommit={onRename}
          placeholder="Floor"
          ariaLabel="Floor label"
          title="Tap to rename this floor"
          className="text-[9px] tracking-[0.2em] text-line uppercase"
          inputClassName="w-14"
        />
      ) : (
        floor.label
      )}
      <i className="block w-2.5 border-t border-line/60" />
    </span>
  )
}

/** Dashed strip above the roof: adds a floor on top. */
function AddFloorTab({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Add a floor on top"
      className="mb-1.5 flex h-7 w-full items-center justify-center border border-dashed border-line/50 text-[9px] tracking-[0.2em] text-line/70 uppercase hover:border-amber hover:bg-amber/5 hover:text-amber"
    >
      + Floor
    </button>
  )
}

/** Dashed tab on the right edge of a floor: adds a unit to that floor. */
function AddUnitTab({ label, onClick }) {
  const what = `Add a unit to ${label || 'this floor'}`
  return (
    <button
      type="button"
      onClick={onClick}
      title={what}
      aria-label={what}
      className="flex shrink-0 items-center justify-center border-l border-dashed border-line/60 text-sm text-line/70 hover:bg-amber/10 hover:text-amber"
      style={{ width: UNIT_TAB_W }}
    >
      +
    </button>
  )
}

/**
 * Dashed tab at the outside edge of the bottom floor: hangs a side annex
 * there. Absolutely positioned, so Build never nudges the figure sideways.
 */
function AddAnnexTab({ side, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Hang a side annex off the bottom floor"
      className={cx(
        'absolute bottom-0 flex items-center justify-center border border-dashed border-line/50 text-[9px] tracking-[0.16em] text-line/70 uppercase hover:border-amber hover:bg-amber/5 hover:text-amber',
        side === 'left' ? 'right-full mr-1' : 'left-full ml-1',
      )}
      style={{ width: ANNEX_TAB_W, height: SIDE_H }}
    >
      + Annex
    </button>
  )
}

/** A one-storey box hanging off the mass, bottom on grade. */
function SideBox({ unit, edge, onUnitChange, onOpenUnit, rentScale, readOnly, build, onRemove }) {
  return (
    <UnitBox
      unit={unit}
      variant="side"
      rentScale={rentScale}
      readOnly={readOnly}
      build={build}
      onRemove={onRemove}
      style={{
        width: SIDE_W,
        height: SIDE_H,
        // overlap the mass border by 1px so the walls read as one line
        marginRight: edge === 'left' ? -1 : 0,
        marginLeft: edge === 'right' ? -1 : 0,
      }}
      onChange={(patch) => onUnitChange(unit.id, patch)}
      onOpen={() => onOpenUnit(unit.id)}
      onFlip={() => onUnitChange(unit.id, { sideOf: edge === 'left' ? 'right' : 'left' })}
    />
  )
}

/**
 * Roof outline from property.shape. Drawn open at the bottom so the top
 * floor's border is the roof baseline (no doubled line).
 */
function Roof({ shape, width }) {
  const o = ROOF_OVERHANG
  const W = width
  let h
  let d
  switch (shape) {
    case 'flat':
      h = 14
      d = `M ${-o} ${h} V 0 H ${W + o} V ${h}`
      break
    case 'mansard':
      h = 52
      d = `M 0 ${h} L ${W * 0.18} 0 H ${W * 0.82} L ${W} ${h}`
      break
    case 'gable':
    default:
      h = Math.min(96, Math.round(W * 0.32))
      d = `M ${-o} ${h} L ${W / 2} 0 L ${W + o} ${h}`
      break
  }

  return (
    <svg
      aria-hidden
      className="block overflow-visible"
      width={W + 2 * o}
      height={h}
      viewBox={`${-o} 0 ${W + 2 * o} ${h}`}
      style={{ marginLeft: -o, marginRight: -o }}
    >
      <path
        d={d}
        fill="rgba(95, 182, 208, 0.05)"
        stroke="var(--color-line)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// caption: name, address, and the per-building controls
// ---------------------------------------------------------------------------

/**
 * Sits under the grade line at the same width as the figure. Holds the roof
 * cycle, drawing/photo toggle, photo upload/remove, and the Build toggle that
 * puts the handles on the drawing above it.
 */
export function BuildingCaption({
  property,
  width,
  build = false,
  onToggleBuild,
  onPropertyChange,
  onRemoveProperty,
  onSetPhoto,
  onNotice,
}) {
  const [busy, setBusy] = useState(false)
  const photo = hasPhoto(property)
  const photoView = isPhotoView(property)
  const patch = (p) => onPropertyChange(property.id, p)

  const pickFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again later
    if (!file) return
    setBusy(true)
    try {
      const result = await resizeImageFile(file, PHOTO_MAX_WIDTH)
      onSetPhoto(property.id, result)
    } catch (err) {
      onNotice({ tone: 'alert', text: `Could not use that image: ${err?.message ?? err}.` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ width }} className="pt-2">
      <input
        type="text"
        value={property.name ?? ''}
        onChange={(e) => patch({ name: e.target.value })}
        placeholder="Building name"
        aria-label="Building name"
        autoComplete="off"
        className="font-display w-full min-w-0 border-b border-transparent bg-transparent py-0.5 text-sm tracking-[0.25em] text-ink uppercase outline-none placeholder:text-line/30 focus:border-amber"
      />
      <input
        type="text"
        value={property.address ?? ''}
        onChange={(e) => patch({ address: e.target.value })}
        placeholder="Address"
        aria-label="Address"
        autoComplete="off"
        className="mt-0.5 w-full min-w-0 border-b border-transparent bg-transparent py-0.5 text-[10px] text-line/70 outline-none placeholder:text-line/30 focus:border-amber"
      />

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {!photoView && (
          <Chip onClick={() => patch({ shape: nextShape(property.shape) })} title="Cycle roof shape">
            Roof · {property.shape} ⟳
          </Chip>
        )}

        {photo && (
          <div className="inline-flex" role="group" aria-label="View mode">
            <Chip active={!photoView} onClick={() => patch({ view: 'drawing' })}>
              Drawing
            </Chip>
            <Chip active={photoView} onClick={() => patch({ view: 'photo' })} className="-ml-px">
              Photo
            </Chip>
          </div>
        )}

        <Chip as="label" className={cx(busy && 'opacity-60')} title="Pick a Street View screenshot">
          <input
            type="file"
            accept="image/*"
            onChange={pickFile}
            disabled={busy}
            aria-label={photo ? 'Replace photo' : 'Add photo'}
            className="sr-only"
          />
          {busy ? 'Resizing…' : photo ? 'Replace photo' : 'Add photo'}
        </Chip>

        {photo && (
          <TwoTapChip
            onConfirm={() => patch({ photo: null, photoSize: null, view: 'drawing' })}
            confirmLabel="Remove photo?"
            title="Removes the photo only; the drawing and box positions stay"
          >
            Remove photo
          </TwoTapChip>
        )}

        {/* Build works on the drawing, so it is hidden while the photo is shown */}
        {!photoView && (
          <Chip
            active={build}
            onClick={onToggleBuild}
            title="Add or remove floors and units on the drawing"
          >
            {build ? 'Done' : 'Build'}
          </Chip>
        )}

        {!photoView && build && countUnits(property) === 0 && (
          <TwoTapChip
            onConfirm={() => onRemoveProperty(property.id)}
            confirmLabel="Remove building?"
            title="Only an empty building can be removed"
          >
            ✕ Building
          </TwoTapChip>
        )}
      </div>

      {!photoView && build && (
        <p className="mt-1.5 text-[9px] leading-relaxed tracking-[0.12em] text-line/50 uppercase">
          Tap a label to rename · ✕ removes an empty unit or floor
        </p>
      )}
    </div>
  )
}
