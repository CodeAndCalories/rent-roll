// Schema v2 -> v3 migration check. Run with:  npm test   (node --test tests/)
//
// Loads a saved v2 store through the real store.load() with a fake
// localStorage and asserts the migration is purely additive: every rent,
// bill, note, list item, photo, and box position comes through unchanged,
// a stored sideOf is kept, and a unit with no sideOf gets the new default.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SCHEMA_VERSION, seedData } from '../src/data/schema.js'
import { load, save, migrate, STORAGE_KEY } from '../src/data/store.js'

class FakeStorage {
  constructor() {
    this.m = new Map()
  }
  getItem(k) {
    return this.m.has(k) ? this.m.get(k) : null
  }
  setItem(k, v) {
    this.m.set(k, String(v))
  }
  removeItem(k) {
    this.m.delete(k)
  }
}
globalThis.localStorage = new FakeStorage()

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='

/** A store exactly as the v2 app would have written it, with hand edits. */
function v2Store() {
  return {
    version: 2,
    updatedAt: '2026-08-30T12:00:00.000Z',
    properties: [
      {
        id: 'fairview',
        name: '2107 Fairview',
        address: '2107 Fairview, Cleveland Heights, OH',
        shape: 'mansard',
        photo: PHOTO,
        photoSize: { w: 1200, h: 800 },
        view: 'photo',
        extra: 42, // unknown field
        bills: [
          { id: 'fairview-bill-mortgage', label: 'Mortgage', amount: 2000, cadence: 'monthly', dueDay: 1, paid: true },
          { id: 'fairview-bill-taxes', label: 'Property taxes', amount: 1200, cadence: 'yearly', dueDay: 1, paid: false },
        ],
        floors: [
          {
            id: 'fairview-3f',
            label: '3F',
            units: [
              {
                id: 'fairview-3f-left',
                name: '3F Left (renamed by hand)',
                position: 'left',
                rent: 1450,
                status: 'leased',
                tenant: 'A. Tenant',
                leaseStart: '2026-01-01',
                leaseEnd: '2026-12-31',
                splittable: false,
                isSplit: false,
                splitRent: 0,
                sideOf: 'right',
                photoBox: { x: 0.12, y: 0.2, w: 0.3, h: 0.25 },
                mystery: 'keep me', // unknown field
                bills: [{ id: 'gas', label: 'Gas', amount: 60, cadence: 'monthly', dueDay: 15, paid: false }],
                tasks: [{ id: 't1', text: 'Fix faucet', done: false, createdAt: '2026-08-01T00:00:00.000Z' }],
                notes: [{ id: 'n1', text: 'Tenant called about heat', createdAt: '2026-08-02T00:00:00.000Z' }],
              },
              {
                id: 'fairview-3f-right',
                name: '3F Right',
                position: 'right',
                rent: 900,
                status: 'vacant',
                tenant: '',
                leaseStart: null,
                leaseEnd: null,
                splittable: false,
                isSplit: false,
                splitRent: 0,
                sideOf: 'right',
                photoBox: null,
                bills: [],
                tasks: [],
                notes: [],
              },
            ],
          },
          {
            id: 'fairview-street',
            label: 'Street',
            units: [
              {
                id: 'fairview-double-single',
                name: 'Double single',
                position: 'full',
                rent: 900,
                status: 'leased',
                tenant: 'B. Tenant',
                leaseStart: '2026-03-01',
                leaseEnd: '2027-02-28',
                splittable: true,
                isSplit: true,
                splitRent: 850,
                sideOf: 'right',
                photoBox: { x: 0.2, y: 0.6, w: 0.5, h: 0.3 },
                bills: [],
                tasks: [],
                notes: [],
              },
              {
                id: 'fairview-storefront',
                name: 'Storefront',
                position: 'side',
                rent: 1200,
                status: 'renovating',
                tenant: '',
                leaseStart: null,
                leaseEnd: null,
                splittable: false,
                isSplit: false,
                splitRent: 0,
                sideOf: 'right', // explicitly on the right; must stay there
                photoBox: { x: 0.84, y: 0.7, w: 0.14, h: 0.2 },
                bills: [],
                tasks: [],
                notes: [],
              },
              {
                // never touched by a v2 app: no sideOf, no photoBox
                id: 'legacy-unit',
                name: 'Legacy',
                position: 'full',
                rent: 700,
                status: 'vacant',
              },
            ],
          },
        ],
      },
    ],
  }
}

const findUnit = (state, id) =>
  state.properties.flatMap((p) => p.floors).flatMap((f) => f.units).find((u) => u.id === id)

