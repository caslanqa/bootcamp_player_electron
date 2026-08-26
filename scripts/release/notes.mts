#!/usr/bin/env node
/**
 * Print one release's CHANGELOG section on stdout — the body for `gh release create`.
 *
 *   node scripts/release/notes.ts 1.2.0
 *   node scripts/release/notes.ts v1.2.0    # leading v is fine
 *
 * Falls back to a one-line placeholder rather than failing the release job,
 * because a missing changelog entry is not a reason to withhold the binaries.
 */
import { existsSync, readFileSync } from 'node:fs'
import { extractSection } from './version.mts'

const raw = process.argv[2]
if (!raw) {
  console.error('usage: node scripts/release/notes.ts <version>')
  process.exit(1)
}

const version = raw.replace(/^v/, '')
const changelog = existsSync('CHANGELOG.md') ? readFileSync('CHANGELOG.md', 'utf8') : ''
const section = extractSection(changelog, version)

process.stdout.write(section || `Release ${version}. See the commit history for details.`)
process.stdout.write('\n')
