import { useEffect } from 'react'
import { formatDollars, toAmount } from '../data/schema.js'
import Elevation, { sheetContentWidth } from './Elevation.jsx'
import { billMonthly, computeTotals, unitMonthly } from './TitleBlock.jsx'
import { Chip } from './controls.jsx'

// All components at module scope (see UnitBox.jsx for why).
//
// Print / Save-as-PDF view: white paper, the elevation (read-only) on top,
// then a rent roll table, an expenses table, and a summary. The theme
// colours are re-pointed to dark-on-light by overriding the CSS variables
// on the wrapper, so the same Building/UnitBox components print cleanly.

const PRINT_PAGE_W = 720 // usable px across Letter/A4 at 96dpi with 12mm margins

const PAPER = {
  colorScheme: 'light',
  '--color-sheet': '#ffffff',
  '--color-line': '#2b4a5c',
  '--color-ink': '#0b1a26',
  '--color-amber': '#8a5a00',
  '--color-alert': '#a8321e',
}

const STATUS_LABEL = { leased: 'Leased', vacant: 'Vacant', renovating: 'Renovating' }

export default function PrintView({ state, onBack, portfolioName = '' }) {
  const properties = Array.isArray(state.properties) ? state.properties : []
  const totals = computeTotals(properties)
  const today = new Date().toISOString().slice(0, 10)
  const zoom = Math.min(1, PRINT_PAGE_W / Math.max(1, sheetContentWidth(properties, { readOnly: true })))
  const rows = unitRows(properties)
  const bills = billRows(properties)
  const names = properties.map((p) => p.name || 'Building').join(' & ') || 'No buildings'

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack])

  return (
    <div className="min-h-dvh bg-white font-mono text-[#0b1a26]" style={PAPER}>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line/30 bg-white/95 px-4 py-2 backdrop-blur print:hidden sm:px-8">
        <Chip onClick={onBack} className="min-h-10">
          ← Back
        </Chip>
        <Chip active onClick={() => window.print()} className="min-h-10">
          Print / Save as PDF
        </Chip>
        <span className="text-[9px] tracking-widest text-line/70 uppercase">
          In the print dialog choose “Save as PDF” as the destination
        </span>
      </div>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-8">
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b-2 border-line pb-2">
          <h1 className="font-display text-lg tracking-[0.3em] uppercase">Rent Roll</h1>
          <div className="text-[10px] tracking-[0.2em] text-line uppercase">
            {portfolioName ? portfolioName + ' · ' : ''}
            {names} · as of {today}
          </div>
        </header>

        <section
          className="print-fit mt-4 overflow-x-auto border border-line/30 bg-blueprint-grid"
          style={{ '--print-zoom': zoom }}
          aria-label="Elevation"
        >
          <Elevation properties={properties} readOnly rentScale={totals.maxRent} />
        </section>

        <Section title="Units">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-line text-left text-[9px] tracking-[0.2em] text-line uppercase">
                  <Th>Building</Th>
                  <Th>Floor</Th>
                  <Th>Unit</Th>
                  <Th>Status</Th>
                  <Th>Tenant</Th>
                  <Th>Lease end</Th>
                  <Th right>Rent / mo</Th>
                  <Th right>Collected</Th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-3 text-center text-line/60">
                      No units
                    </td>
                  </tr>
                )}
                {rows.map((r) =>
                  r.kind === 'subtotal' ? (
                    <tr key={r.key} className="border-t border-line/60 bg-line/5 font-medium [break-inside:avoid]">
                      <td colSpan={6} className="px-2 py-1.5 text-[9px] tracking-[0.2em] uppercase">
                        {r.building} subtotal · {r.leased}/{r.units} leased
                      </td>
                      <Td right>{formatDollars(r.rent)}</Td>
                      <Td right>{formatDollars(r.collected)}</Td>
                    </tr>
                  ) : (
                    <tr key={r.key} className="border-t border-line/20 [break-inside:avoid]">
                      <Td>{r.building}</Td>
                      <Td>{r.floor}</Td>
                      <Td>
                        {r.unit}
                        {r.splitNote && <span className="block text-[9px] text-line/70">{r.splitNote}</span>}
                      </Td>
                      <Td>{r.status}</Td>
                      <Td>{r.tenant}</Td>
                      <Td>{r.leaseEnd}</Td>
                      <Td right>{r.rent > 0 ? formatDollars(r.rent) : '—'}</Td>
                      <Td right>{r.collected > 0 ? formatDollars(r.collected) : '—'}</Td>
                    </tr>
                  ),
                )}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-line font-medium">
                    <td colSpan={6} className="px-2 py-2 text-[9px] tracking-[0.2em] uppercase">
                      Total · {totals.leased}/{totals.units} leased
                    </td>
                    <Td right>{formatDollars(totals.potential)}</Td>
                    <Td right>{formatDollars(totals.collected)}</Td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Section>

        <Section title="Expenses">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-line text-left text-[9px] tracking-[0.2em] text-line uppercase">
                  <Th>Building</Th>
                  <Th>Item</Th>
                  <Th>Cadence</Th>
                  <Th right>Amount</Th>
                  <Th right>Monthly</Th>
                </tr>
              </thead>
              <tbody>
                {bills.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-3 text-center text-line/60">
                      No bills entered
                    </td>
                  </tr>
                )}
                {bills.map((b) => (
                  <tr key={b.key} className="border-t border-line/20 [break-inside:avoid]">
                    <Td>{b.building}</Td>
                    <Td>{b.item}</Td>
                    <Td>{b.cadence}</Td>
                    <Td right>{formatDollars(b.amount)}</Td>
                    <Td right>{b.monthly > 0 ? formatDollars(b.monthly) : '—'}</Td>
                  </tr>
                ))}
              </tbody>
              {bills.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-line font-medium">
                    <td colSpan={4} className="px-2 py-2 text-[9px] tracking-[0.2em] uppercase">
                      Total monthly expenses
                    </td>
                    <Td right>{formatDollars(totals.bills)}</Td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Section>

        <Section title="Summary">
          <div className="grid grid-cols-2 gap-px border border-line/30 bg-line/30 sm:grid-cols-3 lg:grid-cols-6 [break-inside:avoid]">
            <Sum label="Collected / mo" value={formatDollars(totals.collected)} />
            <Sum label="Collected / yr" value={formatDollars(totals.annual)} />
            <Sum
              label="If fully leased"
              value={formatDollars(totals.potential)}
              sub={totals.vacancy > 0 ? `vacancy ${formatDollars(totals.vacancy)}` : 'no vacancy'}
            />
            <Sum label="Expenses / mo" value={formatDollars(totals.bills)} />
            <Sum label="Net / mo" value={formatDollars(totals.net)} />
            <Sum label="Net / yr" value={formatDollars(totals.annualNet)} />
          </div>
        </Section>

        <footer className="mt-6 flex flex-wrap justify-between gap-2 border-t border-line/30 pt-2 text-[9px] tracking-[0.2em] text-line uppercase">
          <span>
            Rent Roll · {properties.length} {properties.length === 1 ? 'building' : 'buildings'}
          </span>
          <span>Figures as entered by the owner · {today}</span>
        </footer>
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// rows (exported for tests)
// ---------------------------------------------------------------------------

export function unitRows(properties) {
  const rows = []
  for (const p of properties ?? []) {
    const building = p.name || 'Building'
    let rent = 0
    let collected = 0
    let units = 0
    let leased = 0
    for (const f of p.floors ?? []) {
      for (const u of f.units ?? []) {
        const m = unitMonthly(u)
        const isLeased = u.status === 'leased'
        const split = Boolean(u.splittable && u.isSplit)
        units += 1
        rent += m
        if (isLeased) {
          collected += m
          leased += 1
        }
        rows.push({
          kind: 'unit',
          key: u.id,
          building,
          floor: f.label || '—',
          unit: u.name || 'Unit',
          status: STATUS_LABEL[u.status] ?? String(u.status || '—'),
          tenant: (u.tenant && String(u.tenant).trim()) || '—',
          leaseEnd: u.leaseEnd || '—',
          rent: m,
          collected: isLeased ? m : 0,
          splitNote: split ? `split: ${formatDollars(toAmount(u.rent))} + ${formatDollars(toAmount(u.splitRent))}` : '',
        })
      }
    }
    rows.push({ kind: 'subtotal', key: `${p.id}-subtotal`, building, rent, collected, units, leased })
  }
  return rows
}

export function billRows(properties) {
  const rows = []
  for (const p of properties ?? []) {
    const building = p.name || 'Building'
    for (const b of p.bills ?? []) {
      rows.push({
        key: b.id,
        building,
        item: b.label || 'Bill',
        cadence: b.cadence || '—',
        amount: toAmount(b.amount),
        monthly: billMonthly(b),
      })
    }
    for (const f of p.floors ?? []) {
      for (const u of f.units ?? []) {
        for (const b of u.bills ?? []) {
          rows.push({
            key: b.id,
            building,
            item: `${u.name || 'Unit'} · ${b.label || 'Bill'}`,
            cadence: b.cadence || '—',
            amount: toAmount(b.amount),
            monthly: billMonthly(b),
          })
        }
      }
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// bits
// ---------------------------------------------------------------------------

function Section({ title, children }) {
  return (
    <section className="mt-6">
      <h2 className="font-display mb-2 text-[11px] tracking-[0.25em] uppercase">{title}</h2>
      {children}
    </section>
  )
}

function Th({ children, right }) {
  return <th className={`px-2 py-1.5 font-normal ${right ? 'text-right' : ''}`}>{children}</th>
}

function Td({ children, right }) {
  return <td className={`px-2 py-1.5 align-top ${right ? 'text-right tabular-nums' : ''}`}>{children}</td>
}

function Sum({ label, value, sub }) {
  return (
    <div className="bg-white px-3 py-2">
      <div className="text-[9px] tracking-[0.2em] text-line uppercase">{label}</div>
      <div className="text-lg tabular-nums">{value}</div>
      {sub && <div className="text-[9px] text-line/70">{sub}</div>}
    </div>
  )
}
