import { describe, expect, it } from 'vitest'
import type { MediaNode } from '@shared/types'
import {
  flatten,
  folderCompletion,
  neighbourMedia,
  nextCollapsedFolder,
  ROOT_KEY,
  searchMedia,
  type TreeMap
} from '../../src/renderer/lib/tree'

const folder = (id: string, name = id): MediaNode => ({ id, name, kind: 'folder' })
const media = (id: string, name = id): MediaNode => ({ id, name, kind: 'media', ext: 'mp4' })

const tree: TreeMap = {
  [ROOT_KEY]: [folder('intro', '01 Intro'), folder('adv', '02 Advanced'), media('r.mp4', 'root.mp4')],
  intro: [media('a.mp4', '01 welcome.mp4'), media('b.mp4', '02 setup.mp4')],
  adv: [media('c.mp4', '09 ninth.mp4'), media('d.mp4', '10 last.mp4')]
}

describe('flatten', () => {
  it('shows only children of expanded folders', () => {
    expect(flatten(tree, {}).map((r) => r.node.id)).toEqual(['intro', 'adv', 'r.mp4'])
  })

  it('descends in tree order with depth', () => {
    const rows = flatten(tree, { intro: true })
    expect(rows.map((r) => `${r.depth}:${r.node.id}`)).toEqual([
      '0:intro',
      '1:a.mp4',
      '1:b.mp4',
      '0:adv',
      '0:r.mp4'
    ])
  })
})

describe('neighbourMedia', () => {
  it('walks media rows in visible order, skipping folders', () => {
    const rows = flatten(tree, { intro: true, adv: true })
    expect(neighbourMedia(rows, 'b.mp4', 1)?.id).toBe('c.mp4')
    expect(neighbourMedia(rows, 'c.mp4', -1)?.id).toBe('b.mp4')
  })

  it('returns null at the ends', () => {
    const rows = flatten(tree, { intro: true })
    expect(neighbourMedia(rows, 'a.mp4', -1)).toBeNull()
    expect(neighbourMedia(rows, 'r.mp4', 1)).toBeNull()
  })

  it('returns null for an item that is not visible', () => {
    expect(neighbourMedia(flatten(tree, {}), 'a.mp4', 1)).toBeNull()
  })
})

describe('nextCollapsedFolder', () => {
  it('finds the folder to open when a folder runs out', () => {
    const rows = flatten(tree, { intro: true })
    expect(nextCollapsedFolder(rows, { intro: true }, 'b.mp4')?.id).toBe('adv')
  })

  it('skips folders that are already open', () => {
    const rows = flatten(tree, { intro: true, adv: true })
    expect(nextCollapsedFolder(rows, { intro: true, adv: true }, 'b.mp4')).toBeNull()
  })
})

describe('searchMedia', () => {
  it('matches loaded media case-insensitively and ignores folders', () => {
    expect(searchMedia(tree, 'WELCOME').map((n) => n.id)).toEqual(['a.mp4'])
    expect(searchMedia(tree, 'intro')).toEqual([])
  })

  it('returns nothing for an empty query', () => {
    expect(searchMedia(tree, '   ')).toEqual([])
  })
})

describe('folderCompletion', () => {
  it('counts watched descendants', () => {
    const watched = (id: string): boolean => id === 'a.mp4'
    expect(folderCompletion(tree, 'intro', watched)).toEqual({ done: 1, total: 2 })
    expect(folderCompletion(tree, 'adv', watched)).toEqual({ done: 0, total: 2 })
  })

  it('reports zero for folders whose children are not loaded', () => {
    expect(folderCompletion(tree, 'unloaded', () => true)).toEqual({ done: 0, total: 0 })
  })
})
