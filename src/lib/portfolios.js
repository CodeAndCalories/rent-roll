// Which portfolio the sheet and the totals are on.
//
// A portfolio holds its buildings by id (see schema.js), so everything here
// is a lookup — nothing is stored, nothing is moved. Which portfolio is
// active is UI state, like the building selection in selection.js.

/** A valid portfolio id for this state: the asked-for one, or the first. */
export function resolvePortfolioId(state, portfolioId) {
  const list = state?.portfolios ?? []
  if (portfolioId && list.some((f) => f.id === portfolioId)) return portfolioId
  return list[0]?.id ?? null
}

/** The active portfolio object (never null while a portfolio exists). */
export function activePortfolio(state, portfolioId) {
  const id = resolvePortfolioId(state, portfolioId)
  return (state?.portfolios ?? []).find((f) => f.id === id) ?? null
}

/** The buildings in one portfolio, in the order that portfolio lists them. */
export function propertiesOf(state, portfolioId) {
  const portfolio = activePortfolio(state, portfolioId)
  if (!portfolio) return []
  const byId = new Map((state?.properties ?? []).map((p) => [p.id, p]))
  return portfolio.propertyIds.map((id) => byId.get(id)).filter(Boolean)
}

/** The state as one portfolio sees it — what the print view is handed. */
export function portfolioState(state, portfolioId) {
  return { ...state, properties: propertiesOf(state, portfolioId) }
}

/** One row per portfolio for the selector: name plus what it holds. */
export function portfolioSummaries(state) {
  const properties = state?.properties ?? []
  const byId = new Map(properties.map((p) => [p.id, p]))
  return (state?.portfolios ?? []).map((f) => {
    const held = f.propertyIds.map((id) => byId.get(id)).filter(Boolean)
    return {
      id: f.id,
      name: f.name,
      buildings: held.length,
      units: held.reduce((n, p) => n + (p.floors ?? []).reduce((m, fl) => m + (fl.units?.length ?? 0), 0), 0),
    }
  })
}
