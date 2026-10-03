import type { LoadedPackage } from '../loader'
import type { QrIndexEntry } from '@navi/core'

// P1-T13 (R10.2/D16): QR checkpoint resolution — LOCAL-FIRST through the
// published bundle index, with an API/server lookup fallback. If both fail,
// a clear "unknown checkpoint" error is reported. Positions are building-local
// meters (never world); world derivation happens at consumption (R10.3).

export type QrApiFallback = (qrId: string) => Promise<QrIndexEntry | null>

export class QrService {
  /** Number of times the API fallback was consulted (test/observability). */
  fallbackCalls = 0
  /** Last failure message ('' when the last resolution succeeded). */
  lastError = ''

  private readonly index: Map<string, QrIndexEntry>
  private readonly fallback?: QrApiFallback

  constructor(pkg: LoadedPackage, fallback?: QrApiFallback) {
    this.index = new Map((pkg.qrIndex?.checkpoints ?? []).map(c => [c.id, c]))
    this.fallback = fallback
  }

  /** Resolve a checkpoint id: local index first, API fallback second. */
  async resolve(qrId: string): Promise<QrIndexEntry | null> {
    const local = this.index.get(qrId)
    if (local) {
      this.lastError = ''
      return local
    }

    if (this.fallback) {
      this.fallbackCalls++
      const remote = await this.fallback(qrId)
      if (remote) {
        this.lastError = ''
        return remote
      }
    }

    this.lastError = `unknown checkpoint: ${qrId}`
    return null
  }

  /** True when the checkpoint id exists in the local bundle index. */
  hasLocal(qrId: string): boolean {
    return this.index.has(qrId)
  }
}