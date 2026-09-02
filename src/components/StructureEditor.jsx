import { makeFloor, makeUnit, toAmount } from '../data/schema.js'
import { Chip, TwoTapChip, cx } from './controls.jsx'

// All components at module scope (see UnitBox.jsx for why).
//
// Edits a property's floors and units so a building that is not owned yet
// can be modelled. Guards, in service of the data-safety rule:
//   * a unit can be removed only when it is empty (no rent, tenant, bills,
//     tasks, or notes), and only with a two-tap confirm
//   * a floor can be removed only when it has no units
//   * the building can be removed only when it has no units at all

export default function StructureEditor({ property, onPropertyChange, onRemoveProperty }) {
  const patch = (fn) => onPropertyChange(property.id, fn)

  const addFloor = () =>
    patch((p) => {
      const label = nextFloorLabel(p.floors)
      return {
        floors: [
          makeFloor({ label, units: [makeUnit({ name: label, position: 'full' })] }),
          ...p.floors,
        ],
      }
    })
  const setLabel = (floorId, label) =>
    patch((p) => ({ floors: p.floors.map((f) => (f.id === floorId ? { ...f, label } : f)) }))
  const addUnit = (floorId) =>
    patch((p) => ({ floors: p.floors.map((f) => (f.id === floorId ? addUnitTo(f) : f)) }))
  const removeUnit = (floorId, unitId) =>
    patch((p) => ({ floors: p.floors.map((f) => (f.id === floorId ? removeUnitFrom(f, unitId) : f)) }))
  const removeFloor = (floorId) =>
    patch((p) => ({ floors: p.floors.filter((f) => !(f.id === floorId && f.units.length === 0)) }))

  const totalUnits = property.floors.reduce((n, f) => n + f.units.length, 0)

  return (
    <div className="mt-2 border border-line/40 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] tracking-[0.2em] text-line/70 uppercase">Structure</span>
        <Chip onClick={addFloor} title="Add a floor on top">
          + Floor
        </Chip>
      </div>

      {property.floors.length === 0 && (
        <p className="mt-2 text-[10px] text-line/50">No floors. Add one to start.</p>
      )}

      {property.floors.map((f) => (
        <div key={f.id} className="mt-2 border-t border-line/20 pt-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={f.label ?? ''}
              onChange={(e) => setLabel(f.id, e.target.value)}
              aria-label="Floor label"
              placeholder="Label"
              autoComplete="off"
              className="w-16 min-w-0 border-b border-line/50 bg-transparent py-0.5 text-[11px] tracking-[0.2em] text-ink uppercase outline-none focus:border-amber"
            />
            <span className="text-[9px] tracking-widest text-line/60 uppercase">
              {f.units.length} {f.units.length === 1 ? 'unit' : 'units'}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <Chip onClick={() => addUnit(f.id)} title="Add a unit to this floor">
                + Unit
              </Chip>
              {f.units.length === 0 && (
                <TwoTapChip onConfirm={() => removeFloor(f.id)} confirmLabel="Remove floor?">
                  ✕ Floor
                </TwoTapChip>
              )}
            </div>
          </div>

          {f.units.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
              {f.units.map((u) => (
                <li key={u.id} className="flex items-center gap-1 text-[10px] text-ink">
                  <span className="tracking-[0.15em] uppercase">{u.name || 'Unit'}</span>
                  <span className="text-[8px] tracking-widest text-line/50 uppercase">{u.position}</span>
                  {isEmptyUnit(u) ? (
                    <TwoTapChip
                      onConfirm={() => removeUnit(f.id, u.id)}
                      confirmLabel="Remove?"
                      aria-label={`Remove ${u.name || 'unit'}`}
                      className="min-h-6 px-1.5 py-0"
                    >
                      ✕
                    </TwoTapChip>
                  ) : (
                    <span
                      className={cx('text-[8px] text-line/40')}
                      title="Has rent, a tenant, bills, list items, or notes. Clear it in the unit panel before removing."
                    >
                      ● has data
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {totalUnits === 0 && (
        <div className="mt-3 border-t border-line/20 pt-2">
          <TwoTapChip onConfirm={() => onRemoveProperty(property.id)} confirmLabel="Remove building?">
            ✕ Remove building
          </TwoTapChip>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// pure helpers (exported for tests)
// ---------------------------------------------------------------------------

/** "3F" on top -> "4F"; otherwise count + "F". */
export function nextFloorLabel(floors) {
  const top = floors[0]?.label ?? ''
  const m = /^(\d+)F$/i.exec(top.trim())
  if (m) return `${Number(m[1]) + 1}F`
  return `${floors.length + 1}F`
}

/**
 * Append a unit. Main units are laid out full / left+right / equal shares,
 * so positions of the existing main unit are adjusted when a second one
 * arrives. Side units are never touched.
 */
export function addUnitTo(floor) {
  const main = floor.units.filter((u) => u.position !== 'side')
  const label = floor.label || 'Unit'
  let units = floor.units
  let position = 'full'
  if (main.length === 1) {
    units = units.map((u) => (u.id === main[0].id ? { ...u, position: 'left' } : u))
    position = 'right'
  }
  const name = main.length === 0 ? label : `${label} ${main.length + 1}`
  return { ...floor, units: [...units, makeUnit({ name, position })] }
}

/** Remove one unit by id; a lone remaining main unit becomes 'full'. */
export function removeUnitFrom(floor, unitId) {
  const units = floor.units.filter((u) => u.id !== unitId)
  const main = units.filter((u) => u.position !== 'side')
  if (main.length === 1 && main[0].position !== 'full') {
    return { ...floor, units: units.map((u) => (u.id === main[0].id ? { ...u, position: 'full' } : u)) }
  }
  return { ...floor, units }
}

/** True when nothing of value is stored on the unit. */
export function isEmptyUnit(u) {
  return (
    toAmount(u.rent) === 0 &&
    toAmount(u.splitRent) === 0 &&
    !(u.tenant && String(u.tenant).trim()) &&
    !(u.bills && u.bills.length) &&
    !(u.tasks && u.tasks.length) &&
    !(u.notes && u.notes.length)
  )
}
