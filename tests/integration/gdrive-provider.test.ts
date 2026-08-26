import { describe, expect, it, vi } from 'vitest'
import { GDriveProvider, type DriveFile } from '../../src/main/providers/gdrive'
import { ProviderError } from '../../src/main/providers/types'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

interface Call {
  url: string
  init?: RequestInit
}

/** Records every call so the tests can assert on query params and headers. */
function fakeFetch(handler: (url: URL, init?: RequestInit) => Response): {
  impl: typeof fetch
  calls: Call[]
} {
  const calls: Call[] = []
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url: String(input), init })
    return handler(url, init)
  }) as typeof fetch
  return { impl, calls }
}

describe('GDriveProvider.list', () => {
  it('maps folders and media, filters out other file types, and sorts', async () => {
    const files: DriveFile[] = [
      { id: 'f2', name: '10 last.mp4', mimeType: 'video/mp4', size: '20' },
      { id: 'f1', name: '09 ninth.mp4', mimeType: 'video/mp4', size: '10' },
      { id: 'd1', name: '01 Intro', mimeType: FOLDER_MIME },
      { id: 'x1', name: 'notes.txt', mimeType: 'text/plain', size: '3' }
    ]
    const { impl } = fakeFetch(() => jsonResponse({ files }))
    const provider = new GDriveProvider('root', async () => 'token', impl)

    const nodes = await provider.list()
    expect(nodes.map((n) => `${n.kind}:${n.name}`)).toEqual([
      'folder:01 Intro',
      'media:09 ninth.mp4',
      'media:10 last.mp4'
    ])
    expect(nodes[1]).toMatchObject({ id: 'f1', ext: 'mp4', size: 10 })
  })

  it('follows pagination until nextPageToken runs out', async () => {
    const { impl, calls } = fakeFetch((url) => {
      const page = url.searchParams.get('pageToken')
      if (!page) {
        return jsonResponse({
          files: [{ id: 'a', name: 'a.mp4', mimeType: 'video/mp4' }],
          nextPageToken: 'p2'
        })
      }
      return jsonResponse({ files: [{ id: 'b', name: 'b.mp4', mimeType: 'video/mp4' }] })
    })
    const provider = new GDriveProvider('root', async () => 'token', impl)
    const nodes = await provider.list()
    expect(nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(calls).toHaveLength(2)
  })

  it('queries the requested parent folder', async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse({ files: [] }))
    await new GDriveProvider('root', async () => 'token', impl).list('sub-folder-id')
    const q = new URL(calls[0].url).searchParams.get('q')
    expect(q).toBe("'sub-folder-id' in parents and trashed = false")
  })

  it('sends the bearer token', async () => {
    const { impl, calls } = fakeFetch(() => jsonResponse({ files: [] }))
    await new GDriveProvider('root', async () => 'abc123', impl).list()
    const headers = calls[0].init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer abc123')
  })

  it('retries once with a refreshed token after a 401', async () => {
    const tokens = ['stale', 'fresh']
    let issued = 0
    const { impl, calls } = fakeFetch((_url, init) => {
      const auth = (init?.headers as Record<string, string>).Authorization
      if (auth === 'Bearer stale') return new Response('unauthorized', { status: 401 })
      return jsonResponse({ files: [] })
    })
    const provider = new GDriveProvider(
      'root',
      async (force) => {
        issued += 1
        return force ? tokens[1] : tokens[0]
      },
      impl
    )
    await expect(provider.list()).resolves.toEqual([])
    expect(calls).toHaveLength(2)
    expect(issued).toBe(2)
  })

  it('gives up after the retry also fails', async () => {
    const { impl } = fakeFetch(() => new Response('nope', { status: 401 }))
    const provider = new GDriveProvider('root', async () => 'token', impl)
    await expect(provider.list()).rejects.toThrow(ProviderError)
  })

  it('reports a server error with its status', async () => {
    const { impl } = fakeFetch(() => new Response('boom', { status: 500 }))
    const provider = new GDriveProvider('root', async () => 'token', impl)
    await expect(provider.list()).rejects.toThrow(/Drive list failed: 500/)
  })
})

