// All components at module scope (see UnitBox.jsx for why).

/**
 * Quiet proof that the write landed: it appears next to the header after a
 * write and fades on its own. A failure says what went wrong plainly and
 * stays until a write succeeds.
 *
 * There is no save button anywhere in this app — data is written on every
 * change (see the save effect in App.jsx). This only reports what happened.
 */
export default function SaveState({ savedAt, error }) {
  if (error) {
    return (
      <span role="status" className="min-w-0 truncate text-[10px] text-alert" title={error}>
        ● Not saved — {error}
      </span>
    )
  }
  if (!savedAt) return null
  return (
    <span
      key={savedAt}
      role="status"
      className="animate-save-flash motion-reduce:animate-none text-[10px] tracking-[0.2em] text-line/70 uppercase"
    >
      Saved
    </span>
  )
}
