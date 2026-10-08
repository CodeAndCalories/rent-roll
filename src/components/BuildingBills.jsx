import { useEffect, useRef, useState } from 'react'
import { formatCents, formatDollars, toAmount, toPercent } from '../data/schema.js'
import { propertyBillsMonthly } from '../data/totals.js'
import { LOAN_MAX_MONTHS, escrowOverlap, escrowSplit, hasLoan, loanCheck, loanSummary } from '../data/loans.js'
import { monthLabel } from '../lib/months.js'
import { RentInput } from './UnitBox.jsx'
import { AddButton, BillRow, DateInput, Empty, Field, NumberField } from './UnitPanel.jsx'
import { Chip, Sheet, TwoTapChip, cx } from './controls.jsx'

// All components at module scope (see UnitBox.jsx for why).
//
// One building's own bills — mortgage, taxes, insurance, water — in the
// same rows the unit panel uses. These ARE property.bills: the four every
// template seeds are edited in place, never copied. The figure on top is
// propertyBillsMonthly, the very function computeTotals adds up, so this
// sheet and the title block cannot disagree.
//
// One bill per building may carry loan terms. From them the sheet shows an
// ESTIMATE (loans.js) — P+I, payments made and left, balance, interest to
// date, payoff, what extra principal changes — computed on every render
// and never stored. The bill's amount stays what was typed; a difference
// from P+I is shown as "escrow / other", not corrected.

/**
 * props
 *   property  the building (from what the sheet shows: actual or a scenario)
 *   onBill    (billId, patch) => void        ops.patchPropertyBill
 *   onAdd     () => void                      ops.addPropertyBill
 *   onRemove  (billId) => void                ops.removePropertyBill
 *   onLoan    (billId, terms | null) => void  ops.setBillLoan
 *   onClose   () => void
 *   focusBillId  the bill tapped in the expenses summary: scrolled to and
 *                outlined when the sheet opens
 */
export default function BuildingBills({ property, onBill, onAdd, onRemove, onLoan, onClose, focusBillId = null }) {
  const monthly = propertyBillsMonthly(property)
  const bills = property.bills ?? []
  const overlap = escrowOverlap(property)
  const focusRef = useRef(null)

  // once, on open: bring the tapped bill into view
  useEffect(() => {
    focusRef.current?.scrollIntoView?.({ block: 'center' })
  }, [])

  return (
    <Sheet
      title={`Bills · ${property.name || 'Building'}`}
      onClose={onClose}
      footer={<Chip onClick={onClose}>Done</Chip>}
    >
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[9px] tracking-[0.2em] text-line/70 uppercase">Monthly equivalent</span>
          <span className="text-lg text-ink tabular-nums">
            {formatDollars(monthly)}
            <span className="text-[10px] text-line/70"> / mo</span>
          </span>
        </div>
        <p className="text-[10px] leading-relaxed text-line/60">
          This building's own costs. Yearly bills count as a twelfth a month and one-time bills not at all —
          the same figure the title block adds up.
        </p>

        {bills.length === 0 && <Empty>No bills for this building.</Empty>}

        {bills.map((b) => (
          <div
            key={b.id}
            ref={b.id === focusBillId ? focusRef : null}
            className={cx(b.id === focusBillId && 'outline outline-1 outline-offset-2 outline-amber')}
          >
            <BillRow bill={b} onChange={(patch) => onBill(b.id, patch)} onDelete={() => onRemove(b.id)}>
              <LoanBlock bill={b} property={property} onLoan={(terms) => onLoan(b.id, terms)} />
              {hasLoan(b) && overlap.length > 0 && <EscrowNote loanBill={b} overlap={overlap} />}
            </BillRow>
          </div>
        ))}

        <AddButton onClick={onAdd}>Add bill</AddButton>
      </div>
    </Sheet>
  )
}

/**
 * A quiet note, never a block: a loan payment that includes escrow already
 * pays the taxes and insurance entered as their own bills here.
 */
export function EscrowNote({ loanBill, overlap }) {
  const names = overlap.map((b) => b.label || 'a bill')
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return (
    <p className="text-[10px] leading-relaxed text-line/60">
      Note: if your {loanBill.label || 'loan'} payment includes escrow, it may already cover {list}. Counting
      both would count them twice — your call; nothing here changes either.
    </p>
  )
}

