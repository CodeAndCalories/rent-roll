import { useEffect, useRef, useState } from 'react'
import {
  CADENCES,
  PAYMENT_STATUSES,
  SIDES,
  STATUSES,
  formatDollars,
  makeBill,
  makeNote,
  makeTask,
  toAmount,
} from '../data/schema.js'
import { OWED_STATUSES, defaultAmountFor, halvesFor, paymentFor } from '../data/payments.js'
import { leaseFlag } from '../lib/leases.js'
import { lastMonths, monthKey, monthLabel } from '../lib/months.js'
import { billMonthly } from './TitleBlock.jsx'
import { STATUS_TONE } from './MonthView.jsx'
import { RentInput } from './UnitBox.jsx'
import { Chip, keepFocusedFieldVisible } from './controls.jsx'

// Every component in this file is declared at MODULE scope (see UnitBox.jsx).
//
// All edits go through `onChange(patch)`, where patch is an object or a
// function (unit) => partialUnit. App merges it into the unit and the store
// saves the whole state, so everything here persists on reload.

const TABS = [
  { id: 'payments', label: 'Payments' },
  { id: 'bills', label: 'Bills' },
  { id: 'list', label: 'List' },
  { id: 'updates', label: 'Updates' },
]

/** How many months the Payments tab shows, newest first. */
const PAYMENT_WINDOW = 12

/**
 * Unit detail panel. Bottom sheet on phones, right-hand drawer from `sm` up.
 *
 * props
 *   unit        the Unit record (always the latest from state)
 *   onChange    (patch | (unit) => patch) => void
 *   onPayment   (month, half, patch) => void   ops.setPayment behind it
 *   onUntrack   (month, half) => void          ops.clearPayment behind it
 *   onClose     () => void
 *   initialTab  'payments' | 'bills' | 'list' | 'updates'
 *   scenario    true while the sheet is in a scenario: only the Bills tab,
 *               and no tenant or lease fields — a scenario holds no facts
 *   context     { sideAnnex: { ok, reason } } from ops.sideAnnexCheck
 */
