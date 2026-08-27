import type { AccessEntry } from '@shared/types'
import { createAuthedFetch, type AuthedFetch, type TokenProvider } from './google-fetch'
import { ProviderError } from './providers/types'

const API = 'https://www.googleapis.com/drive/v3'
const PERMISSION_FIELDS = 'id,type,role,emailAddress,displayName,deleted'

interface DrivePermission {
  id: string
  type: string
  role: string
  emailAddress?: string
  displayName?: string
  deleted?: boolean
}

/** Loose on purpose: Google is the real validator, this only catches typos early. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(value.trim())
}

export function toAccessEntry(permission: DrivePermission, selfEmail: string | null): AccessEntry {
  const email = permission.emailAddress ?? null
  return {
    id: permission.id,
    email,
    name: permission.displayName ?? null,
    role: permission.role,
    isOwner: permission.role === 'owner',
    isSelf: email !== null && selfEmail !== null && email.toLowerCase() === selfEmail.toLowerCase()
  }
}

/** Owner first, then everyone else by name/email — a stable, readable order. */
export function sortAccess(entries: AccessEntry[]): AccessEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1
    return (a.name ?? a.email ?? '').localeCompare(b.name ?? b.email ?? '')
  })
}

/**
 * Grant and revoke access to the one course folder.
 *
 * Reading the list needs only `drive.readonly`; changing it needs the write
 * scope, which is why the admin panel asks for consent separately instead of
 * putting "edit and delete all your Drive files" in front of every student.
 */
export class DriveAdmin {
  private readonly request: AuthedFetch

  constructor(
    private readonly folderId: string,
    getToken: TokenProvider,
    fetchImpl: typeof fetch = fetch
  ) {
    this.request = createAuthedFetch(getToken, fetchImpl)
  }

  /**
   * Can the signed-in account read the course folder at all? This *is* the
   * membership check: Drive answers 404 for a folder that was never shared, and
   * no client-side list could be more accurate or harder to bypass.
   */
  async canRead(): Promise<boolean> {
    const res = await this.request(
      `${API}/files/${encodeURIComponent(this.folderId)}?fields=id&supportsAllDrives=true`
    )
    return res.ok
  }

  /** Whoever owns the folder administers the course — no email to configure. */
  async ownerEmail(): Promise<string | null> {
    const res = await this.request(
      `${API}/files/${encodeURIComponent(this.folderId)}?fields=owners(emailAddress)&supportsAllDrives=true`
    )
    if (!res.ok) return null
    const body = (await res.json()) as { owners?: Array<{ emailAddress?: string }> }
    return body.owners?.[0]?.emailAddress ?? null
  }

  async listAccess(selfEmail: string | null): Promise<AccessEntry[]> {
    const entries: AccessEntry[] = []
    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({
        fields: `nextPageToken, permissions(${PERMISSION_FIELDS})`,
        pageSize: '100',
        supportsAllDrives: 'true'
      })
      if (pageToken) params.set('pageToken', pageToken)
      const res = await this.request(
        `${API}/files/${encodeURIComponent(this.folderId)}/permissions?${params}`
      )
      if (!res.ok) {
        throw new ProviderError(
          `Could not read the access list: ${res.status} ${await res.text()}`,
          res.status
        )
      }
      const body = (await res.json()) as {
        permissions?: DrivePermission[]
        nextPageToken?: string
      }
      for (const permission of body.permissions ?? []) {
        if (permission.deleted) continue
        entries.push(toAccessEntry(permission, selfEmail))
      }
      pageToken = body.nextPageToken
    } while (pageToken)
    return sortAccess(entries)
  }

  /** Adds a reader. Google emails them the folder link. */
  async grant(email: string, selfEmail: string | null): Promise<AccessEntry[]> {
    const address = email.trim()
    if (!looksLikeEmail(address)) {
      throw new ProviderError(`Not an email address: ${address}`, 400)
    }
    const params = new URLSearchParams({
      supportsAllDrives: 'true',
      sendNotificationEmail: 'true'
    })
    const res = await this.request(
      `${API}/files/${encodeURIComponent(this.folderId)}/permissions?${params}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'reader', type: 'user', emailAddress: address })
      }
    )
    if (!res.ok) {
      throw new ProviderError(`Could not grant access: ${res.status} ${await res.text()}`, res.status)
    }
    return this.listAccess(selfEmail)
  }

  async revoke(permissionId: string, selfEmail: string | null): Promise<AccessEntry[]> {
    const res = await this.request(
      `${API}/files/${encodeURIComponent(this.folderId)}/permissions/${encodeURIComponent(permissionId)}?supportsAllDrives=true`,
      { method: 'DELETE' }
    )
    // 404 means it is already gone, which is the state the caller wanted.
    if (!res.ok && res.status !== 404) {
      throw new ProviderError(
        `Could not revoke access: ${res.status} ${await res.text()}`,
        res.status
      )
    }
    return this.listAccess(selfEmail)
  }
}
