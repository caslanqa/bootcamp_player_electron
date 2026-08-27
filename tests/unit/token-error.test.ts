import { describe, expect, it } from 'vitest'
import { describeTokenError } from '../../src/main/auth/gdrive-oauth'

const google = (error: string, description?: string): string =>
  JSON.stringify({ error, ...(description ? { error_description: description } : {}) })

describe('describeTokenError', () => {
  it('names the packaging mistake behind a missing client secret', () => {
    const message = describeTokenError(400, google('invalid_request', 'client_secret is missing.'))
    expect(message).toContain('packaged without the Google client secret')
    expect(message).toContain('GOOGLE_CLIENT_SECRET')
    // The raw blob must not reach the user.
    expect(message).not.toContain('invalid_request')
  })

  it('explains wrong or deleted credentials', () => {
    expect(describeTokenError(401, google('invalid_client'))).toMatch(/client ID or secret is wrong/)
  })

  it('explains an expired attempt', () => {
    expect(describeTokenError(400, google('invalid_grant'))).toMatch(/expired before it completed/)
  })

  it('points at the test-user list when Google denies access', () => {
    expect(describeTokenError(403, google('access_denied'))).toMatch(/test user/)
  })

  it('falls back to something readable for an unknown error', () => {
    const message = describeTokenError(500, google('boom', 'it broke'))
    expect(message).toContain('500')
    expect(message).toContain('boom')
    expect(message).toContain('it broke')
  })

  it('survives a non-JSON body', () => {
    expect(describeTokenError(502, '<html>Bad Gateway</html>')).toBe(
      'Google refused the sign-in (502).'
    )
  })
})
