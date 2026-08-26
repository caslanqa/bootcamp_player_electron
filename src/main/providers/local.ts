import { createReadStream, realpathSync, type Dirent } from 'node:fs'
import { readdir, stat as fsStat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import type { MediaNode } from '@shared/types'
import {
  compareNodes,
  extOf,
  isMediaFile,
  isSubtitleFile,
  subtitleLabelFor
} from '@shared/media'
import { ProviderError, type StorageProvider } from './types'

/**
 * Node ids are absolute paths. The stream server is reachable by anything on
 * localhost, so every id is checked to live under the configured root — without
 * that check this provider is an arbitrary-file-read hole.
 */
export class LocalProvider implements StorageProvider {
  private readonly root: string

  constructor(root: string) {
    this.root = safeResolve(root)
  }

  private assertInside(target: string): string {
    const t = safeResolve(target)
    const rel = relative(this.root, t)
    if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) {
      throw new ProviderError(`Path escapes source root: ${target}`, 403)
    }
    return t
  }

  async list(parentId?: string): Promise<MediaNode[]> {
    const dir = this.assertInside(parentId ?? this.root)
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (err) {
      throw new ProviderError(`Cannot read directory: ${dir} (${(err as Error).message})`, 404)
    }

    const nodes: MediaNode[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        nodes.push({ id: full, name: entry.name, kind: 'folder' })
      } else if (entry.isFile() && isMediaFile(entry.name)) {
        nodes.push({ id: full, name: entry.name, kind: 'media', ext: extOf(entry.name) })
      }
    }
    return nodes.sort(compareNodes)
  }

  async stat(id: string): Promise<MediaNode | null> {
    const path = this.assertInside(id)
    try {
      const s = await fsStat(path)
      const name = basename(path)
      return {
        id: path,
        name,
        kind: s.isDirectory() ? 'folder' : 'media',
        ext: s.isDirectory() ? undefined : extOf(name),
        size: s.isDirectory() ? undefined : s.size,
        modifiedAt: s.mtimeMs
      }
    } catch {
      return null
    }
  }

  async read(id: string, start?: number, end?: number): Promise<Readable> {
    const path = this.assertInside(id)
    return createReadStream(path, { start, end })
  }

  async findSubtitles(id: string): Promise<MediaNode[]> {
    const path = this.assertInside(id)
    const dir = dirname(path)
    const mediaName = basename(path)
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return []
    }
    return entries
      .filter((name) => isSubtitleFile(name) && subtitleLabelFor(mediaName, name) !== null)
      .sort()
      .map((name) => ({
        id: join(dir, name),
        name,
        kind: 'media' as const,
        ext: extOf(name)
      }))
  }

  localPath(id: string): string {
    return this.assertInside(id)
  }
}

/** realpath when it exists (defeats symlink escapes), plain resolve otherwise. */
function safeResolve(p: string): string {
  const abs = resolve(p)
  try {
    return realpathSync(abs)
  } catch {
    return abs
  }
}
