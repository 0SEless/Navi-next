import type { QrIndex, QrIndexEntry } from '@navi/core'
import {
  isStableQrId,
  QR_PUBLIC_HOSTS,
  resolveQrCheckpoint,
  type QrCheckpointResolution,
} from './qr-payload'

export type NavigateDeepLinkInvalidReason =
  | 'malformed-qr'
  | 'malformed-node'
  | 'malformed-destination'
  | 'unsupported-url'

export interface NavigateDeepLinkParseOptions {
  /** Additional exact origins trusted by the current app (e.g. localhost). */
  allowedOrigins?: readonly string[]
}

export type NavigateDeepLink =
  | { kind: 'none' }
  | { kind: 'qr'; checkpointId: string; toNodeId?: string; fromNodeId?: string }
  | { kind: 'legacy-node'; nodeId: string; fromNodeId?: string }
  | { kind: 'destination'; toNodeId: string; fromNodeId?: string }
  | { kind: 'invalid'; reason: NavigateDeepLinkInvalidReason }

function nodeReferenceIsSafe(value: string): boolean {
  return value.length > 0
    && value.length <= 128
    && /^[A-Za-z0-9._:/ -]+$/.test(value)
}

function optionalNodeId(params: URLSearchParams, key: string): { value?: string; invalid: boolean } {
  const values = params.getAll(key)
  if (values.length === 0) return { invalid: false }
  if (values.length !== 1) return { invalid: true }
  const value = values[0].trim()
  return nodeReferenceIsSafe(value) ? { value, invalid: false } : { invalid: true }
}

function navigationInput(
  value: string,
  options: NavigateDeepLinkParseOptions,
): { params: URLSearchParams } | { unsupported: true } {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 4096) return { unsupported: true }

  let url: URL
  let absolute = false
  try {
    if (trimmed.startsWith('?')) {
      url = new URL(`https://navi.app/map/navigate${trimmed}`)
    } else if (trimmed.startsWith('/')) {
      url = new URL(trimmed, 'https://navi.app')
    } else {
      url = new URL(trimmed)
      absolute = true
    }
  } catch {
    return { unsupported: true }
  }

  if (absolute) {
    const allowedOrigins = new Set<string>([
      ...QR_PUBLIC_HOSTS.map((host) => `https://${host}`),
      ...(options.allowedOrigins ?? []),
    ])
    if (!allowedOrigins.has(url.origin)) return { unsupported: true }
  }

  if (url.pathname !== '/map/navigate' && url.pathname !== '/map/navigate/') {
    return { unsupported: true }
  }
  return { params: url.searchParams }
}

/** Parse a /map/navigate query without resolving it into live navigation state. */
export function parseNavigateDeepLink(
  value: string,
  options: NavigateDeepLinkParseOptions = {},
): NavigateDeepLink {
  const input = navigationInput(value, options)
  if ('unsupported' in input) return { kind: 'invalid', reason: 'unsupported-url' }
  const { params } = input

  if (params.has('qr')) {
    const values = params.getAll('qr')
    const checkpointId = values[0] ?? ''
    const from = optionalNodeId(params, 'from')
    const to = optionalNodeId(params, 'to')
    if (
      values.length !== 1
      || !isStableQrId(checkpointId)
      || params.has('node')
      || from.invalid
      || to.invalid
    ) {
      return { kind: 'invalid', reason: 'malformed-qr' }
    }
    return {
      kind: 'qr',
      checkpointId,
      ...(to.value ? { toNodeId: to.value } : {}),
      ...(from.value ? { fromNodeId: from.value } : {}),
    }
  }

  if (params.has('to')) {
    const values = params.getAll('to')
    const toNodeId = values[0]?.trim() ?? ''
    const from = optionalNodeId(params, 'from')
    if (values.length !== 1 || !nodeReferenceIsSafe(toNodeId) || from.invalid) {
      return { kind: 'invalid', reason: 'malformed-destination' }
    }
    return { kind: 'destination', toNodeId, ...(from.value ? { fromNodeId: from.value } : {}) }
  }

  if (params.has('node')) {
    const values = params.getAll('node')
    const nodeId = values[0]?.trim() ?? ''
    const from = optionalNodeId(params, 'from')
    if (values.length !== 1 || !nodeReferenceIsSafe(nodeId) || from.invalid) {
      return { kind: 'invalid', reason: 'malformed-node' }
    }
    return { kind: 'legacy-node', nodeId, ...(from.value ? { fromNodeId: from.value } : {}) }
  }

  return { kind: 'none' }
}

