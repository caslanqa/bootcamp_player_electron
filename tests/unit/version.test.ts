import { describe, expect, it } from 'vitest'
import {
  bumpFor,
  bumpLockfile,
  extractSection,
  FIELD_SEP,
  nextVersion,
  parseCommit,
  parseLog,
  prependChangelog,
  RECORD_SEP,
  renderChangelog,
  type ParsedCommit
} from '../../scripts/release/version.mts'

const record = (hash: string, subject: string, body = ''): string =>
  [hash, subject, body].join(FIELD_SEP)

const commit = (over: Partial<ParsedCommit> = {}): ParsedCommit => ({
  hash: 'abcdef1234567890',
  type: 'feat',
  scope: null,
  breaking: false,
  subject: 'do a thing',
  ...over
})

describe('parseCommit', () => {
  it('reads type, scope and subject', () => {
    expect(parseCommit(record('abc123', 'feat(player): add mini player'))).toEqual({
      hash: 'abc123',
      type: 'feat',
      scope: 'player',
      breaking: false,
      subject: 'add mini player'
    })
  })

  it('treats a bang as breaking', () => {
    expect(parseCommit(record('abc', 'feat(ipc)!: rename progress channel'))?.breaking).toBe(true)
  })

  it('treats a BREAKING CHANGE footer as breaking', () => {
    const parsed = parseCommit(record('abc', 'fix(server): tighten token check', 'BREAKING CHANGE: urls change'))
    expect(parsed?.breaking).toBe(true)
    expect(parsed?.type).toBe('fix')
  })

  it('accepts the hyphenated footer spelling', () => {
    expect(parseCommit(record('abc', 'fix: x', 'BREAKING-CHANGE: y'))?.breaking).toBe(true)
  })

  it('ignores non-conventional subjects', () => {
    expect(parseCommit(record('abc', 'first commit'))).toBeNull()
    expect(parseCommit(record('abc', 'WIP: stuff'))).toBeNull()
    expect(parseCommit(record('abc', ''))).toBeNull()
  })
})

describe('parseLog', () => {
  it('splits records and drops the noise', () => {
    const log = [
      record('a1', 'feat: one'),
      record('b2', 'chore: housekeeping'),
      record('c3', 'not a conventional commit'),
      record('d4', 'fix(ui): two')
    ].join(RECORD_SEP)

    expect(parseLog(log).map((c) => `${c.type}:${c.subject}`)).toEqual([
      'feat:one',
      'chore:housekeeping',
      'fix:two'
    ])
  })

  it('handles an empty log', () => {
    expect(parseLog('')).toEqual([])
    expect(parseLog(RECORD_SEP + RECORD_SEP)).toEqual([])
  })
})

describe('bumpFor', () => {
  it('breaking beats everything', () => {
    expect(bumpFor([commit({ type: 'fix', breaking: true }), commit({ type: 'feat' })])).toBe('major')
  })

  it('feat means minor', () => {
    expect(bumpFor([commit({ type: 'docs' }), commit({ type: 'feat' })])).toBe('minor')
  })

  it('fix or perf means patch', () => {
    expect(bumpFor([commit({ type: 'fix' })])).toBe('patch')
    expect(bumpFor([commit({ type: 'perf' })])).toBe('patch')
  })

  it('chores and docs alone are not a release', () => {
    expect(bumpFor([commit({ type: 'docs' }), commit({ type: 'chore' })])).toBe('none')
    expect(bumpFor([])).toBe('none')
  })
})

