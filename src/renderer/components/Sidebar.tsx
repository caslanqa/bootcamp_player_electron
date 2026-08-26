import { useMemo } from 'react'
import type { MediaNode } from '@shared/types'
import { useStore } from '../store'
import { flatten, folderCompletion, ROOT_KEY, searchMedia } from '../lib/tree'

export function Sidebar(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const tree = useStore((s) => s.tree)
  const expanded = useStore((s) => s.expanded)
  const progress = useStore((s) => s.progress)
  const loading = useStore((s) => s.loading)
  const query = useStore((s) => s.query)
  const current = useStore((s) => s.current)
  const selectSource = useStore((s) => s.selectSource)
  const toggleFolder = useStore((s) => s.toggleFolder)
  const play = useStore((s) => s.play)

  const rows = useMemo(() => flatten(tree, expanded), [tree, expanded])
  const matches = useMemo(() => searchMedia(tree, query), [tree, query])
  const searching = query.trim().length > 0

  const watched = (id: string): boolean => progress[id]?.watched === true

  const renderMedia = (node: MediaNode, depth: number): React.JSX.Element => {
    const entry = progress[node.id]
    const percent =
      entry && entry.duration > 0 ? Math.min(100, (entry.position / entry.duration) * 100) : 0
    return (
      <li key={node.id}>
        <button
          type="button"
          className={`row${watched(node.id) ? ' watched' : ''}`}
          style={{ paddingLeft: 10 + depth * 16 }}
          aria-current={current?.node.id === node.id}
          onClick={() => void play(node)}
          data-testid="media-row"
          data-name={node.name}
        >
          <span className="kind" aria-hidden="true">
            {watched(node.id) ? '' : '▸'}
          </span>
          {watched(node.id) ? (
            <span className="check" aria-label="Watched">
              ✓
            </span>
          ) : null}
          <span className="label">{node.name}</span>
          {percent > 0 && !watched(node.id) ? (
            <span className="mini-bar" aria-hidden="true">
              <i style={{ width: `${percent}%` }} />
            </span>
          ) : null}
        </button>
      </li>
    )
  }

  return (
    <nav className="sidebar" aria-label="Playlist">
      <div className="sidebar-head">
        <label className="sr-only" htmlFor="source-select">
          Data source
        </label>
        <select
          id="source-select"
          data-testid="source-select"
          value={settings.activeSourceId ?? ''}
          onChange={(e) => void selectSource(e.currentTarget.value)}
          disabled={settings.sources.length === 0}
        >
          {settings.sources.length === 0 ? <option value="">No sources yet</option> : null}
          {settings.sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </select>
      </div>

      {settings.sources.length === 0 ? (
        <p className="empty">
          No data source configured. Open Settings and add a local course folder or a Google Drive
          folder.
        </p>
      ) : searching ? (
        <ul className="tree" data-testid="tree">
          {matches.length === 0 ? (
            <li className="empty">
              No loaded lesson matches “{query}”. Expand more folders to widen the search.
            </li>
          ) : (
            matches.map((node) => renderMedia(node, 0))
          )}
        </ul>
      ) : (
        <ul className="tree" data-testid="tree">
          {loading[ROOT_KEY] ? <li className="empty">Loading…</li> : null}
          {!loading[ROOT_KEY] && rows.length === 0 ? (
            <li className="empty">This folder has no playable media.</li>
          ) : null}
          {rows.map(({ node, depth }) => {
            if (node.kind === 'media') return renderMedia(node, depth)
            const { done, total } = folderCompletion(tree, node.id, watched)
            return (
              <li key={node.id}>
                <button
                  type="button"
                  className="row"
                  style={{ paddingLeft: 10 + depth * 16 }}
                  aria-expanded={expanded[node.id] === true}
                  onClick={() => void toggleFolder(node)}
                  data-testid="folder-row"
                  data-name={node.name}
                >
                  <span className="caret" aria-hidden="true">
                    ▶
                  </span>
                  <span className="label">{node.name}</span>
                  {total > 0 ? (
                    <span className="badge">
                      {done}/{total}
                    </span>
                  ) : null}
                  {loading[node.id] ? <span className="badge">…</span> : null}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </nav>
  )
}
