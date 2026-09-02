// Rent Roll — building templates. Pure data: each template lists floors
// (top first, matching the drawing) and the units on them, and
// buildFromTemplate() turns one into a real Property with fresh ids.
// Components only ever map over TEMPLATES; nothing here is hardcoded in UI.

import { makeBill, makeProperty } from './schema.js'

export const TEMPLATES = [
  {
    id: 'single',
    name: 'Single family',
    shape: 'gable',
    floors: [{ label: '1F', units: [{ name: 'Main', position: 'full' }] }],
  },
  {
    id: 'duplex-stacked',
    name: 'Duplex (stacked)',
    shape: 'gable',
    floors: [
      { label: '2F', units: [{ name: 'Upper', position: 'full' }] },
      { label: '1F', units: [{ name: 'Lower', position: 'full' }] },
    ],
  },
  {
    id: 'duplex-side',
    name: 'Duplex (side by side)',
    shape: 'gable',
    floors: [
      {
        label: '1F',
        units: [
          { name: 'Left', position: 'left' },
          { name: 'Right', position: 'right' },
        ],
      },
    ],
  },
  {
    id: 'triplex',
    name: 'Triplex',
    shape: 'flat',
    floors: [
      { label: '3F', units: [{ name: '3F', position: 'full' }] },
      { label: '2F', units: [{ name: '2F', position: 'full' }] },
      { label: '1F', units: [{ name: '1F', position: 'full' }] },
    ],
  },
  {
    id: 'fourplex',
    name: 'Fourplex',
    shape: 'flat',
    floors: [
      {
        label: '2F',
        units: [
          { name: '2F Front', position: 'left' },
          { name: '2F Rear', position: 'right' },
        ],
      },
      {
        label: '1F',
        units: [
          { name: '1F Front', position: 'left' },
          { name: '1F Rear', position: 'right' },
        ],
      },
    ],
  },
  {
    id: 'mixed-use',
    name: 'Mixed use w/ storefront',
    shape: 'mansard',
    floors: [
      {
        label: '3F',
        units: [
          { name: '3F Front', position: 'left' },
          { name: '3F Rear', position: 'right' },
        ],
      },
      {
        label: '2F',
        units: [
          { name: '2F Front', position: 'left' },
          { name: '2F Rear', position: 'right' },
        ],
      },
      {
        label: 'Street',
        units: [
          { name: 'Street', position: 'full' },
          { name: 'Storefront', position: 'side' },
        ],
      },
    ],
  },
  {
    id: 'blank',
    name: 'Blank',
    shape: 'flat',
    floors: [{ label: '1F', units: [{ name: 'Unit 1', position: 'full' }] }],
  },
]

export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) ?? null
}

/** Floor / unit counts and shape, for the picker's description line. */
export function templateSummary(template) {
  const floors = template.floors.length
  const units = template.floors.reduce((n, f) => n + f.units.length, 0)
  const annex = template.floors.some((f) => f.units.some((u) => u.position === 'side'))
  return { floors, units, shape: template.shape, annex }
}

/** Building-level cost lines every new property starts with (amounts blank). */
export function standardBills() {
  return [
    makeBill({ label: 'Mortgage', amount: 0, cadence: 'monthly', dueDay: 1 }),
    makeBill({ label: 'Property taxes', amount: 0, cadence: 'yearly', dueDay: 1 }),
    makeBill({ label: 'Insurance', amount: 0, cadence: 'yearly', dueDay: 1 }),
    makeBill({ label: 'Water', amount: 0, cadence: 'monthly', dueDay: 1 }),
  ]
}

/**
 * Create a Property from a template. Fresh ids everywhere, rents at 0.
 * Throws if the template id is unknown.
 */
export function buildFromTemplate(templateId, name) {
  const t = getTemplate(templateId)
  if (!t) throw new Error(`Unknown template: ${templateId}`)
  return makeProperty({
    name: String(name ?? '').trim() || t.name,
    shape: t.shape,
    bills: standardBills(),
    floors: t.floors.map((f) => ({
      label: f.label,
      units: f.units.map((u) => ({ name: u.name, position: u.position ?? 'full' })),
    })),
  })
}
