import { useEffect, useState } from 'react'

// Small shared controls, all at module scope (see UnitBox.jsx for why).

/**
 * Compact uppercase chip button. `as="label"` makes it wrap a hidden input.
 * `active` fills it amber; `tone="alert"` outlines it in the alert colour.
 */
export function Chip({ as: Tag = 'button', active = false, tone = 'line', className, children, ...rest }) {
  const look = active
    ? 'border-amber bg-amber text-sheet'
    : tone === 'alert'
      ? 'border-alert/60 text-alert hover:bg-alert/10'
      : 'border-line/40 text-line hover:border-amber hover:text-amber'
  const extra = Tag === 'button' ? { type: 'button' } : {}
  return (
    <Tag
      {...extra}
      className={cx(
        'inline-flex min-h-8 cursor-pointer items-center gap-1 border px-2 py-1 text-[9px] tracking-[0.18em] uppercase select-none',
        look,
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  )
}

/** Two-tap confirm chip: first tap arms it, second confirms; disarms after 3s. */
export function TwoTapChip({ onConfirm, confirmLabel = 'Sure?', children, className, ...rest }) {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return undefined
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])

  return (
    <Chip
      tone="alert"
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
}

export function cx(...parts) {
  return parts.filter(Boolean).join(' ')
}