export type NavigateDeepLinkResolution =
  | { status: 'none' }
  | { status: 'invalid'; reason: NavigateDeepLinkInvalidReason }
  | { status: 'resolved'; checkpoint: QrIndexEntry }
  | { status: 'unknown'; checkpointId: string }
  | { status: 'foreign'; checkpointId: string }
  | { status: 'unavailable'; checkpointId: string }
  | { status: 'destination'; toNodeId: string; fromNodeId?: string }
  | { status: 'legacy-node'; nodeId: string; fromNodeId?: string }

function resolveQrLink(
  link: Extract<NavigateDeepLink, { kind: 'qr' }>,
  qrIndex: QrIndex | undefined,
  currentCampusId: string | null,
): NavigateDeepLinkResolution {
  const result: QrCheckpointResolution = resolveQrCheckpoint(
    { campusId: '', nodeId: link.checkpointId },
    qrIndex,
    currentCampusId,
  )
  switch (result.status) {
    case 'resolved':
      return {
        ...result,
        ...(link.toNodeId ? { toNodeId: link.toNodeId } : {}),
        ...(link.fromNodeId ? { fromNodeId: link.fromNodeId } : {}),
      }
    case 'unknown':
      return { status: 'unknown', checkpointId: link.checkpointId }
    case 'foreign':
      return { status: 'foreign', checkpointId: link.checkpointId }
    case 'unavailable':
      return { status: 'unavailable', checkpointId: link.checkpointId }
  }
}

/** Remove only the consumed QR parameter, preserving supported destination state. */
export function stripNavigateQrParameter(value: string): string {
  try {
    const trimmed = value.trim()
    const url = trimmed.startsWith('?')
      ? new URL(`https://navi.app/map/navigate${trimmed}`)
      : new URL(trimmed, 'https://navi.app')
    url.searchParams.delete('qr')
    const query = url.searchParams.toString()
    return `${url.pathname}${query ? `?${query}` : ''}${url.hash}`
  } catch {
    return value
  }
}

/** Remove route-session parameters while preserving unrelated public query state. */
export function stripNavigateSessionParameters(value: string): string {
  try {
    const trimmed = value.trim()
    const url = trimmed.startsWith('?')
      ? new URL(`https://navi.app/map/navigate${trimmed}`)
      : new URL(trimmed, 'https://navi.app')
    for (const key of ['from', 'to', 'qr', 'node']) {
      url.searchParams.delete(key)
    }
    const query = url.searchParams.toString()
    return `${url.pathname}${query ? `?${query}` : ''}${url.hash}`
  } catch {
    return value
  }
}

/** Resolve a parsed link against the currently hydrated public campus. */
export function resolveNavigateDeepLink(
  link: NavigateDeepLink,
  qrIndex: QrIndex | undefined,
  currentCampusId: string | null,
): NavigateDeepLinkResolution {
  switch (link.kind) {
    case 'none':
      return { status: 'none' }
    case 'invalid':
      return { status: 'invalid', reason: link.reason }
    case 'qr':
      return resolveQrLink(link, qrIndex, currentCampusId)
    case 'destination':
      return {
        status: 'destination',
        toNodeId: link.toNodeId,
        fromNodeId: link.fromNodeId,
      }
    case 'legacy-node':
      return {
        status: 'legacy-node',
        nodeId: link.nodeId,
        fromNodeId: link.fromNodeId,
      }
  }
}
