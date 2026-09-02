import { useRef, useState } from 'react'
import { RentBar, RentInput, RentText, StatusDot, StatusMark } from './UnitBox.jsx'
import { cx } from './controls.jsx'

// All components at module scope (see UnitBox.jsx for why).
//
// Photo mode: the building is its photo, with a translucent box per unit
// laid over it. Boxes are dragged and resized with Pointer Events, which
// cover mouse, touch, and pen in one code path. Positions are stored on the
// unit as `photoBox` = { x, y, w, h } fractions of the photo, so they survive
// any change of on-screen size.

export const PHOTO_MIN_W = 480
const MIN_W = 0.04
const MIN_H = 0.04
const NEXT_STATUS = { leased: 'vacant', vacant: 'renovating', renovating: 'leased' }

export default function PhotoBuilding({
  property,
  width,
  onUnitChange,
  onOpenUnit,
  rentScale = 0,
  readOnly = false,
}) {
  const containerRef = useRef(null)
  const [measured, setMeasured] = useState(null)
  const [broken, setBroken] = useState(false)
  const size = validSize(property.photoSize) ?? measured
  const ratio = size ? size.h / size.w : 2 / 3
  const height = Math.round(width * ratio)
  const defaults = defaultBoxes(property)
  const units = property.floors.flatMap((f) => f.units)

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden border border-line/70 bg-sheet select-none"
      style={{ width, height }}
    >
      <img
        src={property.photo}
        alt={`${property.name || 'Building'} photo`}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        onError={() => setBroken(true)}
        onLoad={(e) => {
          if (!validSize(property.photoSize)) {
            setMeasured({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
          }
        }}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      />

      {broken && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 text-center text-[10px] tracking-widest text-alert uppercase">
          Photo could not be displayed. Switch to Drawing, or replace the photo.
        </div>
      )}

      {units.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[9px] tracking-widest text-line/70 uppercase">
          No units{readOnly ? '' : ' · add them on the drawing'}
        </div>
      )}

      {units.map((u) => (
        <PhotoUnitBox
          key={u.id}
          unit={u}
          box={validBox(u.photoBox) ?? defaults.get(u.id)}
          containerRef={containerRef}
          rentScale={rentScale}
          readOnly={readOnly}
          onChange={(patch) => onUnitChange(u.id, patch)}
          onOpen={() => onOpenUnit(u.id)}
        />
      ))}
    </div>
  )
}

