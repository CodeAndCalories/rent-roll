// Which buildings the sheet draws. UI state only, never stored.
// Totals always cover the whole portfolio; this only filters the drawing.

/** Above this many buildings the sheet defaults to one at a time. */
export const SIDE_BY_SIDE_MAX = 3

export const ALL = 'all'

/** Default view: side by side for a few buildings, one at a time for many. */
export function defaultSelection(properties) {
  const list = Array.isArray(properties) ? properties : []
  return list.length > SIDE_BY_SIDE_MAX && list[0] ? list[0].id : ALL
}

/**
 * Turn a remembered choice into a valid one for the current list: 'all'
 * stays, an existing id stays, anything else falls back to the default.
 */
export function resolveSelection(properties, selected) {
  if (selected === ALL) return ALL
  const list = Array.isArray(properties) ? properties : []
  if (selected && list.some((p) => p.id === selected)) return selected
  return defaultSelection(list)
}

/** The properties to draw for a selection. */
export function displayedProperties(properties, selection) {
  const list = Array.isArray(properties) ? properties : []
  if (selection === ALL) return list
  return list.filter((p) => p.id === selection)
}

/**
 * Which building is in Build mode (Elevation's state, never stored): the
 * one asked for while it is on the sheet; when the sheet shows a single
 * OTHER building instead — the picker switched — that one, so Build stays
 * on across a switch. Off when nothing was asked for, or when several
 * buildings are drawn and the asked-for one is not among them.
 */
export function buildTarget(buildId, displayed) {
  if (buildId == null) return null
  const list = Array.isArray(displayed) ? displayed : []
  if (list.some((p) => p.id === buildId)) return buildId
  return list.length === 1 ? list[0].id : null
}