// ---------------------------------------------------------------------------
// loan terms and the estimate
// ---------------------------------------------------------------------------

/** Under a bill: its loan terms and estimate, or the way to add them. */
function LoanBlock({ bill, property, onLoan }) {
  if (!hasLoan(bill)) {
    // one loan per building: once another bill holds it, this one offers nothing
    if (!loanCheck(property, bill.id).ok) return null
    return (
      <button
        type="button"
        onClick={() => onLoan({ termMonths: 360 })}
        title="Enter the loan's terms to see an estimate of P+I, balance, and payoff"
        className="min-h-11 text-[9px] tracking-[0.2em] text-line/60 uppercase underline decoration-dashed underline-offset-4 hover:text-amber sm:min-h-8"
      >
        + Loan terms
      </button>
    )
  }

  const loan = bill.loan
  const set = (terms) => onLoan(terms)
  const years = loan.termMonths > 0 ? loan.termMonths / 12 : 0

  return (
    <div className="space-y-3 border-t border-dashed border-line/40 pt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] tracking-[0.2em] text-amber uppercase">Loan terms</span>
        <TwoTapChip
          onConfirm={() => onLoan(null)}
          confirmLabel="Remove terms?"
          title="Takes the loan terms off this bill; its amount stays"
        >
          Remove terms
        </TwoTapChip>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Original principal">
          <RentInput
            value={loan.originalPrincipal}
            onCommit={(originalPrincipal) => set({ originalPrincipal })}
            ariaLabel="Original principal"
          />
        </Field>
        <Field label="Rate / yr">
          <PercentInput value={loan.annualRatePercent} onCommit={(annualRatePercent) => set({ annualRatePercent })} />
        </Field>
        <Field label={years > 0 ? `Term · ${trimNumber(years)} yr` : 'Term'}>
          <div className="flex items-baseline gap-1.5">
            <NumberField
              value={loan.termMonths}
              min={1}
              max={LOAN_MAX_MONTHS}
              onCommit={(termMonths) => set({ termMonths })}
              ariaLabel="Term in months"
              className="w-16"
            />
            <span className="text-[9px] tracking-widest text-line/60 uppercase">months</span>
          </div>
        </Field>
        <Field label="First payment">
          <DateInput
            value={loan.firstPaymentDate}
            onChange={(firstPaymentDate) => set({ firstPaymentDate })}
            ariaLabel="First payment date"
          />
        </Field>
        <Field label="Extra principal / mo">
          <RentInput
            value={loan.extraMonthlyPrincipal}
            onCommit={(extraMonthlyPrincipal) => set({ extraMonthlyPrincipal })}
            ariaLabel="Extra principal per month"
          />
        </Field>
        {loan.extraMonthlyPrincipal > 0 && (
          <Field label="Extra from">
            <DateInput
              value={loan.extraStartDate ?? null}
              onChange={(extraStartDate) => set({ extraStartDate })}
              ariaLabel="Extra principal goes in with payments due on or after"
            />
            {!loan.extraStartDate && (
              <p className="mt-0.5 text-[9px] leading-snug text-line/50">From the first payment</p>
            )}
          </Field>
        )}
      </div>

      <LoanEstimate bill={bill} />
    </div>
  )
}

/**
 * The estimate. Everything here is computed from the terms on this render
 * and never stored; the bill's amount is never touched.
 */
