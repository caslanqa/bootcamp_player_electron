/**
 * Pure conventional-commit → semver logic. No git, no filesystem, so the rules
 * that decide a release number are unit-testable on their own.
 */

export type Bump = 'major' | 'minor' | 'patch' | 'none'

export interface ParsedCommit {
  hash: string
  type: string
  scope: string | null
  breaking: boolean
  subject: string
}

/** Record and field separators used by the `git log --format` in bump.ts. */
export const RECORD_SEP = String.fromCharCode(30)
export const FIELD_SEP = String.fromCharCode(31)

const HEADER = /^([a-z]+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/

/** Section order and headings in the changelog. Types absent here are omitted. */
const SECTIONS: Array<[string, string]> = [
  ['feat', 'Features'],
  ['fix', 'Fixes'],
  ['perf', 'Performance'],
  ['refactor', 'Refactoring'],
  ['docs', 'Documentation'],
  ['test', 'Tests'],
  ['build', 'Build'],
  ['ci', 'CI'],
  ['revert', 'Reverts']
]

/** One field-separated hash/subject/body record. Null for non-conventional subjects. */
export function parseCommit(record: string): ParsedCommit | null {
  const [hash = '', subject = '', body = ''] = record.split(FIELD_SEP)
  const match = HEADER.exec(subject.trim())
  if (!match) return null
  const [, type, scope, bang, text] = match
  return {
    hash: hash.trim(),
    type,
    scope: scope ? scope.trim() : null,
    breaking: bang === '!' || /^BREAKING[ -]CHANGE:/m.test(body),
    subject: text.trim()
  }
}

export function parseLog(log: string): ParsedCommit[] {
  return log
    .split(RECORD_SEP)
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map(parseCommit)
    .filter((commit): commit is ParsedCommit => commit !== null)
}

/**
 * Highest bump any commit demands. A `!` or `BREAKING CHANGE:` footer wins,
 * then feat, then fix/perf. Docs-and-chores-only means no release.
 */
export function bumpFor(commits: ParsedCommit[]): Bump {
  if (commits.some((c) => c.breaking)) return 'major'
  if (commits.some((c) => c.type === 'feat')) return 'minor'
  if (commits.some((c) => c.type === 'fix' || c.type === 'perf')) return 'patch'
  return 'none'
}

/**
 * Set the two `version` fields npm keeps in a lockfile: the root one and the
 * root package entry. Done by hand rather than through `npm version` so the
 * release job needs no node_modules and no npm behaviour to be true.
 *
 * Leaving the lockfile behind is not cosmetic: the next `npm install` rewrites
 * it, the tree goes dirty, and the release after that refuses to run.
 */
export function bumpLockfile(raw: string, version: string): string {
  const lock = JSON.parse(raw) as {
    version?: string
    packages?: Record<string, { version?: string }>
  }
  if (lock.version !== undefined) lock.version = version
  const root = lock.packages?.['']
  if (root?.version !== undefined) root.version = version
  // npm writes two-space JSON with a trailing newline.
  return `${JSON.stringify(lock, null, 2)}\n`
}

export function nextVersion(current: string, bump: Bump): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current.trim())
  if (!match) throw new Error(`Not a plain semver version: "${current}"`)
  const [major, minor, patch] = match.slice(1).map(Number)
  switch (bump) {
    case 'major':
      return `${major + 1}.0.0`
    case 'minor':
      return `${major}.${minor + 1}.0`
    case 'patch':
      return `${major}.${minor}.${patch + 1}`
    case 'none':
      return current
  }
}

function bullet(commit: ParsedCommit, repoUrl?: string): string {
  const scope = commit.scope ? `**${commit.scope}:** ` : ''
  const short = commit.hash.slice(0, 7)
  const link = repoUrl && short ? ` ([${short}](${repoUrl}/commit/${commit.hash}))` : ''
  const breaking = commit.breaking ? '**BREAKING** ' : ''
  return `- ${breaking}${scope}${commit.subject}${link}`
}

/** One changelog section for a release, newest-first bullets inside each type. */
export function renderChangelog(
  version: string,
  date: string,
  commits: ParsedCommit[],
  options: { repoUrl?: string; previousTag?: string } = {}
): string {
  const { repoUrl, previousTag } = options
  const heading =
    repoUrl && previousTag
      ? `## [${version}](${repoUrl}/compare/${previousTag}...v${version}) — ${date}`
      : `## ${version} — ${date}`

  const lines: string[] = [heading, '']

  const breaking = commits.filter((c) => c.breaking)
  if (breaking.length > 0) {
    lines.push('### ⚠ Breaking changes', '')
    for (const commit of breaking) lines.push(bullet(commit, repoUrl))
    lines.push('')
  }

  for (const [type, title] of SECTIONS) {
    const group = commits.filter((c) => c.type === type && !c.breaking)
    if (group.length === 0) continue
    lines.push(`### ${title}`, '')
    for (const commit of group) lines.push(bullet(commit, repoUrl))
    lines.push('')
  }

  if (lines.length === 2) lines.push('_No user-facing changes._', '')
  return lines.join('\n')
}

/**
 * Insert a new section above the existing releases, below the file's preamble —
 * the title, the "generated by" note and any lint directives. Treating only the
 * `# Changelog` line as the preamble would bury that text under every release.
 */
export function prependChangelog(existing: string, section: string): string {
  const lines = existing.split('\n')
  const firstRelease = lines.findIndex((line) => line.startsWith('## '))

  const preamble = (firstRelease < 0 ? lines : lines.slice(0, firstRelease))
    .join('\n')
    .trimEnd()
  const releases = firstRelease < 0 ? '' : lines.slice(firstRelease).join('\n').trim()

  return `${preamble || '# Changelog'}\n\n${section.trim()}\n\n${releases}`.trimEnd() + '\n'
}

/**
 * True when the heading *is* this release, not merely mentions it. A substring
 * test would match "## [1.1.0](…/compare/v1.0.0...v1.1.0)" when asked for 1.0.0
 * and put the wrong notes on a release.
 */
function isHeadingFor(line: string, version: string): boolean {
  if (!line.startsWith('## ')) return false
  const rest = line.slice(3).trimStart()
  const body = rest.startsWith('[') ? rest.slice(1) : rest
  if (!body.startsWith(version)) return false
  // Reject 1.0.01 / 1.0.0.1 style near-misses.
  return !/^[\d.]/.test(body.slice(version.length))
}

/** Pull one release's notes back out — used as the GitHub Release body. */
export function extractSection(changelog: string, version: string): string {
  const lines = changelog.split('\n')
  const start = lines.findIndex((line) => isHeadingFor(line, version))
  if (start < 0) return ''
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) {
      end = i
      break
    }
  }
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim()
}