test('a saved v2 store loads as v3 with every value intact', () => {
  const stored = v2Store()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))

  const r = load()
  assert.equal(r.source, 'storage')
  assert.equal(r.from, 2)
  assert.equal(r.state.version, SCHEMA_VERSION)
  assert.equal(SCHEMA_VERSION, 3)
  assert.equal(r.warnings.length, 0)

  const p = r.state.properties[0]
  const src = stored.properties[0]
  assert.equal(p.name, src.name)
  assert.equal(p.address, src.address)
  assert.equal(p.shape, 'mansard')
  assert.equal(p.photo, PHOTO, 'photo data URL unchanged')
  assert.deepEqual(p.photoSize, { w: 1200, h: 800 })
  assert.equal(p.view, 'photo')
  assert.equal(p.extra, 42, 'unknown property field kept')
  assert.deepEqual(p.bills, src.bills, 'property bills unchanged')

  const u = findUnit(r.state, 'fairview-3f-left')
  const su = findUnit(stored, 'fairview-3f-left')
  assert.equal(u.rent, 1450, 'rent')
  assert.equal(u.status, 'leased')
  assert.equal(u.tenant, 'A. Tenant')
  assert.equal(u.leaseStart, '2026-01-01')
  assert.equal(u.leaseEnd, '2026-12-31')
  assert.deepEqual(u.bills, su.bills, 'unit bill')
  assert.deepEqual(u.tasks, su.tasks, 'list item')
  assert.deepEqual(u.notes, su.notes, 'note')
  assert.deepEqual(u.photoBox, { x: 0.12, y: 0.2, w: 0.3, h: 0.25 }, 'box position')
  assert.equal(u.mystery, 'keep me', 'unknown unit field kept')

  const ds = findUnit(r.state, 'fairview-double-single')
  assert.equal(ds.rent, 900)
  assert.equal(ds.splitRent, 850)
  assert.equal(ds.isSplit, true)
  assert.deepEqual(ds.photoBox, { x: 0.2, y: 0.6, w: 0.5, h: 0.3 })

  // nothing added or removed
  assert.equal(r.state.properties.length, 1)
  assert.equal(r.state.properties[0].floors.length, 2)
  assert.equal(r.state.properties[0].floors[1].units.length, 3)
})

test('sideOf is present on every unit: stored values kept, missing ones default to left', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(v2Store()))
  const { state } = load()
  for (const u of state.properties.flatMap((p) => p.floors).flatMap((f) => f.units)) {
    assert.ok(u.sideOf === 'left' || u.sideOf === 'right', `${u.id} has sideOf`)
  }
  assert.equal(findUnit(state, 'fairview-storefront').sideOf, 'right', 'explicit right stays right')
  assert.equal(findUnit(state, 'fairview-3f-left').sideOf, 'right')
  const legacy = findUnit(state, 'legacy-unit')
  assert.equal(legacy.sideOf, 'left', 'no stored sideOf -> new default')
  assert.equal(legacy.rent, 700, 'its rent is untouched')
  assert.equal(legacy.photoBox, null)
  assert.equal(legacy.splittable, false)
  assert.deepEqual(legacy.bills, [])
})

test('the migration never renames a unit', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(v2Store()))
  const { state } = load()
  assert.equal(findUnit(state, 'fairview-3f-left').name, '3F Left (renamed by hand)')
  assert.equal(findUnit(state, 'fairview-3f-right').name, '3F Right')
})

test('saving the migrated state writes v3 and a second load is identical', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(v2Store()))
  const first = load().state
  const r = save(first)
  assert.equal(r.ok, true)
  assert.equal(JSON.parse(localStorage.getItem(STORAGE_KEY)).version, 3)
  const second = load()
  assert.equal(second.from, 3)
  assert.deepEqual(second.state.properties, first.properties)
})

test('migrate() is idempotent', () => {
  const once = migrate(v2Store()).state
  const twice = migrate(once).state
  assert.deepEqual(twice, once)
})

test('seed data uses Front / Rear on the upper floors and the new sideOf default', () => {
  const s = seedData()
  const names = s.properties[0].floors.flatMap((f) => f.units.map((u) => u.name))
  assert.deepEqual(names, ['3F Front', '3F Rear', '2F Front', '2F Rear', 'Double single', 'Storefront'])
  const ids = s.properties[0].floors.flatMap((f) => f.units.map((u) => u.id))
  assert.deepEqual(ids, [
    'fairview-3f-left',
    'fairview-3f-right',
    'fairview-2f-left',
    'fairview-2f-right',
    'fairview-double-single',
    'fairview-storefront',
  ])
  assert.equal(s.version, 3)
  for (const u of s.properties.flatMap((p) => p.floors).flatMap((f) => f.units)) assert.equal(u.sideOf, 'left')
})
