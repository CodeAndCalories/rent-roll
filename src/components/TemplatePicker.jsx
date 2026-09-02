import { useState } from 'react'
import { TEMPLATES, templateSummary } from '../data/templates.js'
import { Chip, Sheet, cx } from './controls.jsx'

// All components at module scope (see UnitBox.jsx for why).
// Nothing about any template is written here: the list is data in
// src/data/templates.js and this only draws it.

export default function TemplatePicker({ onCreate, onClose }) {
  const [templateId, setTemplateId] = useState(TEMPLATES[0]?.id ?? null)
  const [name, setName] = useState('')
  const trimmed = name.trim()
  const canCreate = Boolean(templateId) && trimmed.length > 0

  const submit = (e) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault()
    if (!canCreate) return
    onCreate({ templateId, name: trimmed })
  }

  return (
    <Sheet
      title="Add building"
      onClose={onClose}
      footer={
        <>
          <Chip onClick={onClose}>Cancel</Chip>
          <Chip active disabled={!canCreate} onClick={submit}>
            Create
          </Chip>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="text-[9px] tracking-[0.2em] text-line/70 uppercase">Building name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name or street address"
            aria-label="Building name"
            autoComplete="off"
            enterKeyHint="done"
            className="mt-1 w-full border-b border-line/50 bg-transparent py-1 text-base text-ink outline-none placeholder:text-line/30 focus:border-amber"
          />
        </label>

        <div role="radiogroup" aria-label="Template" className="space-y-1">
          {TEMPLATES.map((t) => {
            const s = templateSummary(t)
            const active = templateId === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setTemplateId(t.id)}
                className={cx(
                  'flex min-h-11 w-full items-center justify-between gap-3 border px-3 py-2 text-left',
                  active ? 'border-amber bg-amber/10' : 'border-line/40 hover:border-line',
                )}
              >
                <span className="text-xs tracking-[0.15em] text-ink uppercase">{t.name}</span>
                <span className="shrink-0 text-right text-[9px] tracking-widest text-line/70 uppercase">
                  {s.floors} {s.floors === 1 ? 'floor' : 'floors'} · {s.units} {s.units === 1 ? 'unit' : 'units'}
                  {s.annex ? ' + annex' : ''} · {s.shape}
                </span>
              </button>
            )
          })}
        </div>

        <p className="text-[10px] text-line/60">
          A layout is only a starting point: rents start at 0, and floors, units, names, the roof shape, and
          a side annex can all be changed afterwards on the drawing with Build.
        </p>
      </form>
    </Sheet>
  )
}