/** One draggable, resizable box. The label opens the panel; the rest drags. */
function PhotoUnitBox({ unit, box, containerRef, rentScale, readOnly, onChange, onOpen }) {
  const [live, setLive] = useState(null) // box during a gesture
  const gesture = useRef(null)
  const b = live ?? box
  const vacant = unit.status === 'vacant'
  const label = unit.name || 'Unit'

  const begin = (mode) => (e) => {
    if (readOnly) return
    if (mode === 'move' && e.target.closest('button, input, select, label, textarea')) return
    if (e.button != null && e.button !== 0) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // capture is best-effort; move/up still bubble here from the child
    }
    gesture.current = { mode, id: e.pointerId, x0: e.clientX, y0: e.clientY, start: box, last: box, rect }
    setLive(box)
  }

  const move = (e) => {
    const g = gesture.current
    if (!g || e.pointerId !== g.id) return
    const dx = (e.clientX - g.x0) / g.rect.width
    const dy = (e.clientY - g.y0) / g.rect.height
    const next =
      g.mode === 'move'
        ? clampBox({ ...g.start, x: g.start.x + dx, y: g.start.y + dy })
        : clampBox({ ...g.start, w: g.start.w + dx, h: g.start.h + dy })
    g.last = next
    setLive(next)
  }

  const end = (e) => {
    const g = gesture.current
    if (!g || e.pointerId !== g.id) return
    gesture.current = null
    setLive(null)
    if (g.last !== g.start) onChange({ photoBox: g.last })
  }

  const handlers = readOnly
    ? {}
    : { onPointerDown: begin('move'), onPointerMove: move, onPointerUp: end, onPointerCancel: end }

  return (
    <div
      role="group"
      aria-label={`${label} box`}
      {...handlers}
      className={cx(
        'absolute flex flex-col overflow-hidden border backdrop-blur-[1px]',
        !readOnly && 'cursor-move',
        vacant ? 'border-alert bg-sheet/40' : 'border-line bg-sheet/45',
        live && 'ring-1 ring-amber',
      )}
      style={{
        left: pct(b.x),
        top: pct(b.y),
        width: pct(b.w),
        height: pct(b.h),
        touchAction: readOnly ? 'auto' : 'none',
      }}
    >
      {vacant && <div aria-hidden className="hatch-45 pointer-events-none absolute inset-0" />}

      <div className="relative flex items-start justify-between gap-1 px-1 pt-0.5">
        {readOnly ? (
          <span className="min-w-0 truncate text-[9px] leading-tight tracking-[0.15em] text-ink uppercase">{label}</span>
        ) : (
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 truncate text-[9px] leading-tight tracking-[0.15em] text-ink uppercase hover:text-amber"
            title="Open unit"
          >
            {label}
          </button>
        )}
        {readOnly ? (
          <StatusMark status={unit.status} />
        ) : (
          <StatusDot
            status={unit.status}
            onClick={() => onChange({ status: NEXT_STATUS[unit.status] ?? 'leased' })}
          />
        )}
      </div>

      <div className="relative mt-auto flex px-1 pb-1.5">
        {readOnly ? (
          <RentText compact value={unit.rent} />
        ) : (
          <RentInput
            compact
            value={unit.rent}
            onCommit={(rent) => onChange({ rent })}
            ariaLabel={`${label} rent`}
          />
        )}
      </div>

      <RentBar unit={unit} scale={rentScale} />

      {!readOnly && (
        <div
          onPointerDown={begin('resize')}
          role="button"
          aria-label={`Resize ${label} box`}
          className="absolute right-0 bottom-0 h-4 w-4 cursor-nwse-resize border-t border-l border-line bg-sheet/70"
          style={{ touchAction: 'none' }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// geometry helpers (exported for tests)
// ---------------------------------------------------------------------------

export function clampBox(box) {
  const w = clamp(num(box.w, 0.2), MIN_W, 1)
  const h = clamp(num(box.h, 0.2), MIN_H, 1)
  const x = clamp(num(box.x, 0), 0, 1 - w)
  const y = clamp(num(box.y, 0), 0, 1 - h)
  return { x: round4(x), y: round4(y), w: round4(w), h: round4(h) }
}

export function validBox(v) {
  if (!v || typeof v !== 'object') return null
  const ok = ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(v[k]))
  if (!ok) return null
  return clampBox(v)
}

export function validSize(v) {
  if (!v || typeof v !== 'object') return null
  return Number.isFinite(v.w) && Number.isFinite(v.h) && v.w > 0 && v.h > 0 ? { w: v.w, h: v.h } : null
}

/**
 * Starting positions for units that have never been placed: each floor gets
 * a horizontal band (top floor at top), main units share the band, side
 * units sit low on their side. The user drags from there.
 */
export function defaultBoxes(property) {
  const floors = property.floors ?? []
  const n = Math.max(1, floors.length)
  const top = 0.12
  const bottom = 0.92
  const bandH = (bottom - top) / n
  const left = 0.18
  const right = 0.82
  const out = new Map()

  floors.forEach((f, fi) => {
    const main = f.units.filter((u) => u.position !== 'side')
    const side = f.units.filter((u) => u.position === 'side')
    const y = top + fi * bandH
    const h = bandH * 0.8

    main.forEach((u, i) => {
      const w = (right - left) / main.length
      out.set(u.id, clampBox({ x: left + i * w + w * 0.1, y, w: w * 0.8, h }))
    })
    side.forEach((u, i) => {
      const onLeft = u.sideOf === 'left'
      out.set(
        u.id,
        clampBox({ x: onLeft ? 0.02 + i * 0.02 : 0.84 - i * 0.02, y: bottom - h, w: 0.14, h }),
      )
    })
  })
  return out
}

function pct(v) {
  return `${v * 100}%`
}
function num(v, fallback) {
  return Number.isFinite(v) ? v : fallback
}
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}
function round4(v) {
  return Math.round(v * 10000) / 10000
}