describe('nextVersion', () => {
  it('bumps each level and zeroes the rest', () => {
    expect(nextVersion('1.4.7', 'major')).toBe('2.0.0')
    expect(nextVersion('1.4.7', 'minor')).toBe('1.5.0')
    expect(nextVersion('1.4.7', 'patch')).toBe('1.4.8')
    expect(nextVersion('1.4.7', 'none')).toBe('1.4.7')
  })

  it('crosses ten correctly', () => {
    expect(nextVersion('0.9.9', 'minor')).toBe('0.10.0')
  })

  it('rejects anything that is not plain semver', () => {
    expect(() => nextVersion('1.0.0-beta.1', 'patch')).toThrow(/plain semver/)
    expect(() => nextVersion('v1.0.0', 'patch')).toThrow(/plain semver/)
  })
})

describe('renderChangelog', () => {
  const commits = [
    commit({ hash: 'aaaaaaaaaa', type: 'feat', scope: 'drive', subject: 'add Drive source' }),
    commit({ hash: 'bbbbbbbbbb', type: 'fix', scope: 'media', subject: 'set -f mp4 explicitly' }),
    commit({ hash: 'cccccccccc', type: 'chore', subject: 'bump deps' }),
    commit({ hash: 'dddddddddd', type: 'feat', breaking: true, subject: 'drop legacy ipc' })
  ]

  it('groups by type, breaking changes first', () => {
    const out = renderChangelog('2.0.0', '2026-08-27', commits)
    expect(out.indexOf('Breaking changes')).toBeLessThan(out.indexOf('Features'))
    expect(out.indexOf('Features')).toBeLessThan(out.indexOf('Fixes'))
    expect(out).toContain('**drive:** add Drive source')
    expect(out).toContain('**BREAKING** drop legacy ipc')
  })

  it('omits types with no changelog section', () => {
    expect(renderChangelog('1.0.1', '2026-08-27', commits)).not.toContain('bump deps')
  })

  it('lists a breaking commit once, not twice', () => {
    const out = renderChangelog('2.0.0', '2026-08-27', commits)
    expect(out.match(/drop legacy ipc/g)).toHaveLength(1)
  })

  it('links commits and the compare range when a repo url is known', () => {
    const out = renderChangelog('1.1.0', '2026-08-27', commits, {
      repoUrl: 'https://github.com/caslanqa/bootcamp_player_electron',
      previousTag: 'v1.0.0'
    })
    expect(out).toContain('/compare/v1.0.0...v1.1.0')
    expect(out).toContain('([aaaaaaa](https://github.com/caslanqa/bootcamp_player_electron/commit/aaaaaaaaaa))')
  })

  it('says so when nothing user-facing landed', () => {
    expect(renderChangelog('1.0.1', '2026-08-27', [commit({ type: 'chore' })])).toContain(
      'No user-facing changes'
    )
  })
})

