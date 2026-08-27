import { describe, expect, it } from 'vitest'
import type { AccessEntry } from '@shared/types'
import { looksLikeEmail, sortAccess, toAccessEntry } from '../../src/main/drive-admin'

describe('looksLikeEmail', () => {
  it('accepts ordinary addresses', () => {
    expect(looksLikeEmail('student@example.com')).toBe(true)
    expect(looksLikeEmail('  first.last+tag@sub.example.co.uk  ')).toBe(true)
  })

  it('rejects the usual typos', () => {
    expect(looksLikeEmail('')).toBe(false)
    expect(looksLikeEmail('student')).toBe(false)
    expect(looksLikeEmail('student@example')).toBe(false)
    expect(looksLikeEmail('student @example.com')).toBe(false)
    expect(looksLikeEmail('a@b@c.com')).toBe(false)
  })
})

describe('toAccessEntry', () => {
  it('flags the owner and the signed-in account', () => {
    const entry = toAccessEntry(
      { id: 'p1', type: 'user', role: 'owner', emailAddress: 'Me@Example.com', displayName: 'Me' },
      'me@example.com'
    )
    expect(entry).toEqual({
      id: 'p1',
      email: 'Me@Example.com',
      name: 'Me',
      role: 'owner',
      isOwner: true,
      isSelf: true
    })
  })

  it('copes with a permission that carries no address', () => {
    const entry = toAccessEntry({ id: 'p2', type: 'anyone', role: 'reader' }, 'me@example.com')
    expect(entry).toMatchObject({ email: null, name: null, isOwner: false, isSelf: false })
  })

  it('is not self when nobody is signed in', () => {
    const entry = toAccessEntry({ id: 'p3', type: 'user', role: 'reader', emailAddress: 'a@b.com' }, null)
    expect(entry.isSelf).toBe(false)
  })
})

describe('sortAccess', () => {
  const entry = (over: Partial<AccessEntry>): AccessEntry => ({
    id: 'x',
    email: 'x@example.com',
    name: null,
    role: 'reader',
    isOwner: false,
    isSelf: false,
    ...over
  })

  it('puts the owner first, then sorts by display name', () => {
    const sorted = sortAccess([
      entry({ id: '3', name: 'Zoe' }),
      entry({ id: '1', name: 'Owner', isOwner: true, role: 'owner' }),
      entry({ id: '2', name: 'Ada' })
    ])
    expect(sorted.map((e) => e.id)).toEqual(['1', '2', '3'])
  })

  it('falls back to the email when there is no name', () => {
    const sorted = sortAccess([
      entry({ id: 'b', email: 'b@example.com' }),
      entry({ id: 'a', email: 'a@example.com' })
    ])
    expect(sorted.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('does not mutate its input', () => {
    const input = [entry({ id: 'b', name: 'B' }), entry({ id: 'a', name: 'A' })]
    sortAccess(input)
    expect(input.map((e) => e.id)).toEqual(['b', 'a'])
  })
})
