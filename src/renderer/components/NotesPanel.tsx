import { useState } from 'react'
import { formatTime } from '@shared/time'
import { usePlayer } from '../player-api'
import { useStore } from '../store'

/** Timestamped notes for the lesson on screen. */
export function NotesPanel(): React.JSX.Element | null {
  const player = usePlayer()
  const current = useStore((s) => s.current)
  const bookmarks = useStore((s) => s.bookmarks)
  const addBookmark = useStore((s) => s.addBookmark)
  const removeBookmark = useStore((s) => s.removeBookmark)
  const [note, setNote] = useState('')

  if (!current) return null

  return (
    <section className="notes" aria-label="Bookmarks and notes">
      <div className="notes-head">
        <h2>Bookmarks</h2>
        <span className="badge">{bookmarks.length}</span>
      </div>
      <form
        className="notes-form"
        onSubmit={(e) => {
          e.preventDefault()
          void addBookmark(player.time, note)
          setNote('')
        }}
      >
        <label className="sr-only" htmlFor="note-input">
          Note for {formatTime(player.time)}
        </label>
        <input
          id="note-input"
          data-testid="note-input"
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          placeholder={`Note at ${formatTime(player.time)}`}
        />
        <button type="submit" className="btn primary" data-testid="add-bookmark">
          Add at {formatTime(player.time)}
        </button>
      </form>
      <ul className="notes-list" data-testid="bookmark-list">
        {bookmarks.map((bookmark) => (
          <li key={bookmark.id}>
            <button
              type="button"
              className="icon-btn at"
              onClick={() => player.seek(bookmark.time)}
              aria-label={`Jump to ${formatTime(bookmark.time)}`}
            >
              {formatTime(bookmark.time)}
            </button>
            <p>{bookmark.note || '—'}</p>
            <button
              type="button"
              className="icon-btn"
              onClick={() => void removeBookmark(bookmark.id)}
              aria-label={`Delete bookmark at ${formatTime(bookmark.time)}`}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
