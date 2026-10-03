import type { CaptureSession } from '../capture/types'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

function canonicalize(value: unknown): JsonValue | undefined {
  if (value === undefined) {
    return undefined
  }

  if (value === null || typeof value !== 'object') {
    return value as JsonValue
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item) ?? null)
  }

  const object = value as Record<string, unknown>
  return Object.keys(object)
    .sort()
    .reduce<Record<string, JsonValue>>((result, key) => {
      const canonicalValue = canonicalize(object[key])
      if (canonicalValue !== undefined) {
        result[key] = canonicalValue
      }
      return result
    }, {})
}

/**
 * Returns the deterministic JSON representation used for Capture content hashes.
 * The function only reads the session, so raw samples and candidate geometry remain untouched.
 */
export function canonicalizeCaptureSession(session: CaptureSession): string {
  return JSON.stringify(canonicalize(session))
}

/**
 * Hashes the complete CaptureSession, not the export envelope. This intentionally excludes
 * envelope-only fields such as exportedAt while retaining raw samples, candidate geometry,
 * and markers in their existing order.
 */
export async function hashCaptureSession(session: CaptureSession): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('Web Crypto SHA-256 is unavailable')
  }

  const bytes = new TextEncoder().encode(canonicalizeCaptureSession(session))
  const digest = await subtle.digest('SHA-256', bytes)

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
