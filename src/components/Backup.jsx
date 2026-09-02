import { useState } from 'react'
import { exportJSON, importJSON, serialize } from '../data/store.js'
import { computeTotals } from './TitleBlock.jsx'
import { Chip, Sheet } from './controls.jsx'

// All components at module scope (see UnitBox.jsx for why).
//
// Backup: download the whole data set as dated JSON, or merge a JSON file
// back in. Import never replaces: it merges by id and shows what it will do
// before anything is applied.

const ENTITY_LABELS = [
  ['portfolios', 'portfolios'],
  ['properties', 'buildings'],
  ['floors', 'floors'],
  ['units', 'units'],
  ['bills', 'bills'],
  ['tasks', 'list items'],
  ['notes', 'notes'],
]

export function describeReport(report) {
  const parts = []
  for (const [key, label] of ENTITY_LABELS) {
    const r = report?.[key]
    if (!r) continue
    const bits = []
    if (r.added) bits.push(`+${r.added}`)
    if (r.updated) bits.push(`~${r.updated}`)
    if (bits.length) parts.push(`${label} ${bits.join(' ')}`)
  }
  return parts.length ? parts.join(' · ') : 'nothing new; everything in the file already matches'
}

export default function BackupSheet({ state, onImport, onNotice, onClose }) {
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState(false)
  const bytes = serialize(state).length
  const t = computeTotals(state.properties)
  const lastSaved = formatWhen(state.updatedAt)

  const doExport = () => {
    const r = exportJSON(state)
    if (r.ok) {
      onNotice({ tone: 'line', text: `Downloaded ${r.filename} (${kb(r.bytes)} KB).` })
    } else {
      onNotice({ tone: 'alert', text: `Export failed: ${r.error?.message ?? 'unknown error'}.` })
    }
  }

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const r = await importJSON(file, state)
      const incoming = computeTotals(r.state.properties)
      setPending({ ...r, fileName: file.name, incoming })
    } catch (err) {
      setPending(null)
      onNotice({ tone: 'alert', text: err?.message ?? String(err) })
    } finally {
      setBusy(false)
    }
  }

  const apply = () => {
    onImport(pending.state, pending.report)
    setPending(null)
    onClose()
  }

  return (
    <Sheet
      title="Backup"
      onClose={onClose}
      footer={
        pending ? (
          <>
            <Chip onClick={() => setPending(null)}>Cancel</Chip>
            <Chip active onClick={apply} className="min-h-10">
              Apply import
            </Chip>
          </>
        ) : (
          <Chip onClick={onClose}>Close</Chip>
        )
      }
    >
      <div className="space-y-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <Stat label="Buildings" value={t.properties} />
          <Stat label="Units" value={t.units} />
          <Stat label="Bills" value={t.billCount} />
          <Stat label="Data set" value={`${kb(bytes)} KB`} />
          <Stat label="Last saved" value={lastSaved} className="col-span-2" />
        </dl>

        <section className="space-y-2">
          <h3 className="text-[9px] tracking-[0.2em] text-line/70 uppercase">Export</h3>
          <Chip active onClick={doExport} className="min-h-10">
            Download JSON
          </Chip>
          <p className="text-[10px] text-line/60">
            Saves <span className="text-ink">rent-roll-{today()}.json</span> with every portfolio, not
            just the one on screen — photos included. Keep it somewhere safe; localStorage is per browser.
          </p>
        </section>

        <section className="space-y-2">
          <h3 className="text-[9px] tracking-[0.2em] text-line/70 uppercase">Import</h3>
          <Chip as="label" className="min-h-10">
            <input
              type="file"
              accept="application/json,.json"
              onChange={pick}
              disabled={busy}
              aria-label="Choose a JSON backup to import"
              className="sr-only"
            />
            {busy ? 'Reading…' : 'Choose a backup file…'}
          </Chip>
          <p className="text-[10px] text-line/60">
            Merges by id: units in the file update matching units here, new ones are added, and nothing
            already on the sheet is removed.
          </p>

          {pending && (
            <div className="border border-amber/60 bg-amber/5 p-3 text-xs">
              <div className="truncate text-[10px] tracking-widest text-amber uppercase">{pending.fileName}</div>
              <div className="mt-1 text-ink">{describeReport(pending.report)}</div>
              <div className="mt-1 text-[10px] text-line/70">
                After import: {pending.incoming.properties} buildings · {pending.incoming.units} units ·{' '}
                {pending.incoming.billCount} bills
              </div>
              {pending.warnings?.length > 0 && (
                <ul className="mt-1 text-[10px] text-amber">
                  {pending.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </Sheet>
  )
}

function Stat({ label, value, className }) {
  return (
    <div className={className}>
      <dt className="text-[9px] tracking-[0.2em] text-line/70 uppercase">{label}</dt>
      <dd className="text-ink tabular-nums">{value}</dd>
    </div>
  )
}

function today() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function formatWhen(iso) {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function kb(bytes) {
  return Math.round((bytes || 0) / 1024).toLocaleString('en-US')
}
