import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JsonStore, libraryKey, makeProgressEntry } from '../../src/main/store'

const scratch = (): string => mkdtempSync(join(tmpdir(), 'bootcamp-store-'))

describe('JsonStore', () => {
  it('starts from defaults when the file is missing', () => {
    const store = new JsonStore(join(scratch(), 'x.json'), { a: 1, b: 'two' }, 0)
    expect(store.get()).toEqual({ a: 1, b: 'two' })
  })

  it('writes atomically on flush and reloads', () => {
    const file = join(scratch(), 'settings.json')
    const store = new JsonStore(file, { volume: 0.5, theme: 'system' }, 0)
    store.set({ volume: 0.9 })
    store.flush()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ volume: 0.9, theme: 'system' })

    const reopened = new JsonStore(file, { volume: 0.5, theme: 'system' }, 0)
    expect(reopened.get().volume).toBe(0.9)
  })

  it('fills in keys added after the file was written', () => {
    const file = join(scratch(), 'old.json')
    writeFileSync(file, JSON.stringify({ volume: 0.3 }), 'utf8')
    const store = new JsonStore(file, { volume: 0.5, newFlag: true }, 0)
    expect(store.get()).toEqual({ volume: 0.3, newFlag: true })
  })

  it('falls back to defaults on corrupt JSON instead of throwing', () => {
    const file = join(scratch(), 'broken.json')
    writeFileSync(file, '{ not json', 'utf8')
    expect(new JsonStore(file, { ok: true }, 0).get()).toEqual({ ok: true })
  })

  it('debounces writes but flush() is immediate', async () => {
    const file = join(scratch(), 'debounced.json')
    const store = new JsonStore(file, { n: 0 }, 50)
    store.set({ n: 1 })
    expect(() => readFileSync(file, 'utf8')).toThrow()
    await new Promise((r) => setTimeout(r, 90))
    expect(JSON.parse(readFileSync(file, 'utf8')).n).toBe(1)
  })
})

describe('libraryKey', () => {
  it('namespaces by source so identical filenames do not collide', () => {
    expect(libraryKey('s1', '/a/b.mp4')).not.toBe(libraryKey('s2', '/a/b.mp4'))
  })
})

describe('makeProgressEntry', () => {
  it('marks watched past the ratio', () => {
    expect(makeProgressEntry(95, 100, 0.92).watched).toBe(true)
    expect(makeProgressEntry(50, 100, 0.92).watched).toBe(false)
  })

  it('never un-watches an item the user already finished', () => {
    const previous = makeProgressEntry(99, 100, 0.92)
    expect(makeProgressEntry(2, 100, 0.92, previous).watched).toBe(true)
  })

  it('clamps the position into the duration', () => {
    expect(makeProgressEntry(150, 100, 0.92).position).toBe(100)
    expect(makeProgressEntry(-5, 100, 0.92).position).toBe(0)
  })

  it('tolerates an unknown duration', () => {
    const entry = makeProgressEntry(12, NaN, 0.92)
    expect(entry.duration).toBe(0)
    expect(entry.watched).toBe(false)
    expect(entry.position).toBe(12)
  })
})
