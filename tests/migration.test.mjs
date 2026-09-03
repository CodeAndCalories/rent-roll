// Schema migration check. Run with:  npm test   (node --test "tests/**/*.test.mjs")
//
// Loads saved v2 and v4 stores through the real store.load() with a fake
// localStorage and asserts the migration is purely additive: every rent,
// bill, note, list item, photo, and box position comes through unchanged,
// a stored sideOf is kept, a unit with no sideOf gets the default, and a
// store written before unit widths existed comes back at equal widths.

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

test('a saved v2 store loads at the current version with every value intact', () => {
  const stored = v2Store()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))

  const r = load()
  assert.equal(r.source, 'storage')
  assert.equal(r.from, 2)
  assert.equal(r.state.version, SCHEMA_VERSION)
  assert.equal(SCHEMA_VERSION, 7)
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
  assert.equal(ds.splittable, true)
  assert.deepEqual(ds.photoBox, { x: 0.2, y: 0.6, w: 0.5, h: 0.3 })

  const sf = findUnit(r.state, 'fairview-storefront')
  assert.equal(sf.position, 'side', 'a legacy side annex stays where it is')
  assert.deepEqual(sf.photoBox, { x: 0.84, y: 0.7, w: 0.14, h: 0.2 })

  // nothing added or removed
  assert.equal(r.state.properties.length, 1)
  assert.equal(r.state.properties[0].floors.length, 2)
  assert.equal(r.state.properties[0].floors[1].units.length, 3)
})

/**
 * The same store as the v4 app would have written it: v3 and v4 added no
 * fields, so only the version number differs. One unit carries a widthWeight
 * as an imported file might, which the migration must keep rather than reset.
 */
function v4Store() {
  const s = v2Store()
  s.version = 4
  s.properties[0].floors[0].units[0].widthWeight = 2.5
  return s
}

test('a v4 store migrates forward with nothing lost and floors split equally', () => {
  const stored = v4Store()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))

  const r = load()
  assert.equal(r.source, 'storage')
  assert.equal(r.from, 4)
  assert.equal(r.state.version, SCHEMA_VERSION)
  assert.equal(r.warnings.length, 0)

  // every unit has a width, and a floor that never had one splits equally
  const units = r.state.properties.flatMap((p) => p.floors).flatMap((f) => f.units)
  assert.equal(units.length, 5)
  for (const u of units) {
    assert.equal(typeof u.widthWeight, 'number')
    assert.ok(Number.isFinite(u.widthWeight) && u.widthWeight > 0, `${u.id} has a usable width`)
  }
  assert.equal(findUnit(r.state, 'fairview-3f-left').widthWeight, 2.5, 'a stored width is kept')
  assert.equal(findUnit(r.state, 'fairview-3f-right').widthWeight, 1, 'one without gets the equal share')
  assert.equal(findUnit(r.state, 'legacy-unit').widthWeight, 1)

  // and absolutely nothing else moved
  const p = r.state.properties[0]
  const src = stored.properties[0]
  assert.equal(p.photo, PHOTO, 'photo data URL unchanged')
  assert.deepEqual(p.photoSize, { w: 1200, h: 800 })
  assert.equal(p.view, 'photo')
  assert.equal(p.extra, 42, 'unknown property field kept')
  assert.deepEqual(p.bills, src.bills, 'property bills unchanged')

  const u = findUnit(r.state, 'fairview-3f-left')
  const su = findUnit(stored, 'fairview-3f-left')
  assert.equal(u.name, su.name)
  assert.equal(u.rent, 1450)
  assert.equal(u.status, 'leased')
  assert.equal(u.tenant, 'A. Tenant')
  assert.equal(u.leaseEnd, '2026-12-31')
  assert.deepEqual(u.bills, su.bills, 'unit bill')
  assert.deepEqual(u.tasks, su.tasks, 'list item')
  assert.deepEqual(u.notes, su.notes, 'note')
  assert.deepEqual(u.photoBox, su.photoBox, 'box position')
  assert.equal(u.mystery, 'keep me', 'unknown unit field kept')

  const ds = findUnit(r.state, 'fairview-double-single')
  assert.equal(ds.rent, 900)
  assert.equal(ds.splitRent, 850)
  assert.equal(ds.isSplit, true)

  const sf = findUnit(r.state, 'fairview-storefront')
  assert.equal(sf.position, 'side', 'the annex is still the annex')
  assert.equal(sf.sideOf, 'right')
  assert.equal(sf.rent, 1200)

  assert.equal(p.floors.length, 2)
  assert.equal(p.floors[0].units.length, 2)
  assert.equal(p.floors[1].units.length, 3)

  // saving and reloading it changes nothing further
  assert.equal(save(r.state).ok, true)
  const again = load()
  assert.equal(again.from, SCHEMA_VERSION)
  assert.deepEqual(again.state.properties, r.state.properties)
  const once = migrate(v4Store()).state
  assert.deepEqual(migrate(once).state, once, 'idempotent')
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
  assert.equal(legacy.sideOf, 'left', 'no stored sideOf -> default')
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

test('saving the migrated state writes the current version and a second load is identical', () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(v2Store()))
  const first = load().state
  const r = save(first)
  assert.equal(r.ok, true)
  assert.equal(JSON.parse(localStorage.getItem(STORAGE_KEY)).version, SCHEMA_VERSION)
  const second = load()
  assert.equal(second.from, SCHEMA_VERSION)
  assert.deepEqual(second.state.properties, first.properties)
})

test('migrate() is idempotent', () => {
  const once = migrate(v2Store()).state
  const twice = migrate(once).state
  assert.deepEqual(twice, once)
})

test('the seed is an empty sheet at the current version', () => {
  const s = seedData()
  assert.equal(s.version, SCHEMA_VERSION)
  assert.deepEqual(s.properties, [])
})
