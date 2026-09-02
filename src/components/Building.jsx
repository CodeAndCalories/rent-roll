import UnitBox from './UnitBox.jsx'

// All components at module scope (see UnitBox.jsx for why).

// Geometry, in px. Everything is derived from the data; nothing about the
// user's units is hardcoded here.
export const COL_W = 160 // width of one left/right unit column
export const MIN_MASS_W = 240 // a building is never narrower than this
export const FLOOR_H = 104 // one storey
export const SIDE_W = 128 // the box that hangs off the side
export const SIDE_H = 80 // shorter than a storey
export const ROOF_OVERHANG = 12
export const CAPTION_H = 76 // name + address strip under the grade line

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

// Which side a 'side' unit hangs off. Stored on the unit as `sideOf`; the
// data layer keeps it as an unknown field until it is promoted to the schema.
export function sideOf(unit) {
  return unit.sideOf === 'left' ? 'left' : 'right'
}

/**
 * One property: side boxes, roof, stacked floors, caption.
 * floors[0] is the top floor (matches the seed: 3F, 2F, Street).
 */
export default function Building({ property, onUnitChange, onPropertyChange, onOpenUnit }) {
  const { massWidth, left, right } = layoutFor(property)
  // Floor level markers go on the side with no hanging unit.
  const markerSide = left.length > 0 && right.length === 0 ? 'right' : 'left'

  return (
    <div className="flex flex-col">
      <div className="flex items-end">
        {left.map((u) => (
          <SideBox
            key={u.id}
            unit={u}
            edge="left"
            onUnitChange={onUnitChange}
            onOpenUnit={onOpenUnit}
          />
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
          <SideBox
            key={u.id}
            unit={u}
            edge="right"
            onUnitChange={onUnitChange}
            onOpenUnit={onOpenUnit}
          />
        ))}
      </div>

      <Caption property={property} onPropertyChange={onPropertyChange} />
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

const ROOF_CHOICES = ['gable', 'flat', 'mansard']

/** Name + address under the grade line, and the roof-shape control. */
function Caption({ property, onPropertyChange }) {
  return (
    <div className="flex items-start justify-between gap-3 pt-7" style={{ height: CAPTION_H }}>
      <div className="min-w-0">
        <div className="font-display truncate text-sm tracking-[0.25em] text-ink uppercase">
          {property.name || 'Property'}
        </div>
        {property.address && (
          <div className="mt-0.5 truncate text-[10px] text-line/70">{property.address}</div>
        )}
      </div>
      <label className="flex shrink-0 items-center gap-1 text-[10px] tracking-widest text-line/70 uppercase">
        Roof
        <select
          value={ROOF_CHOICES.includes(property.shape) ? property.shape : 'flat'}
          onChange={(e) => onPropertyChange(property.id, { shape: e.target.value })}
          className="border border-line/40 bg-sheet px-1.5 py-1.5 text-[10px] tracking-widest text-line uppercase"
        >
          {ROOF_CHOICES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

function cx(...parts) {
  return parts.filter(Boolean).join(' ')
}
