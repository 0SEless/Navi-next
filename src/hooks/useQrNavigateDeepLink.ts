'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { usePublicStore } from '@/store/public-store'
import type { QrIndexEntry } from '@navi/core'
import { isStableQrId } from '@/lib/qr-payload'
import {
  parseNavigateDeepLink,
  stripNavigateQrParameter,
  type NavigateDeepLink,
} from '@/lib/navigation-deep-link'
import {
  resolveQrScanPayload,
  type QrLocation,
  type QrScanResolution,
} from '@/lib/qr-location'

type QrNavigateInternalState =
  | { status: 'idle' }
  | { status: 'loading'; checkpointId: string }
  | { status: 'resolved'; location: QrLocation; toNodeId?: string }
  | { status: 'non-routable'; location: QrLocation }
  | {
      status: 'error'
      reason: 'invalid' | 'unknown' | 'foreign' | 'unavailable'
      checkpointId?: string
      message: string
    }

export type QrNavigateDeepLinkState = QrNavigateInternalState & { retry: () => void }

export type PublicQrDiscoveryResult =
  | { status: 'resolved'; campusId: string; checkpoint: QrIndexEntry }
  | { status: 'unknown' }
  | { status: 'unavailable' }
  | { status: 'invalid' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function checkpointFromResponse(value: unknown, checkpointId: string): QrIndexEntry | null {
  if (!isRecord(value) || value.id !== checkpointId) return null
  return value as unknown as QrIndexEntry
}

/** Read only the public discovery contract; the hydrated bundle remains authoritative. */
export async function discoverPublicQrCheckpoint(
  checkpointId: string,
  fetcher: typeof fetch = fetch,
): Promise<PublicQrDiscoveryResult> {
  if (!isStableQrId(checkpointId)) return { status: 'invalid' }

  let response: Response
  try {
    response = await fetcher(`/api/public-qr?checkpoint_id=${encodeURIComponent(checkpointId)}`)
  } catch {
    return { status: 'unavailable' }
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    return { status: 'unavailable' }
  }
  if (!isRecord(body)) return { status: 'unavailable' }

  if (body.status === 'unknown') return { status: 'unknown' }
  if (body.status !== 'resolved' || typeof body.campusId !== 'string' || !body.campusId.trim()) {
    return { status: 'unavailable' }
  }
  const checkpoint = checkpointFromResponse(body.checkpoint, checkpointId)
  if (!checkpoint) return { status: 'unavailable' }
  return { status: 'resolved', campusId: body.campusId, checkpoint }
}

function errorMessage(reason: Exclude<QrNavigateDeepLinkState, { status: 'idle' | 'loading' | 'resolved' }>['reason']): string {
  switch (reason) {
    case 'invalid':
      return 'This QR link is invalid.'
    case 'unknown':
      return 'This QR location is not recognized.'
    case 'foreign':
      return 'This QR location belongs to an unavailable campus.'
    default:
      return 'NAVI could not load this QR location.'
  }
}

function qrLinkFromRoute(pathname: string | null, search: string): NavigateDeepLink {
  if (typeof window === 'undefined' || !pathname) return { kind: 'none' }
  const query = search ? `?${search}` : ''
  return parseNavigateDeepLink(`${window.location.origin}${pathname}${query}`, {
    allowedOrigins: [window.location.origin],
  })
}

function locationResolution(
  checkpointId: string,
  campus: ReturnType<typeof usePublicStore.getState>['campus'],
  currentCampusId: string | null,
): QrScanResolution {
  return resolveQrScanPayload(
    `navi.app/q/${checkpointId}`,
    campus,
    currentCampusId,
  )
}

function makeErrorState(
  reason: Extract<QrNavigateInternalState, { status: 'error' }>['reason'],
  checkpointId?: string,
): Extract<QrNavigateInternalState, { status: 'error' }> {
  return {
    status: 'error',
    reason,
    ...(checkpointId ? { checkpointId } : {}),
    message: errorMessage(reason),
  }
}

/**
 * Consume one QR Navigate link. URL cleanup occurs only after the published
 * checkpoint has been resolved and committed to the public store.
 */
export function useQrNavigateDeepLink(): QrNavigateDeepLinkState {
  // Subscribe to App Router transitions. Next may retain a route segment in
  // its client cache, so reading window.location alone is not enough to wake
  // the hook when leaving a QR error and returning to Navigate. The pathname
  // and query are the canonical reactive route state.
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = searchParams?.toString() ?? ''
  const fetchCampusData = usePublicStore((state) => state.fetchCampusData)
  const setQrLocation = usePublicStore((state) => state.setQrLocation)
  const setTo = usePublicStore((state) => state.setTo)
  const addRecentDestination = usePublicStore((state) => state.addRecentDestination)
  const [state, setState] = useState<QrNavigateInternalState>({ status: 'idle' })
  const [retryToken, setRetryToken] = useState(0)
  const consumedUrlRef = useRef<string | null>(null)

  const retry = useCallback(() => {
    consumedUrlRef.current = null
    setState({ status: 'idle' })
    setRetryToken((token) => token + 1)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = window.location.href
    const link = qrLinkFromRoute(pathname, search)
    if (link.kind === 'none' || link.kind === 'legacy-node' || link.kind === 'destination') return
    if (consumedUrlRef.current === url) return

    if (link.kind === 'invalid') {
      consumedUrlRef.current = url
      return
    }

    consumedUrlRef.current = url
    const checkpointId = link.checkpointId
    let cancelled = false

    const commit = (
      location: QrLocation,
      latestCampus: ReturnType<typeof usePublicStore.getState>['campus'],
    ) => {
      if (cancelled) return
      if (!location.nodeId) {
        setState({ status: 'non-routable', location })
        return
      }
      setQrLocation(location)
      const destinationId = link.toNodeId
        && latestCampus?.nodes.some((node) => node.id === link.toNodeId)
        ? link.toNodeId
        : undefined
      if (destinationId) {
        setTo(destinationId)
        addRecentDestination(destinationId)
      }
      window.history.replaceState(null, '', stripNavigateQrParameter(window.location.href))
      setState({
        status: 'resolved',
        location,
        ...(destinationId ? { toNodeId: destinationId } : {}),
        retry,
      })
    }

    const run = async () => {
      const initial = usePublicStore.getState()
      const initialCampusId = initial.currentCampusId ?? initial.campusData?.campusId ?? null
      const direct = locationResolution(checkpointId, initial.campus, initialCampusId)
      if (direct.status === 'resolved') {
        commit(direct.location, initial.campus)
        return
      }

      const discovery = await discoverPublicQrCheckpoint(checkpointId)
      if (cancelled) return
      if (discovery.status === 'invalid') {
        setState(makeErrorState('invalid', checkpointId))
        return
      }
      if (discovery.status === 'unknown') {
        setState(makeErrorState('unknown', checkpointId))
        return
      }
      if (discovery.status !== 'resolved') {
        setState(makeErrorState('unavailable', checkpointId))
        return
      }

      const currentCampusId = usePublicStore.getState().currentCampusId
        ?? usePublicStore.getState().campusData?.campusId
        ?? null
      if (currentCampusId !== discovery.campusId) {
        await fetchCampusData(discovery.campusId)
      }
      if (cancelled) return

      const latest = usePublicStore.getState()
      const latestCampusId = latest.currentCampusId ?? latest.campusData?.campusId ?? null
      if (latestCampusId !== discovery.campusId || !latest.campus) {
        setState(makeErrorState('unavailable', checkpointId))
        return
      }
      const resolved = locationResolution(checkpointId, latest.campus, latestCampusId)
      if (resolved.status === 'resolved') {
        commit(resolved.location, latest.campus)
        return
      }
      setState(makeErrorState(resolved.status === 'foreign' ? 'foreign' : 'unavailable', checkpointId))
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [pathname, search, fetchCampusData, setQrLocation, setTo, addRecentDestination, retry, retryToken])

  const currentLink = qrLinkFromRoute(pathname, search)
  const renderedState = currentLink.kind === 'invalid'
    ? makeErrorState('invalid')
    : currentLink.kind === 'qr' && state.status === 'idle'
      ? { status: 'loading' as const, checkpointId: currentLink.checkpointId }
      : currentLink.kind !== 'qr' && state.status === 'error'
        ? { status: 'idle' as const }
      : state
  return { ...renderedState, retry }
}