function LoanEstimate({ bill }) {
  const s = loanSummary(bill.loan, new Date())

  if (!s.ok) {
    return (
      <p className="text-[10px] leading-relaxed text-line/60">
        Enter {s.missing.join(' and ')} to see the estimate.
      </p>
    )
  }

  const split = escrowSplit(bill, s)

  return (
    <div className="border border-line/30 bg-line/5 p-2">
      <div className="text-[9px] tracking-[0.2em] text-line/70 uppercase">Estimate</div>
      <div className="mt-1.5 space-y-1 text-xs">
        <Row label="Principal + interest" value={`${formatCents(s.payment)} / mo`} strong />
        {toAmount(bill.amount) === 0 ? (
          <Row
            label="Your amount"
            value="not entered"
            note="The totals count the amount you type above, not this estimate."
          />
        ) : (
          split.differs && (
            <>
              <Row label="Your amount" value={`${formatCents(split.typed)} / mo`} />
              <Row
                label="Escrow / other"
                value={`${split.difference < 0 ? '−' : ''}${formatCents(Math.abs(split.difference))} / mo`}
                note={split.difference < 0 ? 'Your amount is less than the computed P+I.' : null}
              />
            </>
          )
        )}

        {s.dated ? (
          <>
            <Row
              label="Payments"
              value={s.remaining === 0 ? `all ${s.count} made` : `${s.made} made · ${s.remaining} left`}
            />
            <Row label="Balance now" value={formatCents(s.balance)} />
            <Row label="Interest paid to date" value={formatCents(s.interestToDate)} />
            <Row label="Payoff" value={monthLabel(s.payoffDate.slice(0, 7))} />
          </>
        ) : (
          <p className="text-[10px] leading-relaxed text-line/60">
            Add the first payment date for payments made, the balance, and the payoff date.
          </p>
        )}

        {s.extra && (
          <div className="mt-1.5 border-t border-line/20 pt-1.5">
            <div className="text-[9px] tracking-[0.2em] text-line/70 uppercase">
              With {formatCents(s.extra.monthly)} / mo extra principal ·{' '}
              {s.extra.fromFirst
                ? 'from the first payment'
                : s.extra.startDate
                  ? `from ${monthLabel(s.extra.startDate.slice(0, 7))}`
                  : 'starting after the last payment'}
            </div>
            <Row
              label="Payoff"
              value={
                s.dated
                  ? `${monthLabel(s.payoffDate.slice(0, 7))} instead of ${monthLabel(s.extra.standardPayoffDate.slice(0, 7))}`
                  : `${s.count} payments instead of ${s.extra.standardCount}`
              }
            />
            <Row label="Sooner by" value={`${s.extra.monthsSaved} ${s.extra.monthsSaved === 1 ? 'month' : 'months'}`} />
            <Row label="Interest saved" value={formatCents(s.extra.interestSaved)} />
          </div>
        )}
      </div>
      <p className="mt-2 text-[9px] leading-relaxed text-line/50">
        Estimate only: standard amortization from the terms above, interest charged monthly and rounded to the
        cent{s.extra ? `, the extra principal ${extraWhen(s.extra)}` : ''}. Payments count when due on or before
        today. Not a lender statement.
      </p>
    </div>
  )
}

function Row({ label, value, note, strong = false }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[9px] tracking-[0.16em] text-line/70 uppercase">{label}</span>
        <span className={cx('text-right tabular-nums', strong ? 'text-sm text-ink' : 'text-ink')}>{value}</span>
      </div>
      {note && <p className="text-[9px] leading-snug text-line/50">{note}</p>}
    </div>
  )
}

/** A percentage with a local draft, committed through toPercent ("6.5" or "6.5%"). */
function PercentInput({ value, onCommit }) {
  const [draft, setDraft] = useState(null) // null = show the stored value
  const shown = draft ?? (value ? String(value) : '')
  return (
    <label className="flex min-w-0 items-baseline gap-1 border-b border-line/50 focus-within:border-amber">
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        placeholder="0"
        aria-label="Annual interest rate, percent"
        value={shown}
        onFocus={() => setDraft(value ? String(value) : '')}
        onChange={(e) => {
          setDraft(e.target.value)
          onCommit(toPercent(e.target.value))
        }}
        onBlur={() => setDraft(null)}
        className="w-full min-w-0 bg-transparent text-base leading-tight text-ink tabular-nums outline-none placeholder:text-line/30 sm:text-sm"
      />
      <span className="text-sm text-line/70">%</span>
    </label>
  )
}

/** When the estimate assumes the extra principal goes in, for the footnote. */
function extraWhen(extra) {
  if (extra.fromFirst) return 'assumed with every payment from the first'
  if (extra.startDate) return `assumed with every payment from the one due ${extra.startDate}`
  return 'starting after the last payment, so it changes nothing'
}

/** 30 -> "30", 7.5 -> "7.5", 2.333… -> "2.33". */
function trimNumber(n) {
  return String(Math.round(n * 100) / 100)
}
