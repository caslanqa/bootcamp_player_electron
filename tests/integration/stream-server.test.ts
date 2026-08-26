import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DataSource } from '@shared/types'
import { ProviderRegistry } from '../../src/main/providers/registry'
import { encodeId, StreamServer } from '../../src/main/server'
import { buildFixtures, FIXTURE_ROOT, type Fixtures } from '../helpers/fixtures'

const SOURCE_ID = 'src-local'

let paths: Fixtures
let server: StreamServer

beforeAll(async () => {
  paths = await buildFixtures()
  const sources: DataSource[] = [
    { id: SOURCE_ID, name: 'Course', type: 'local', root: paths.course }
  ]
  const registry = new ProviderRegistry(
    () => sources,
    async () => 'unused-token'
  )
  server = new StreamServer({
    registry,
    cachePath: (key) => join(mkdtempSync(join(tmpdir(), 'bootcamp-cache-')), `${key}.mp4`)
  })
  await server.start()
}, 180_000)

afterAll(async () => {
  await server.stop()
})

describe('token gate', () => {
  it('rejects a request with no token', async () => {
    const res = await fetch(`${server.origin}/health`)
    expect(res.status).toBe(403)
  })

  it('rejects a wrong token of the same length', async () => {
    const wrong = 'x'.repeat(server.token.length)
    const res = await fetch(`${server.origin}/health?t=${wrong}`)
    expect(res.status).toBe(403)
  })

  it('accepts the real token', async () => {
    const res = await fetch(`${server.origin}/health?t=${server.token}`)
    expect(res.status).toBe(200)
  })
})

describe('GET /raw', () => {
  it('serves the whole file with Accept-Ranges', async () => {
    const res = await fetch(server.rawUrl(SOURCE_ID, paths.welcome))
    expect(res.status).toBe(200)
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('content-type')).toBe('video/mp4')
    expect(Number(res.headers.get('content-length'))).toBeGreaterThan(0)
    await res.arrayBuffer()
  })

  it('honours a Range request with 206 and Content-Range', async () => {
    const res = await fetch(server.rawUrl(SOURCE_ID, paths.welcome), {
      headers: { Range: 'bytes=4-7' }
    })
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toMatch(/^bytes 4-7\/\d+$/)
    expect(Buffer.from(await res.arrayBuffer()).toString('latin1')).toBe('ftyp')
  })

  it('answers 416 for an unsatisfiable range', async () => {
    const res = await fetch(server.rawUrl(SOURCE_ID, paths.welcome), {
      headers: { Range: 'bytes=99999999999-' }
    })
    expect(res.status).toBe(416)
  })

  it('supports HEAD without a body', async () => {
    const res = await fetch(server.rawUrl(SOURCE_ID, paths.welcome), { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })

  it('refuses a path outside the source root even with a valid token', async () => {
    const outside = join(FIXTURE_ROOT, 'outside-secret.txt')
    const url = `${server.origin}/raw/${SOURCE_ID}/${encodeId(outside)}?t=${server.token}`
    const res = await fetch(url)
    expect(res.status).toBe(403)
    expect(await res.text()).not.toContain('must never be served')
  })

  it('404s an unknown data source', async () => {
    const url = `${server.origin}/raw/ghost/${encodeId(paths.welcome)}?t=${server.token}`
    expect((await fetch(url)).status).toBe(404)
  })
})

describe('GET /sub', () => {
  it('converts srt to WebVTT on the fly', async () => {
    const srt = join(paths.intro, '01 welcome.srt')
    const res = await fetch(server.subtitleUrl(SOURCE_ID, srt))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/vtt')
    // <track> is CORS-checked, so this header is load-bearing.
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    const body = await res.text()
    expect(body.startsWith('WEBVTT')).toBe(true)
    expect(body).toContain('00:00:00.500 --> 00:00:02.000')
  })

  it('passes an existing vtt through', async () => {
    const vtt = join(paths.intro, '01 welcome.tr.vtt')
    const body = await (await fetch(server.subtitleUrl(SOURCE_ID, vtt))).text()
    expect(body).toContain('Merhaba')
    expect(body.match(/WEBVTT/g)).toHaveLength(1)
  })
})

describe('GET /cache', () => {
  it('404s a key that was never produced', async () => {
    expect((await fetch(server.cacheUrl('deadbeef'))).status).toBe(404)
  })
})

describe('unknown routes', () => {
  it('404s', async () => {
    expect((await fetch(`${server.origin}/nope?t=${server.token}`)).status).toBe(404)
  })
})