describe('GDriveProvider.read', () => {
  it('requests alt=media and forwards the byte range', async () => {
    const { impl, calls } = fakeFetch(() => new Response('0123456789'))
    const provider = new GDriveProvider('root', async () => 'token', impl)
    const stream = await provider.read('file-1', 2, 5)

    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
    expect(Buffer.concat(chunks).toString()).toBe('0123456789')

    expect(calls[0].url).toContain('alt=media')
    expect((calls[0].init?.headers as Record<string, string>).Range).toBe('bytes=2-5')
  })

  it('omits the Range header when no range is asked for', async () => {
    const { impl, calls } = fakeFetch(() => new Response('x'))
    await new GDriveProvider('root', async () => 'token', impl).read('file-1')
    expect((calls[0].init?.headers as Record<string, string>).Range).toBeUndefined()
  })

  it('throws on a failed download', async () => {
    const { impl } = fakeFetch(() => new Response('gone', { status: 404 }))
    await expect(
      new GDriveProvider('root', async () => 'token', impl).read('file-1')
    ).rejects.toThrow(/Drive download failed: 404/)
  })
})

describe('GDriveProvider.findSubtitles', () => {
  it('matches sidecars in the same Drive folder', async () => {
    const { impl } = fakeFetch((url) => {
      if (url.pathname.endsWith('/files/vid-1')) {
        return jsonResponse({ id: 'vid-1', name: '01 welcome.mp4', parents: ['dir-1'] })
      }
      return jsonResponse({
        files: [
          { id: 's1', name: '01 welcome.srt', mimeType: 'text/plain' },
          { id: 's2', name: '01 welcome.tr.vtt', mimeType: 'text/vtt' },
          { id: 's3', name: '02 setup.srt', mimeType: 'text/plain' },
          { id: 'v1', name: '01 welcome.mp4', mimeType: 'video/mp4' }
        ]
      })
    })
    const subs = await new GDriveProvider('root', async () => 'token', impl).findSubtitles('vid-1')
    expect(subs.map((s) => s.name)).toEqual(['01 welcome.srt', '01 welcome.tr.vtt'])
  })

  it('returns nothing when the file has no parent', async () => {
    const { impl } = fakeFetch(() => jsonResponse({ id: 'v', name: 'v.mp4' }))
    expect(
      await new GDriveProvider('root', async () => 'token', impl).findSubtitles('v')
    ).toEqual([])
  })
})

describe('GDriveProvider.stat', () => {
  it('returns null rather than throwing when the file is gone', async () => {
    const { impl } = fakeFetch(() => new Response('', { status: 404 }))
    expect(await new GDriveProvider('root', async () => 't', impl).stat('x')).toBeNull()
  })

  it('parses size and modifiedTime', async () => {
    const { impl } = fakeFetch(() =>
      jsonResponse({
        id: 'x',
        name: 'lesson.mkv',
        mimeType: 'video/x-matroska',
        size: '4096',
        modifiedTime: '2026-01-02T03:04:05.000Z'
      })
    )
    const node = await new GDriveProvider('root', async () => 't', impl).stat('x')
    expect(node).toMatchObject({ ext: 'mkv', size: 4096, kind: 'media' })
    expect(node?.modifiedAt).toBe(Date.parse('2026-01-02T03:04:05.000Z'))
  })
})

describe('token provider contract', () => {
  it('asks for a token on every request without caching it itself', async () => {
    const getToken = vi.fn(async () => 'tok')
    const { impl } = fakeFetch(() => jsonResponse({ files: [] }))
    const provider = new GDriveProvider('root', getToken, impl)
    await provider.list()
    await provider.list()
    expect(getToken).toHaveBeenCalledTimes(2)
    expect(getToken).toHaveBeenCalledWith(false)
  })
})
