import type { Readable } from 'node:stream'
import type { MediaNode } from '@shared/types'

/**
 * Everything a storage backend must answer. Range math lives in the stream
 * server, so providers only need "give me bytes [start, end]".
 */
export interface StorageProvider {
  /** parentId omitted -> the source root. Immediate children only (lazy tree). */
  list(parentId?: string): Promise<MediaNode[]>
  stat(id: string): Promise<MediaNode | null>
  read(id: string, start?: number, end?: number): Promise<Readable>
  /** Subtitle files sitting next to the given media file. */
  findSubtitles(id: string): Promise<MediaNode[]>
  /** Absolute local path when the provider has one — lets ffmpeg skip the HTTP hop. */
  localPath?(id: string): string | null
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status = 500
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
