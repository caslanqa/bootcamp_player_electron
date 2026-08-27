#!/usr/bin/env node
/**
 * Cut a release from conventional commits: decide the bump, write package.json
 * and CHANGELOG.md, commit and tag. Never pushes — that stays a human decision.
 *
 *   node scripts/release/bump.ts                # bump derived from commits
 *   node scripts/release/bump.ts --minor        # force a level
 *   node scripts/release/bump.ts --dry-run      # print, change nothing
 *
 * Run by hand; the tag push is what triggers .github/workflows/release.yml.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  bumpFor,
  bumpLockfile,
  FIELD_SEP,
  nextVersion,
  parseLog,
  prependChangelog,
  RECORD_SEP,
  renderChangelog,
  type Bump
} from './version.mts'

const CHANGELOG = 'CHANGELOG.md'
const LOCKFILE = 'package-lock.json'

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

/** For probes that are expected to fail (no tags yet, tag absent) — keeps git's
 * "fatal:" chatter off the console. */
function gitOrNull(...args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return null
  }
}

function fail(message: string): never {
  console.error(`✖ ${message}`)
  process.exit(1)
}

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const allowDirty = args.includes('--allow-dirty')
const forced = (['major', 'minor', 'patch'] as const).find((level) =>
  args.includes(`--${level}`)
)

const dirty = git('status', '--porcelain')
if (dirty && !allowDirty && !dryRun) {
  fail('Working tree is not clean. Commit or stash first (or pass --allow-dirty).')
}

const pkgRaw = readFileSync('package.json', 'utf8')
const pkg = JSON.parse(pkgRaw) as { version: string }
const previousTag = gitOrNull('describe', '--tags', '--abbrev=0')

// First release: everything in history counts.
const range = previousTag ? `${previousTag}..HEAD` : 'HEAD'
const log = git('log', range, `--format=%H${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`)
const commits = parseLog(log)

const bump: Bump = forced ?? bumpFor(commits)
if (bump === 'none') {
  console.log(
    `Nothing to release: ${commits.length} conventional commit(s) since ${previousTag ?? 'the first commit'}, none of them feat/fix/perf/breaking.`
  )
  console.log('Force one with --patch, --minor or --major.')
  process.exit(0)
}

const version = nextVersion(pkg.version, bump)
const tag = `v${version}`
if (gitOrNull('rev-parse', '--verify', `refs/tags/${tag}`)) {
  fail(`Tag ${tag} already exists.`)
}

const remote = gitOrNull('remote', 'get-url', 'origin')
const repoUrl = remote
  ? remote.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '')
  : undefined

// Local date, not UTC: the changelog reads to whoever cut the release.
const date = new Date().toLocaleDateString('en-CA')
const section = renderChangelog(version, date, commits, {
  repoUrl,
  previousTag: previousTag ?? undefined
})

console.log(`${pkg.version} → ${version}  (${bump}, from ${commits.length} commit(s))\n`)
console.log(section)

if (dryRun) {
  console.log('--dry-run: nothing written.')
  process.exit(0)
}

writeFileSync('package.json', pkgRaw.replace(/"version": ".*?"/, `"version": "${version}"`))

// The lockfile carries the version too. Leaving it behind means the next
// `npm install` rewrites it, the tree goes dirty, and the release after that
// refuses to run.
if (existsSync(LOCKFILE)) {
  writeFileSync(LOCKFILE, bumpLockfile(readFileSync(LOCKFILE, 'utf8'), version))
}
const existing = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, 'utf8') : '# Changelog\n'
writeFileSync(CHANGELOG, prependChangelog(existing, section))

git('add', 'package.json', LOCKFILE, CHANGELOG)
git('commit', '-m', `chore(release): ${tag}`)
git('tag', '-a', tag, '-m', tag)

console.log(`\n✔ Committed and tagged ${tag}.`)
console.log(`  Push to build and publish:  git push --follow-tags origin main`)
