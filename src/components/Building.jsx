import { useState } from 'react'
import UnitBox from './UnitBox.jsx'
import PhotoBuilding, { PHOTO_MIN_W } from './PhotoBuilding.jsx'
import StructureEditor from './StructureEditor.jsx'
import { Chip, TwoTapChip, cx } from './controls.jsx'
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

const isMain = (u) => u.position !== 'side'
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

/**
 * One property's figure: the photo with boxes, or the drawing (side boxes,
 * roof, stacked floors). floors[0] is the top floor.
 */
export default function Building({ property, onUnitChange, onOpenUnit }) {
  if (isPhotoView(property)) {
    return (
      <PhotoBuilding
        property={property}
        width={figureWidthFor(property)}
        onUnitChange={onUnitChange}
        onOpenUnit={onOpenUnit}
      />
    )
  }

  const { massWidth, left, right } = layoutFor(property)
  // Floor level markers go on the side with no hanging unit.
  const markerSide = left.length > 0 && right.length === 0 ? 'right' : 'left'

  return (
    <div className="flex items-end">
      {left.map((u) => (
        <SideBox key={u.id} unit={u} edge="left" onUnitChange={onUnitChange} onOpenUnit={onOpenUnit} />
      ))}

      <div className="relative" style={{ width: massWidth }}>
        <Roof shape={property.shape} width={massWidth} />
        <div className="border-x border-b border-line bg-line/5">
          {property.floors.map((floor) => (
            <FloorRow
              key={floor.id}
              floor={floor}
              markerSide={markerSide}
              onUnitChange={onUnitChange}
              onOpenUnit={onOpenUnit}
            />
          ))}
        </div>
      </div>

      {right.map((u) => (
        <SideBox key={u.id} unit={u} edge="right" onUnitChange={onUnitChange} onOpenUnit={onOpenUnit} />
      ))}
    </div>
  )
}

function FloorRow({ floor, markerSide, onUnitChange, onOpenUnit }) {
  const units = floor.units
    .filter(isMain)
    .slice()
    .sort((a, b) => (POSITION_ORDER[a.position] ?? 1) - (POSITION_ORDER[b.position] ?? 1))

  return (
    <div className="relative flex border-t border-line" style={{ height: FLOOR_H }}>
      {/* level marker: short tick + label, outside the wall */}
      <span
        className={cx(
          'pointer-events-none absolute top-2 flex items-center gap-1 text-[9px] tracking-[0.2em] whitespace-nowrap text-line/70 uppercase',
          markerSide === 'left' ? 'right-full mr-1 flex-row' : 'left-full ml-1 flex-row-reverse',
        )}
      >
        {floor.label}
        <i className="block w-2.5 border-t border-line/60" />
      </span>
      {units.map((u) => (
        <UnitBox
          key={u.id}
          unit={u}
          variant="main"
          onChange={(patch) => onUnitChange(u.id, patch)}
          onOpen={() => onOpenUnit(u.id)}
        />
      ))}
    </div>
  )
}

/** A one-storey box hanging off the mass, bottom on grade. */
function SideBox({ unit, edge, onUnitChange, onOpenUnit }) {
  return (
    <UnitBox
      unit={unit}
      variant="side"
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
 * cycle, drawing/photo toggle, photo upload/remove, and the structure editor.
 */
export function BuildingCaption({
  property,
  width,
  onPropertyChange,
  onRemoveProperty,
  onSetPhoto,
  onNotice,
}) {
  const [editing, setEditing] = useState(false)
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

        <Chip active={editing} onClick={() => setEditing((v) => !v)} title="Add or remove floors and units">
          {editing ? 'Done' : 'Edit'}
        </Chip>
      </div>

      {editing && (
        <StructureEditor
          property={property}
          onPropertyChange={onPropertyChange}
          onRemoveProperty={onRemoveProperty}
        />
      )}
    </div>
  )
}
