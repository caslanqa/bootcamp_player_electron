import type { DataSource } from '@shared/types'
import { GDriveProvider } from './gdrive'
import type { TokenProvider } from '../google-fetch'
import { LocalProvider } from './local'
import { ProviderError, type StorageProvider } from './types'

/**
 * One provider instance per source, rebuilt when the source definition changes
 * (path edits) so a stale root can never keep serving files.
 */
export class ProviderRegistry {
  private cache = new Map<string, { fingerprint: string; provider: StorageProvider }>()

  constructor(
    private readonly getSources: () => DataSource[],
    private readonly getDriveToken: TokenProvider
  ) {}

  source(sourceId: string): DataSource {
    const source = this.getSources().find((s) => s.id === sourceId)
    if (!source) throw new ProviderError(`Unknown data source: ${sourceId}`, 404)
    return source
  }

  get(sourceId: string): StorageProvider {
    const source = this.source(sourceId)
    const fingerprint = `${source.type}:${source.root}`
    const hit = this.cache.get(sourceId)
    if (hit && hit.fingerprint === fingerprint) return hit.provider

    const provider: StorageProvider =
      source.type === 'local'
        ? new LocalProvider(source.root)
        : new GDriveProvider(source.root || 'root', this.getDriveToken)

    this.cache.set(sourceId, { fingerprint, provider })
    return provider
  }

  clear(): void {
    this.cache.clear()
  }
}
