import type { MediaNode } from '@shared/types'

export const ROOT_KEY = '#root'

export type TreeMap = Record<string, MediaNode[]>

export interface FlatRow {
  node: MediaNode
  depth: number
  parentKey: string
}

/**
 * The sidebar's render order: depth-first over loaded children, descending only
 * into expanded folders. Also the playback order — "next" is literally the next
 * media row the user can see.
 */
export function flatten(
  tree: TreeMap,
  expanded: Record<string, boolean>,
  parentKey: string = ROOT_KEY,
  depth = 0
): FlatRow[] {
  const rows: FlatRow[] = []
  for (const node of tree[parentKey] ?? []) {
    rows.push({ node, depth, parentKey })
    if (node.kind === 'folder' && expanded[node.id]) {
      rows.push(...flatten(tree, expanded, node.id, depth + 1))
    }
  }
  return rows
}

export function mediaRows(rows: FlatRow[]): FlatRow[] {
  return rows.filter((r) => r.node.kind === 'media')
}

/** Neighbour media item, or null at the ends. */
export function neighbourMedia(
  rows: FlatRow[],
  currentId: string,
  direction: 1 | -1
): MediaNode | null {
  const media = mediaRows(rows)
  const index = media.findIndex((r) => r.node.id === currentId)
  if (index < 0) return null
  return media[index + direction]?.node ?? null
}

/**
 * First collapsed folder that comes after the current item in tree order.
 * Used to autoplay past the end of a folder without eagerly walking the
 * whole course tree up front.
 */
export function nextCollapsedFolder(
  rows: FlatRow[],
  expanded: Record<string, boolean>,
  currentId: string
): MediaNode | null {
  const index = rows.findIndex((r) => r.node.id === currentId)
  if (index < 0) return null
  for (const row of rows.slice(index + 1)) {
    if (row.node.kind === 'folder' && !expanded[row.node.id]) return row.node
  }
  return null
}

/** Case-insensitive substring match over every loaded media node. */
export function searchMedia(tree: TreeMap, query: string): MediaNode[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const seen = new Set<string>()
  const out: MediaNode[] = []
  for (const children of Object.values(tree)) {
    for (const node of children) {
      if (node.kind !== 'media' || seen.has(node.id)) continue
      if (node.name.toLowerCase().includes(needle)) {
        seen.add(node.id)
        out.push(node)
      }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** 0..1 completion for a folder, from the progress of its loaded media descendants. */
export function folderCompletion(
  tree: TreeMap,
  folderId: string,
  watched: (nodeId: string) => boolean
): { done: number; total: number } {
  let done = 0
  let total = 0
  const walk = (key: string): void => {
    for (const node of tree[key] ?? []) {
      if (node.kind === 'folder') walk(node.id)
      else {
        total += 1
        if (watched(node.id)) done += 1
      }
    }
  }
  walk(folderId)
  return { done, total }
}
