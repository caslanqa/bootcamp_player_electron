import { Readable } from 'node:stream'
import type { MediaNode } from '@shared/types'
import { compareNodes, extOf, isMediaFile, isSubtitleFile, subtitleLabelFor } from '@shared/media'
import { ProviderError, type StorageProvider } from './types'

const API = 'https://www.googleapis.com/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const FIELDS = 'id,name,mimeType,size,modifiedTime'

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  size?: string
  modifiedTime?: string
}

/** Injected so tests can drive the provider without a real Google account. */
export type TokenProvider = (forceRefresh?: boolean) => Promise<string>

/**
 * Read-only Drive backend over plain fetch — the googleapis package is ~50MB
 * for the three calls this needs.
 */
export class GDriveProvider implements StorageProvider {
  constructor(
    private readonly rootFolderId: string,
    private readonly getToken: TokenProvider,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  /** One retry on 401: the access token may simply have aged out. */
  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    for (const force of [false, true]) {
      const token = await this.getToken(force)
      const res = await this.fetchImpl(url, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` }
      })
      if (res.status !== 401) return res
      if (force) return res
    }
    throw new ProviderError('unreachable', 500)
  }

  private async listChildren(parentId: string): Promise<DriveFile[]> {
    const files: DriveFile[] = []
    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({
        q: `'${parentId.replace(/'/g, "\\'")}' in parents and trashed = false`,
        fields: `nextPageToken, files(${FIELDS})`,
        pageSize: '1000',
        orderBy: 'folder,name_natural',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true'
      })
      if (pageToken) params.set('pageToken', pageToken)
      const res = await this.request(`${API}/files?${params}`)
      if (!res.ok) {
        throw new ProviderError(`Drive list failed: ${res.status} ${await res.text()}`, res.status)
      }
      const body = (await res.json()) as { files?: DriveFile[]; nextPageToken?: string }
      files.push(...(body.files ?? []))
      pageToken = body.nextPageToken
    } while (pageToken)
    return files
  }

  async list(parentId?: string): Promise<MediaNode[]> {
    const files = await this.listChildren(parentId ?? this.rootFolderId)
    return files
      .filter((f) => f.mimeType === FOLDER_MIME || isMediaFile(f.name))
      .map(toNode)
      .sort(compareNodes)
  }

  async stat(id: string): Promise<MediaNode | null> {
    const res = await this.request(
      `${API}/files/${encodeURIComponent(id)}?fields=${FIELDS}&supportsAllDrives=true`
    )
    if (!res.ok) return null
    return toNode((await res.json()) as DriveFile)
  }

  async read(id: string, start?: number, end?: number): Promise<Readable> {
    const headers: Record<string, string> = {}
    if (start !== undefined) headers.Range = `bytes=${start}-${end ?? ''}`
    const res = await this.request(
      `${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`,
      { headers }
    )
    if (!res.ok || !res.body) {
      throw new ProviderError(`Drive download failed: ${res.status}`, res.status)
    }
    return Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
  }

  async findSubtitles(id: string): Promise<MediaNode[]> {
    const res = await this.request(
      `${API}/files/${encodeURIComponent(id)}?fields=id,name,parents&supportsAllDrives=true`
    )
    if (!res.ok) return []
    const self = (await res.json()) as DriveFile & { parents?: string[] }
    const parent = self.parents?.[0]
    if (!parent) return []
    const siblings = await this.listChildren(parent)
    return siblings
      .filter((f) => isSubtitleFile(f.name) && subtitleLabelFor(self.name, f.name) !== null)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(toNode)
  }
}

function toNode(f: DriveFile): MediaNode {
  const isFolder = f.mimeType === FOLDER_MIME
  return {
    id: f.id,
    name: f.name,
    kind: isFolder ? 'folder' : 'media',
    ext: isFolder ? undefined : extOf(f.name),
    size: f.size ? Number(f.size) : undefined,
    modifiedAt: f.modifiedTime ? Date.parse(f.modifiedTime) : undefined
  }
}
