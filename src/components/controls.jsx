import { useEffect, useRef, useState } from 'react'

// Small shared controls, all at module scope (see UnitBox.jsx for why).

/**
 * Compact uppercase chip button. `as="label"` makes it wrap a hidden input.
 * `active` fills it amber; `tone="alert"` outlines it in the alert colour,
 * `tone="amber"` in amber (a count worth a look, not an alarm).
 *
 * `size`:
 *   'tap'      44px on a phone, 36px from sm up. The default: anything a
 *              thumb aims at on the toolbar, the bars, or a sheet.
 *   'compact'  36px, for the handful of chips that live INSIDE a unit box
 *              on the drawing, where three 44px targets do not fit a 160px
 *              column. Give those a negative margin so the row keeps its
 *              height.
 */
const CHIP_SIZE = {
  tap: 'min-h-11 sm:min-h-9 px-2.5',
  compact: 'min-h-9 px-1.5',
}

export function Chip({
  as: Tag = 'button',
  active = false,
  tone = 'line',
  size = 'tap',
  className,
  children,
  ...rest
}) {
  const look = active
    ? 'border-amber bg-amber text-sheet'
    : tone === 'alert'
      ? 'border-alert/60 text-alert hover:bg-alert/10'
      : tone === 'amber'
        ? 'border-amber/60 text-amber hover:bg-amber/10'
        : 'border-line/40 text-line hover:border-amber hover:text-amber'
  const extra = Tag === 'button' ? { type: 'button' } : {}
  return (
    <Tag
      {...extra}
      className={cx(
        'inline-flex cursor-pointer items-center gap-1 border py-1 text-[9px] tracking-[0.18em] uppercase select-none disabled:cursor-not-allowed disabled:opacity-40',
        CHIP_SIZE[size] ?? CHIP_SIZE.tap,
        look,
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  )
}

/**
 * Two-tap confirm chip: the first tap arms it, the second confirms.
 * It disarms itself after a few seconds so an armed chip is never left
 * lying around. `detail` names what is about to go — shown beside the chip
 * while it is armed, with longer to read it.
 */
export function TwoTapChip({ onConfirm, confirmLabel = 'Sure?', detail, size, children, className, ...rest }) {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return undefined
    const t = setTimeout(() => setArmed(false), detail ? 6000 : 3000)
    return () => clearTimeout(t)
  }, [armed, detail])

  const chip = (
    <Chip
      tone="alert"
      size={size}
      aria-pressed={armed}
      className={cx(armed && 'border-alert bg-alert/15', className)}
      onClick={() => {
        if (armed) {
          setArmed(false)
          onConfirm()
        } else {
          setArmed(true)
        }
      }}
      {...rest}
    >
      {armed ? confirmLabel : children}
    </Chip>
  )

  if (!detail) return chip
  return (
    <>
      {chip}
      {armed && (
        <span role="alert" className="max-w-full text-[9px] leading-snug text-alert normal-case">
          {detail}
        </span>
      )}
    </>
  )
}

/**
 * Modal sheet: bottom sheet on phones, right drawer from `sm` up. Escape and
 * the backdrop close it; the page behind stops scrolling while it is open.
 */
export function Sheet({ title, onClose, children, footer, wide = false }) {
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

  return (
    <>
      <div className="fixed inset-0 z-30 bg-sheet/60" onClick={onClose} aria-hidden />
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'animate-slide-up motion-reduce:animate-none fixed inset-x-0 bottom-0 z-40 flex max-h-[88dvh] flex-col border-t-2 border-amber bg-sheet shadow-2xl sm:animate-slide-in sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:max-w-full sm:border-t-0 sm:border-l-2',
          wide ? 'sm:w-[520px]' : 'sm:w-[440px]',
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line/40 px-4 py-3 sm:px-5">
          <h2 className="font-display truncate text-sm tracking-[0.25em] text-ink uppercase">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-line hover:text-amber"
          >
            ✕
          </button>
        </header>
        {/* focusin, not focus: the field that just gained focus is scrolled
            clear of the on-screen keyboard, which the viewport meta lets
            resize the page rather than shove it up */}
        <div
          onFocus={keepFocusedFieldVisible}
          className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-5"
        >
          {children}
        </div>
        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line/40 px-4 py-3 sm:px-5">
            {footer}
          </footer>
        )}
      </section>
    </>
  )
}

/**
 * A label that becomes an input in place: tap to edit, Enter or blur commits,
 * Escape cancels. Used for unit and floor labels while Build is on.
 *
 * Escape sets a ref before blurring, because the blur handler that follows
 * still closes over the old draft.
 */
export function InlineLabel({
  value,
  onCommit,
  placeholder = 'Name',
  ariaLabel,
  title = 'Rename',
  className,
  textClassName,
  inputClassName,
}) {
  const [draft, setDraft] = useState(null) // null = not editing
  const cancelled = useRef(false)
  const text = value ?? ''

  if (draft === null) {
    return (
      <button
        type="button"
        title={title}
        aria-label={ariaLabel}
        onClick={() => {
          cancelled.current = false
          setDraft(text)
        }}
        className={cx(
          'min-w-0 cursor-text text-left underline decoration-line/40 decoration-dashed underline-offset-4 hover:text-amber',
          className,
          textClassName,
        )}
      >
        {text || placeholder}
      </button>
    )
  }

  return (
    <input
      autoFocus
      type="text"
      value={draft}
      aria-label={ariaLabel}
      placeholder={placeholder}
      autoComplete="off"
      enterKeyHint="done"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur() // the blur commits
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancelled.current = true
          e.currentTarget.blur()
        }
      }}
      onBlur={() => {
        const next = draft.trim()
        setDraft(null)
        if (cancelled.current) {
          cancelled.current = false
          return
        }
        if (next !== text) onCommit(next)
      }}
      className={cx('min-w-0 border-b border-amber bg-transparent outline-none', className, inputClassName)}
    />
  )
}

/**
 * Bring the focused field into view inside a scrolling sheet. Runs on the
 * next frame so it measures after the keyboard has resized the viewport.
 * Exported for UnitPanel, which has a bottom sheet of its own.
 */
export function keepFocusedFieldVisible(e) {
  const el = e.target
  if (!el || typeof el.scrollIntoView !== 'function') return
  if (!el.matches?.('input, textarea, select')) return
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.scrollIntoView({ block: 'center' }))
  })
}

export function cx(...parts) {
  return parts.filter(Boolean).join(' ')
}
