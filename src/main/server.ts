import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Readable } from 'node:stream'
import { extOf } from '@shared/media'
import { toVtt } from '@shared/subtitle'
import type { ProviderRegistry } from './providers/registry'
import { ProviderError } from './providers/types'

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg'
}

const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024

export interface StreamServerDeps {
  registry: ProviderRegistry
  /** Absolute path of a transcode-cache entry. */
  cachePath(key: string): string
}

/**
 * Local HTTP origin for everything the <video> element loads. Needed because
 * Drive requires an Authorization header (impossible on `<video src>`) and
 * because it gives Range support for free on both backends.
 *
 * Trust boundary: bound to 127.0.0.1 and gated on a per-run random token, and
 * the local provider additionally refuses any path outside its configured root.
 */
export class StreamServer {
  readonly token = randomBytes(24).toString('base64url')
  private server: Server | null = null
  private port = 0

  constructor(private readonly deps: StreamServerDeps) {}

  async start(): Promise<number> {
    if (this.server) return this.port
    const server = createServer((req, res) => {
      this.handle(req, res).catch((err: unknown) => {
        const status = err instanceof ProviderError ? err.status : 500
        if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'text/plain' })
        res.end((err as Error).message ?? 'error')
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (typeof address === 'string' || address === null) throw new Error('Stream server bind failed')
    this.server = server
    this.port = address.port
    return this.port
  }

  async stop(): Promise<void> {
    const server = this.server
    if (!server) return
    this.server = null
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  get origin(): string {
    return `http://127.0.0.1:${this.port}`
  }

  rawUrl(sourceId: string, nodeId: string): string {
    return `${this.origin}/raw/${encodeURIComponent(sourceId)}/${encodeId(nodeId)}?t=${this.token}`
  }

  cacheUrl(key: string): string {
    return `${this.origin}/cache/${encodeURIComponent(key)}?t=${this.token}`
  }

  subtitleUrl(sourceId: string, nodeId: string): string {
    return `${this.origin}/sub/${encodeURIComponent(sourceId)}/${encodeId(nodeId)}?t=${this.token}`
  }

  private checkToken(value: string | null): boolean {
    if (!value) return false
    const a = Buffer.from(value)
    const b = Buffer.from(this.token)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.origin)
    if (!this.checkToken(url.searchParams.get('t'))) {
      res.writeHead(403, { 'Content-Type': 'text/plain' })
      res.end('forbidden')
      return
    }

    const [route, a, b] = url.pathname.split('/').filter(Boolean)
    // `<track>` fetches are CORS-checked even on localhost, so allow them explicitly.
    res.setHeader('Access-Control-Allow-Origin', '*')

    if (route === 'health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok')
      return
    }

    if (route === 'cache' && a) {
      await this.serveFile(req, res, this.deps.cachePath(a), 'video/mp4')
      return
    }

    if (route === 'raw' && a && b) {
      await this.serveProvider(req, res, decodeURIComponent(a), decodeId(b))
      return
    }

    if (route === 'sub' && a && b) {
      await this.serveSubtitle(res, decodeURIComponent(a), decodeId(b))
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('not found')
  }

  private async serveProvider(
    req: IncomingMessage,
    res: ServerResponse,
    sourceId: string,
    nodeId: string
  ): Promise<void> {
    const provider = this.deps.registry.get(sourceId)
    const node = await provider.stat(nodeId)
    if (!node) throw new ProviderError('not found', 404)

    const total = node.size ?? 0
    const mime = MIME[node.ext ?? ''] ?? 'application/octet-stream'
    const range = parseRange(req.headers.range, total)

    if (range === 'invalid') {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` })
      res.end()
      return
    }

    const headers: Record<string, string> = {
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store'
    }

    if (range) {
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${total}`
      headers['Content-Length'] = String(range.end - range.start + 1)
      res.writeHead(206, headers)
    } else {
      if (total) headers['Content-Length'] = String(total)
      res.writeHead(200, headers)
    }

    if (req.method === 'HEAD') {
      res.end()
      return
    }

    const stream = await provider.read(nodeId, range?.start, range?.end)
    pipe(stream, res)
  }

  private async serveFile(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    mime: string
  ): Promise<void> {
    let total: number
    try {
      total = (await stat(path)).size
    } catch {
      throw new ProviderError('cache entry missing', 404)
    }

    const range = parseRange(req.headers.range, total)
    if (range === 'invalid') {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` })
      res.end()
      return
    }

    const headers: Record<string, string> = {
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store'
    }

    if (range) {
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${total}`
      headers['Content-Length'] = String(range.end - range.start + 1)
      res.writeHead(206, headers)
    } else {
      headers['Content-Length'] = String(total)
      res.writeHead(200, headers)
    }

    if (req.method === 'HEAD') {
      res.end()
      return
    }

    pipe(createReadStream(path, range ? { start: range.start, end: range.end } : undefined), res)
  }

  private async serveSubtitle(
    res: ServerResponse,
    sourceId: string,
    nodeId: string
  ): Promise<void> {
    const provider = this.deps.registry.get(sourceId)
    const node = await provider.stat(nodeId)
    if (!node) throw new ProviderError('not found', 404)
    if ((node.size ?? 0) > MAX_SUBTITLE_BYTES) throw new ProviderError('subtitle too large', 413)

    const stream = await provider.read(nodeId)
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    const vtt = toVtt(node.ext ?? extOf(node.name), Buffer.concat(chunks).toString('utf8'))

    res.writeHead(200, {
      'Content-Type': 'text/vtt; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*'
    })
    res.end(vtt)
  }
}

/** null = whole file, 'invalid' = unsatisfiable. */
export function parseRange(
  header: string | undefined,
  total: number
): { start: number; end: number } | null | 'invalid' {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return 'invalid'
  const [, rawStart, rawEnd] = m
  if (rawStart === '' && rawEnd === '') return 'invalid'
  if (total <= 0) return null

  let start: number
  let end: number
  if (rawStart === '') {
    // Suffix range: last N bytes.
    const length = Number(rawEnd)
    if (length <= 0) return 'invalid'
    start = Math.max(0, total - length)
    end = total - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? total - 1 : Math.min(Number(rawEnd), total - 1)
  }
  if (start > end || start >= total) return 'invalid'
  return { start, end }
}

function pipe(stream: Readable, res: ServerResponse): void {
  stream.on('error', () => res.destroy())
  res.on('close', () => stream.destroy())
  stream.pipe(res)
}

export function encodeId(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url')
}

export function decodeId(encoded: string): string {
  return Buffer.from(encoded, 'base64url').toString('utf8')
}
