/** Supplies a Google access token; `forceRefresh` skips the cached one. */
export type TokenProvider = (forceRefresh?: boolean) => Promise<string>

export type AuthedFetch = (url: string, init?: RequestInit) => Promise<Response>

/**
 * Bearer-authenticated fetch with exactly one retry on 401.
 *
 * An access token can age out mid-session, and the only way to tell is the 401
 * itself — so retry once with a freshly refreshed token, then give the caller
 * whatever Google said. Shared by the storage provider and the admin API so the
 * refresh behaviour cannot drift between them.
 */
export function createAuthedFetch(
  getToken: TokenProvider,
  fetchImpl: typeof fetch = fetch
): AuthedFetch {
  return async (url, init = {}) => {
    for (const forceRefresh of [false, true]) {
      const token = await getToken(forceRefresh)
      const res = await fetchImpl(url, {
        ...init,
        headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` }
      })
      if (res.status !== 401 || forceRefresh) return res
    }
    throw new Error('unreachable')
  }
}