export default function UnitPanel({
  unit,
  onChange,
  onPayment,
  onUntrack,
  onClose,
  initialTab = 'payments',
  scenario = false,
  context = {},
}) {
  const tabs = scenario ? TABS.filter((t) => t.id === 'bills') : TABS
  const [tab, setTab] = useState(scenario ? 'bills' : initialTab)
  const months = lastMonths(PAYMENT_WINDOW, monthKey())

  // Escape closes; the page behind the sheet stops scrolling while open.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  const counts = {
    // months in the window explicitly unpaid or late (untracked never counts)
    payments: months.reduce(
      (n, m) =>
        n +
        halvesFor(unit, m).filter((h) => OWED_STATUSES.includes(paymentFor(unit, m, h)?.status)).length,
      0,
    ),
    bills: unit.bills.length,
    list: unit.tasks.filter((t) => !t.done).length,
    updates: unit.notes.length,
  }

  return (
    <>
      <div className="fixed inset-0 z-30 bg-sheet/60" onClick={onClose} aria-hidden />

      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${unit.name || 'Unit'} detail`}
        className="animate-slide-up motion-reduce:animate-none fixed inset-x-0 bottom-0 z-40 flex max-h-[88dvh] flex-col border-t-2 border-amber bg-sheet shadow-2xl sm:animate-slide-in sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[440px] sm:max-w-full sm:border-t-0 sm:border-l-2"
      >
        <PanelHeader unit={unit} onChange={onChange} onClose={onClose} context={context} scenario={scenario} />

        <nav role="tablist" className="flex border-b border-line/40 px-2 sm:px-3">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                'font-display -mb-px flex min-h-11 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[11px] tracking-[0.25em] uppercase',
                tab === t.id ? 'border-amber text-ink' : 'border-transparent text-line/70 hover:text-ink',
              )}
            >
              {t.label}
              {counts[t.id] > 0 && (
                <span className="font-mono text-[9px] tracking-normal text-line/70 tabular-nums">
                  {counts[t.id]}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* the field that takes focus is scrolled clear of the on-screen
            keyboard; the viewport meta lets the keyboard resize the page
            rather than shove the sheet up */}
        <div
          onFocus={keepFocusedFieldVisible}
          className="flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-5"
        >
          {tab === 'payments' && (
            <PaymentsTab unit={unit} months={months} onPayment={onPayment} onUntrack={onUntrack} />
          )}
          {tab === 'bills' && <BillsTab unit={unit} onChange={onChange} />}
          {tab === 'list' && <ListTab unit={unit} onChange={onChange} />}
          {tab === 'updates' && <UpdatesTab unit={unit} onChange={onChange} />}
        </div>
      </section>
    </>
  )
}

// ---------------------------------------------------------------------------
// header: name, rent, status, tenant, lease dates
// ---------------------------------------------------------------------------

function PanelHeader({ unit, onChange, onClose, context, scenario = false }) {
  const split = Boolean(unit.splittable && unit.isSplit)
  const flag = leaseFlag(unit.leaseEnd)

  return (
    <header className="border-b border-line/40 px-4 pt-3 pb-4 sm:px-5">
      <div className="flex items-start gap-3">
        <input
          type="text"
          value={unit.name ?? ''}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Unit name"
          aria-label="Unit name"
          autoComplete="off"
          className="font-display min-w-0 flex-1 border-b border-transparent bg-transparent py-1 text-base tracking-[0.2em] text-ink uppercase outline-none placeholder:text-line/30 focus:border-amber"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mt-1 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-line hover:text-amber"
        >
          ✕
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label={split ? 'Rent A' : 'Rent'}>
          <RentInput value={unit.rent} onCommit={(rent) => onChange({ rent })} ariaLabel="Rent" />
        </Field>
        {split && (
          <Field label="Rent B">
            <RentInput
              value={unit.splitRent}
              onCommit={(splitRent) => onChange({ splitRent })}
              ariaLabel="Second half rent"
            />
          </Field>
        )}
        <Field label="Status" className={split ? 'col-span-2' : ''}>
          <StatusPicker value={unit.status} onChange={(status) => onChange({ status })} />
        </Field>
        {/* tenant and lease dates are facts: not part of a scenario */}
        {!scenario && (
          <>
            <Field label="Tenant" className="col-span-2">
              <TextInput
                value={unit.tenant}
                onChange={(tenant) => onChange({ tenant })}
                placeholder="—"
                aria-label="Tenant name"
                className="w-full"
              />
            </Field>
            <Field label="Lease start">
              <DateInput
                value={unit.leaseStart}
                onChange={(leaseStart) => onChange({ leaseStart })}
                ariaLabel="Lease start"
              />
            </Field>
            <Field label="Lease end" flag={flag}>
              <DateInput
                value={unit.leaseEnd}
                onChange={(leaseEnd) => onChange({ leaseEnd })}
                ariaLabel="Lease end"
              />
            </Field>
          </>
        )}
      </div>

      <LayoutRow unit={unit} onChange={onChange} context={context} />
    </header>
  )
}

/**
 * Per-unit layout toggles: splittable, side annex (+ which side).
 * The side-annex rule (bottom floor only, one per floor) is enforced in
 * ops.js; here the box is disabled with the reason when it would fail.
 * Turning splittable off while split with a second rent asks first.
 */
function LayoutRow({ unit, onChange, context }) {
  const [confirmUnsplit, setConfirmUnsplit] = useState(false)
  const isSide = unit.position === 'side'
  const annex = context?.sideAnnex ?? { ok: true }
  const secondRent = toAmount(unit.splitRent)
  const needsWarning = Boolean(unit.splittable && unit.isSplit && secondRent > 0)
  const side = unit.sideOf === 'right' ? 'right' : 'left'

  const toggleSplittable = (on) => {
    if (on) {
      setConfirmUnsplit(false)
      onChange({ splittable: true })
      return
    }
    if (needsWarning) {
      setConfirmUnsplit(true)
      return
    }
    onChange({ splittable: false, isSplit: false })
  }

  return (
    <div className="mt-3 border-t border-line/30 pt-3">
      <div className="text-[9px] tracking-[0.2em] text-line/70 uppercase">Layout</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex min-h-11 items-center gap-2 text-[10px] tracking-widest text-ink uppercase">
          <input
            type="checkbox"
            checked={Boolean(unit.splittable)}
            onChange={(e) => toggleSplittable(e.target.checked)}
            className="h-4 w-4 accent-amber"
          />
          Splittable
        </label>

        <label
          className={cx(
            'flex min-h-11 items-center gap-2 text-[10px] tracking-widest uppercase',
            isSide || annex.ok ? 'text-ink' : 'text-line/40',
          )}
        >
          <input
            type="checkbox"
            checked={isSide}
            disabled={!isSide && !annex.ok}
            onChange={(e) => onChange({ position: e.target.checked ? 'side' : 'full' })}
            className="h-4 w-4 accent-amber disabled:opacity-40"
          />
          Side annex
        </label>

        {isSide && (
          <div role="radiogroup" aria-label="Annex side" className="inline-flex">
            {SIDES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={side === s}
                onClick={() => onChange({ sideOf: s })}
                className={cx(
                  'min-h-11 border px-2.5 text-[9px] tracking-widest uppercase',
                  s === 'right' && '-ml-px',
                  side === s ? 'border-amber bg-amber text-sheet' : 'border-line/40 text-line/70 hover:text-ink',
                )}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {!isSide && !annex.ok && <p className="mt-1 text-[10px] text-line/50">{annex.reason}</p>}

      {confirmUnsplit && (
        <div className="mt-2 border border-alert/60 bg-alert/5 p-2 text-xs">
          <p className="text-ink">
            This unit is split. Turning splittable off stops counting the second rent of{' '}
            {formatDollars(secondRent)}. The number is kept and comes back if you split again.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Chip onClick={() => setConfirmUnsplit(false)}>Keep split</Chip>
            <Chip
              tone="alert"
              onClick={() => {
                setConfirmUnsplit(false)
                onChange({ splittable: false, isSplit: false })
              }}
            >
              Turn off
            </Chip>
          </div>
        </div>
      )}
    </div>
  )
}

const STATUS_STYLE = {
  leased: 'border-line bg-line text-sheet',
  vacant: 'border-alert bg-alert text-sheet',
  renovating: 'border-amber bg-amber text-sheet',
}

function StatusPicker({ value, onChange }) {
  return (
    <div className="flex" role="radiogroup" aria-label="Status">
      {STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={value === s}
          onClick={() => onChange(s)}
          className={cx(
            '-ml-px min-h-11 flex-1 border px-1 py-1.5 text-[9px] tracking-widest uppercase first:ml-0',
            value === s ? STATUS_STYLE[s] : 'border-line/40 text-line/70 hover:text-ink',
          )}
        >
          {s}
        </button>
      ))}
    </div>
  )
}

// The lease-end flag ("renews soon" / "ended") and the local-midnight day
// math behind it live in lib/leases.js, shared with the Leases view.
export { leaseFlag }

// ---------------------------------------------------------------------------
// PAYMENTS
// ---------------------------------------------------------------------------

/**
 * The last PAYMENT_WINDOW months, newest first, one row per rental (the
 * unit, or half A and half B while split — and a half that has a record
 * for that month, so history from before an unsplit stays in view). A
 * month with no record is grey with a dash: untracked, not unpaid. Picking
 * a status creates the record, at the rent of that moment; every field of
 * an existing record edits in place, any month, no warning. The only way
 * back to untracked is the two-tap ✕, and it never fires by accident.
 */
function PaymentsTab({ unit, months, onPayment, onUntrack }) {
  return (
    <div className="pt-3">
      <p className="text-[10px] leading-relaxed text-line/60">
        Last {months.length} months. A month you never marked stays grey — untracked, not unpaid. Pick a
        status to start tracking it; any month can be edited.
      </p>
      <div className="mt-2 divide-y divide-line/20">
        {months.map((m) => (
          <MonthBlock key={m} unit={unit} month={m} onPayment={onPayment} onUntrack={onUntrack} />
        ))}
      </div>
    </div>
  )
}

function MonthBlock({ unit, month, onPayment, onUntrack }) {
  const halves = halvesFor(unit, month)
  return (
    <div className="space-y-2 py-2">
      {halves.map((half) => (
        <PaymentRow
          key={half}
          unit={unit}
          month={month}
          half={half}
          showHalf={halves.length > 1}
          onPayment={onPayment}
          onUntrack={onUntrack}
        />
      ))}
    </div>
  )
}

function PaymentRow({ unit, month, half, showHalf, onPayment, onUntrack }) {
  const record = paymentFor(unit, month, half)
  const due = defaultAmountFor(unit, half)
  const label = showHalf ? `${monthLabel(month)} · ${half}` : monthLabel(month)
  const patch = (fields) => onPayment(month, half, fields)

  if (!record) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-[10px] leading-tight tracking-[0.12em] text-line/40 uppercase">
          {label}
        </span>
        <PaymentStatusSelect value={null} onChange={(status) => patch({ status })} label={label} />
        <span className="ml-auto text-sm text-line/40" title="Untracked">
          —
        </span>
        <span className="w-20 shrink-0 text-right text-[9px] text-line/40 tabular-nums" title="Rent right now">
          {due > 0 ? formatDollars(due) : ''}
        </span>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-[10px] leading-tight tracking-[0.12em] text-ink uppercase">{label}</span>
        <PaymentStatusSelect value={record.status} onChange={(status) => patch({ status })} label={label} />
        <div className="ml-auto w-20">
          <RentInput value={record.amount} onCommit={(amount) => patch({ amount })} ariaLabel={`${label} amount`} />
        </div>
        <DeleteButton
          onConfirm={() => onUntrack(month, half)}
          what="record"
          label={`Untrack ${label}`}
          confirmLabel="Untrack?"
        />
      </div>
      <div className="mt-1.5 flex items-center gap-2 pl-[4.5rem]">
        <DateInput
          value={record.paidOn}
          onChange={(paidOn) => patch({ paidOn })}
          ariaLabel={`${label} paid on`}
          className="w-36 shrink-0"
        />
        <TextInput
          value={record.note}
          onChange={(note) => patch({ note })}
          placeholder="Note"
          aria-label={`${label} note`}
          className="min-w-0 flex-1"
        />
      </div>
    </div>
  )
}

/**
 * The status picker. An untracked month offers "—" plus the five statuses;
 * a tracked one offers only the statuses, so the select can never clear a
 * record by itself (the ✕ does that, in two taps).
 */
function PaymentStatusSelect({ value, onChange, label }) {
  const untracked = value == null
  return (
    <select
      value={untracked ? '' : value}
      onChange={(e) => {
        if (e.target.value) onChange(e.target.value)
      }}
      aria-label={`${label} status`}
      className={cx(
        'min-h-11 border bg-sheet px-1.5 py-1.5 text-base tracking-widest uppercase sm:min-h-9 sm:text-[10px]',
        STATUS_TONE[untracked ? 'untracked' : value] ?? STATUS_TONE.untracked,
      )}
    >
      {untracked && <option value="">—</option>}
      {PAYMENT_STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  )
}

// ---------------------------------------------------------------------------
// BILLS
// ---------------------------------------------------------------------------

/** Monthly-equivalent cost of a unit's own bills (yearly / 12, once = 0). */
export function unitBillsMonthly(unit) {
  return (unit.bills ?? []).reduce((sum, b) => sum + billMonthly(b), 0)
}

function BillsTab({ unit, onChange }) {
  const monthly = unitBillsMonthly(unit)
  const update = (id, patch) =>
    onChange((u) => ({ bills: u.bills.map((b) => (b.id === id ? { ...b, ...patch } : b)) }))
  const remove = (id) => onChange((u) => ({ bills: u.bills.filter((b) => b.id !== id) }))
  const add = () => onChange((u) => ({ bills: [...u.bills, makeBill()] }))

  return (
    <div className="space-y-3 pt-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[9px] tracking-[0.2em] text-line/70 uppercase">Monthly equivalent</span>
        <span className="text-lg text-ink tabular-nums">
          {formatDollars(monthly)}
          <span className="text-[10px] text-line/70"> / mo</span>
        </span>
      </div>

      {unit.bills.length === 0 && <Empty>No bills for this unit.</Empty>}

      {unit.bills.map((b) => (
        <BillRow
          key={b.id}
          bill={b}
          onChange={(patch) => update(b.id, patch)}
          onDelete={() => remove(b.id)}
        />
      ))}

      <AddButton onClick={add}>Add bill</AddButton>
    </div>
  )
}

function BillRow({ bill, onChange, onDelete }) {
  return (
    <div className="space-y-2 border border-line/40 p-2">
      <div className="flex items-center gap-2">
        <TextInput
          value={bill.label}
          onChange={(label) => onChange({ label })}
          placeholder="Label (gas, water, …)"
          aria-label="Bill label"
          className="flex-1"
        />
        <DeleteButton onConfirm={onDelete} what="bill" />
      </div>
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div className="w-28">
          <RentInput value={bill.amount} onCommit={(amount) => onChange({ amount })} ariaLabel="Amount" />
        </div>
        <Select
          value={bill.cadence}
          onChange={(cadence) => onChange({ cadence })}
          options={CADENCES}
          ariaLabel="Cadence"
        />
        <label className="flex items-center gap-1.5 text-[9px] tracking-widest text-line/70 uppercase">
          Due
          <NumberField
            value={bill.dueDay}
            min={1}
            max={31}
            onCommit={(dueDay) => onChange({ dueDay })}
            ariaLabel="Due day of month"
            className="w-9"
          />
        </label>
        <label className="ml-auto flex items-center gap-1.5 text-[10px] tracking-widest text-ink uppercase">
          <input
            type="checkbox"
            checked={Boolean(bill.paid)}
            onChange={(e) => onChange({ paid: e.target.checked })}
            className="h-4 w-4 accent-amber"
          />
          Paid
        </label>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// LIST
// ---------------------------------------------------------------------------

function ListTab({ unit, onChange }) {
  const [text, setText] = useState('')
  const open = unit.tasks.filter((t) => !t.done).length

  const add = (e) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    onChange((u) => ({ tasks: [...u.tasks, makeTask({ text: t })] }))
    setText('')
  }
  const toggle = (id) =>
    onChange((u) => ({ tasks: u.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) }))
  const remove = (id) => onChange((u) => ({ tasks: u.tasks.filter((t) => t.id !== id) }))

  return (
    <div className="space-y-3 pt-3">
      <form onSubmit={add} className="flex items-end gap-2">
        <TextInput
          value={text}
          onChange={setText}
          placeholder="Add an item…"
          aria-label="New list item"
          enterKeyHint="done"
          className="flex-1"
        />
        <SubmitButton>Add</SubmitButton>
      </form>

      {unit.tasks.length === 0 && <Empty>Nothing on the list.</Empty>}

      <ul className="divide-y divide-line/30">
        {unit.tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-3 py-2">
            <input
              type="checkbox"
              checked={Boolean(t.done)}
              onChange={() => toggle(t.id)}
              aria-label={t.done ? 'Mark not done' : 'Mark done'}
              className="h-5 w-5 shrink-0 accent-amber"
            />
            <span className={cx('min-w-0 flex-1 text-sm break-words', t.done && 'text-line/50 line-through')}>
              {t.text}
            </span>
            <DeleteButton onConfirm={() => remove(t.id)} what="item" />
          </li>
        ))}
      </ul>

      {unit.tasks.length > 0 && (
        <div className="text-[9px] tracking-widest text-line/60 uppercase">
          {open} open · {unit.tasks.length - open} done
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// UPDATES
// ---------------------------------------------------------------------------

function UpdatesTab({ unit, onChange }) {
  const [text, setText] = useState('')
  const notes = unit.notes.slice().sort((a, b) => (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0))

  const add = (e) => {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    onChange((u) => ({ notes: [...u.notes, makeNote({ text: t })] }))
    setText('')
  }
  const remove = (id) => onChange((u) => ({ notes: u.notes.filter((n) => n.id !== id) }))

  return (
    <div className="space-y-3 pt-3">
      <form onSubmit={add} className="space-y-2">
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add(e)
          }}
          placeholder="What happened?"
          aria-label="New note"
          className="w-full resize-y border border-line/40 bg-transparent p-2 text-base text-ink outline-none placeholder:text-line/30 focus:border-amber"
        />
        <div className="flex justify-end">
          <SubmitButton>Add note</SubmitButton>
        </div>
      </form>

      {notes.length === 0 && <Empty>No updates yet.</Empty>}

      {notes.map((n) => (
        <article key={n.id} className="border-l-2 border-line/40 py-0.5 pl-3">
          <div className="flex items-center justify-between gap-2">
            <time dateTime={n.createdAt} className="text-[9px] tracking-widest text-line/60 uppercase">
              {formatStamp(n.createdAt)}
            </time>
            <DeleteButton onConfirm={() => remove(n.id)} what="note" />
          </div>
          <p className="mt-0.5 text-sm break-words whitespace-pre-wrap text-ink">{n.text}</p>
        </article>
      ))}
    </div>
  )
}

export function formatStamp(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// ---------------------------------------------------------------------------
// small shared controls
// ---------------------------------------------------------------------------

const FLAG_TONE = { amber: 'text-amber', alert: 'text-alert' }

function Field({ label, flag, className, children }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[9px] tracking-[0.2em] text-line/70 uppercase">
        <span>{label}</span>
        {flag && <span className={cx('truncate', FLAG_TONE[flag.tone])}>{flag.text}</span>}
      </div>
      {children}
    </div>
  )
}

function TextInput({ value, onChange, className, ...rest }) {
  return (
    <input
      type="text"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      autoComplete="off"
      className={cx(
        'min-w-0 border-b border-line/50 bg-transparent py-1 text-base text-ink outline-none placeholder:text-line/30 focus:border-amber',
        className,
      )}
      {...rest}
    />
  )
}

function DateInput({ value, onChange, ariaLabel, className = 'w-full' }) {
  return (
    <input
      type="date"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label={ariaLabel}
      className={cx(
        'min-w-0 border-b border-line/50 bg-transparent py-1 text-base text-ink [color-scheme:dark] outline-none focus:border-amber',
        className,
      )}
    />
  )
}

function Select({ value, onChange, options, ariaLabel }) {
  const opts = options.includes(value) ? options : [value, ...options]
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={ariaLabel}
      className="min-h-11 border border-line/40 bg-sheet px-1.5 py-1.5 text-base tracking-widest text-line uppercase sm:min-h-9 sm:text-[10px]"
    >
      {opts.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

/** Integer field with a local draft; commits clamped values as you type. */
function NumberField({ value, onCommit, min, max, ariaLabel, className }) {
  const [draft, setDraft] = useState(() => (value == null ? '' : String(value)))
  const ref = useRef(null)

  useEffect(() => {
    if (typeof document !== 'undefined' && document.activeElement === ref.current) return
    setDraft(value == null ? '' : String(value))
  }, [value])

  const clamp = (raw) => {
    const n = parseInt(raw, 10)
    if (!Number.isFinite(n)) return null
    return Math.min(max, Math.max(min, n))
  }

  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        const n = clamp(e.target.value)
        if (n != null) onCommit(n)
      }}
      onBlur={() => setDraft(value == null ? '' : String(value))}
      aria-label={ariaLabel}
      className={cx(
        'border-b border-line/50 bg-transparent py-1 text-center text-base text-ink tabular-nums outline-none focus:border-amber',
        className,
      )}
    />
  )
}

/** Two-tap delete: first tap arms it, second confirms; disarms after 3s. */
function DeleteButton({ onConfirm, what, label, confirmLabel = 'Delete?' }) {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return undefined
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])

  if (armed) {
    return (
      <button
        type="button"
        onClick={onConfirm}
        className="min-h-11 shrink-0 border border-alert px-2 py-1 text-[9px] tracking-widest text-alert uppercase"
      >
        {confirmLabel}
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => setArmed(true)}
      aria-label={label ?? `Delete ${what}`}
      title={label ?? `Delete ${what}`}
      className="flex h-11 w-11 shrink-0 items-center justify-center text-line/60 hover:text-alert"
    >
      ✕
    </button>
  )
}

function AddButton({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full border border-dashed border-line/50 py-2 text-[10px] tracking-[0.2em] text-line uppercase hover:border-amber hover:text-amber"
    >
      + {children}
    </button>
  )
}

function SubmitButton({ children }) {
  return (
    <button
      type="submit"
      className="shrink-0 border border-line/50 px-3 py-2 text-[10px] tracking-[0.2em] text-line uppercase hover:border-amber hover:text-amber"
    >
      {children}
    </button>
  )
}

function Empty({ children }) {
  return <p className="py-2 text-xs text-line/50">{children}</p>
}

function cx(...parts) {
  return parts.filter(Boolean).join(' ')
}