describe('prependChangelog', () => {
  it('keeps the header on top and pushes history down', () => {
    const existing = '# Changelog\n\n## 1.0.0 — 2026-01-01\n\n- old stuff\n'
    const out = prependChangelog(existing, '## 1.1.0 — 2026-08-27\n\n- new stuff\n')
    expect(out.startsWith('# Changelog\n')).toBe(true)
    expect(out.indexOf('1.1.0')).toBeLessThan(out.indexOf('1.0.0'))
    expect(out).toContain('- old stuff')
  })

  it('does not duplicate the header on a fresh file', () => {
    const out = prependChangelog('# Changelog\n', '## 1.0.0 — 2026-08-27\n\n- first\n')
    expect(out.match(/# Changelog/g)).toHaveLength(1)
  })

  it('keeps the whole preamble above the newest release', () => {
    const existing = [
      '# Changelog',
      '',
      '<!-- markdownlint-disable MD013 -->',
      '',
      'Generated by `npm run release`. Do not edit released sections.',
      '',
      '## 1.0.0 — 2026-01-01',
      '',
      '- old stuff',
      ''
    ].join('\n')

    const out = prependChangelog(existing, '## 1.1.0 — 2026-08-27\n\n- new stuff\n')
    // The note and the lint directive must not sink below the new section.
    expect(out.indexOf('Generated by')).toBeLessThan(out.indexOf('1.1.0'))
    expect(out.indexOf('markdownlint-disable')).toBeLessThan(out.indexOf('1.1.0'))
    expect(out.indexOf('1.1.0')).toBeLessThan(out.indexOf('1.0.0'))
    expect(out.match(/Generated by/g)).toHaveLength(1)
  })

  it('leaves no run of blank lines', () => {
    const out = prependChangelog(
      '# Changelog\n\n\n\n## 1.0.0 — 2026-01-01\n\n- old\n\n\n',
      '## 1.1.0 — 2026-08-27\n\n- new\n'
    )
    expect(out).not.toMatch(/\n{3}/)
    expect(out.endsWith('\n')).toBe(true)
  })
})

describe('extractSection', () => {
  const changelog = [
    '# Changelog',
    '',
    '## [1.1.0](x/compare/v1.0.0...v1.1.0) — 2026-08-27',
    '',
    '### Features',
    '',
    '- new thing',
    '',
    '## 1.0.0 — 2026-01-01',
    '',
    '- old thing',
    ''
  ].join('\n')

  it('returns just that release body', () => {
    const notes = extractSection(changelog, '1.1.0')
    expect(notes).toContain('- new thing')
    expect(notes).not.toContain('old thing')
    expect(notes.split('\n').some((line) => line.startsWith('## '))).toBe(false)
  })

  it('reads the last section too', () => {
    expect(extractSection(changelog, '1.0.0')).toBe('- old thing')
  })

  it('is not fooled by a version mentioned in a compare link', () => {
    // "## [1.1.0](x/compare/v1.0.0...v1.1.0)" mentions 1.0.0 but is not its section.
    expect(extractSection(changelog, '1.0.0')).not.toContain('new thing')
  })

  it('does not match a longer version that starts the same', () => {
    expect(extractSection('# Changelog\n\n## 1.0.01 — d\n\n- x\n', '1.0.0')).toBe('')
  })

  it('returns empty for an unknown version', () => {
    expect(extractSection(changelog, '9.9.9')).toBe('')
  })
})

describe('bumpLockfile', () => {
  const lock = JSON.stringify(
    {
      name: 'bootcamp_player_electron',
      version: '1.0.0',
      lockfileVersion: 3,
      packages: {
        '': { name: 'bootcamp_player_electron', version: '1.0.0', license: 'ISC' },
        'node_modules/react': { version: '19.2.8' }
      }
    },
    null,
    2
  )

  it('sets both version fields npm keeps', () => {
    const out = JSON.parse(bumpLockfile(lock, '1.2.1')) as {
      version: string
      packages: Record<string, { version: string }>
    }
    expect(out.version).toBe('1.2.1')
    expect(out.packages[''].version).toBe('1.2.1')
  })

  it('leaves dependency versions alone', () => {
    const out = JSON.parse(bumpLockfile(lock, '9.9.9')) as {
      packages: Record<string, { version: string }>
    }
    expect(out.packages['node_modules/react'].version).toBe('19.2.8')
  })

  it('keeps the rest of the document intact', () => {
    const out = JSON.parse(bumpLockfile(lock, '2.0.0')) as Record<string, unknown>
    expect(out.name).toBe('bootcamp_player_electron')
    expect(out.lockfileVersion).toBe(3)
  })

  it('writes npm formatting: two spaces and a trailing newline', () => {
    const out = bumpLockfile(lock, '1.2.1')
    expect(out.endsWith('\n')).toBe(true)
    expect(out).toContain('\n  "version": "1.2.1"')
  })

  it('tolerates a lockfile missing either field', () => {
    expect(JSON.parse(bumpLockfile('{"packages":{"":{}}}', '1.0.1'))).toEqual({
      packages: { '': {} }
    })
    expect(JSON.parse(bumpLockfile('{"version":"1.0.0"}', '1.0.1'))).toEqual({ version: '1.0.1' })
  })
})
