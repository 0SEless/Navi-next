'use client'

import { useState, useCallback, createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import type { LatLng } from '@/types/nav-types'
import type { ConnectivityCandidate, RoadConnectionRequest } from '@navi/editor'
import { toRoadConnectionRequest } from '@navi/editor'

type PendingType = 'building' | 'boundary' | 'route' | 'area' | 'import-osm' | 'set-boundary'
type DrawingTool = 'route' | 'building' | 'boundary' | 'area' | 'import-osm' | 'set-boundary'

interface PendingConfirm {
  type: PendingType
  points: LatLng[]
  /** Fix 1: explicit Connect / Keep Separate decisions applied atomically by road.create. */
  connections?: RoadConnectionRequest[]
}

export interface PendingRoadConnection {
  /** Raw cursor position (never mutated before the admin decides). */
  point: LatLng
  /** Discovered target within the 0.5 m discovery radius. */
  candidate: ConnectivityCandidate
}

interface DragState {
  start: LatLng
  current: LatLng
}

type Subscriber = () => void

export interface DrawingSessionValue {
  tracePoints: LatLng[]
  drawPoints: LatLng[]
  routeWidth: number
  roomDrag: DragState | null
  pendingConfirm: PendingConfirm | null
  /** Fix 1: destination awaiting an explicit Connect / Keep Separate decision. */
  pendingRoadConnection: PendingRoadConnection | null
  setPendingRoadConnection: (pending: PendingRoadConnection | null) => void
  resolveRoadConnection: (action: 'connect' | 'separate') => void
  addSeparatePoint: (pt: LatLng, candidate: ConnectivityCandidate) => void
  addTracePoint: (pt: LatLng) => void
  setTracePoints: (pts: LatLng[]) => void
  undoLastPoint: () => void
  clearTracePoints: () => void
  addDrawPoint: (pt: LatLng) => void
  setDrawPoints: (pts: LatLng[]) => void
  undoLastDrawPoint: () => void
  clearDrawPoints: () => void
  setRoomDrag: (drag: DragState | null) => void
  requestConfirm: (type?: PendingType, pointsOverride?: LatLng[]) => void
  confirm: () => LatLng[]
  cancel: () => void
  setRouteWidth: (width: number) => void
  subscribe: (cb: Subscriber) => () => void
}

const DrawingSessionContext = createContext<DrawingSessionValue | null>(null)

export function useDrawingSession(initialTool: DrawingTool = 'route'): DrawingSessionValue {
  const [tracePoints, setTracePoints] = useState<LatLng[]>([])
  const [drawPoints, setDrawPoints] = useState<LatLng[]>([])
  const [routeWidth, setRouteWidthState] = useState(8)
  const [roomDrag, setRoomDrag] = useState<DragState | null>(null)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null)
  const [pendingRoadConnection, setPendingRoadConnectionState] = useState<PendingRoadConnection | null>(null)
  const roadConnectionDecisionsRef = useRef<RoadConnectionRequest[]>([])
  // Synchronous mirror of tracePoints so connection point indexes stay correct
  // even when several point mutations happen within one React batch.
  const pointsRef = useRef<LatLng[]>([])
  const subsRef = useRef(new Set<Subscriber>())

  useEffect(() => { pointsRef.current = tracePoints }, [tracePoints])

  const subscribe = useCallback((cb: Subscriber) => {
    subsRef.current.add(cb)
    return () => { subsRef.current.delete(cb) }
  }, [])

  const notify = useCallback(() => {
    subsRef.current.forEach(cb => cb())
  }, [])

  useEffect(() => { notify() }, [tracePoints, drawPoints, notify])

  const appendPoint = useCallback((pt: LatLng) => {
    pointsRef.current = [...pointsRef.current, pt]
    setTracePoints(prev => [...prev, pt])
  }, [])

  const addTracePoint = useCallback((pt: LatLng) => {
    appendPoint(pt)
  }, [appendPoint])

  const setPendingRoadConnection = useCallback((pending: PendingRoadConnection | null) => {
    setPendingRoadConnectionState(pending)
  }, [])

  const recordConnectionDecision = useCallback((
    pointIndex: number,
    candidate: ConnectivityCandidate,
    action: 'connect' | 'separate',
  ) => {
    const request = toRoadConnectionRequest(pointIndex, candidate, action)
    roadConnectionDecisionsRef.current = [
      ...roadConnectionDecisionsRef.current.filter(d => d.pointIndex !== pointIndex),
      request,
    ]
  }, [])

  /**
   * Resolve the pending destination: Connect projects onto the target,
   * Keep Separate preserves the raw coordinate. Neither mutates topology here —
   * the decision is committed atomically with road.create.
   */
  const resolveRoadConnection = useCallback((action: 'connect' | 'separate') => {
    const pending = pendingRoadConnection
    if (!pending) return
    const pointIndex = pointsRef.current.length
    recordConnectionDecision(pointIndex, pending.candidate, action)
    const point = action === 'connect' ? { ...pending.candidate.position } : { ...pending.point }
    appendPoint(point)
    setPendingRoadConnectionState(null)
  }, [pendingRoadConnection, recordConnectionDecision, appendPoint])

  /** Alt shortcut: keep the raw coordinate and record the decision. */
  const addSeparatePoint = useCallback((pt: LatLng, candidate: ConnectivityCandidate) => {
    const pointIndex = pointsRef.current.length
    recordConnectionDecision(pointIndex, candidate, 'separate')
    appendPoint(pt)
    setPendingRoadConnectionState(null)
  }, [recordConnectionDecision, appendPoint])

  const setTracePointsFn = useCallback((pts: LatLng[]) => {
    // Geometry changed externally (vertex drag / programmatic set) — decisions
    // captured for old coordinates are no longer valid.
    roadConnectionDecisionsRef.current = []
    setPendingRoadConnectionState(null)
    pointsRef.current = [...pts]
    setTracePoints(pts)
  }, [])

  const undoLastPoint = useCallback(() => {
    const nextPoints = pointsRef.current.slice(0, -1)
    pointsRef.current = nextPoints
    roadConnectionDecisionsRef.current = roadConnectionDecisionsRef.current.filter(d => d.pointIndex < nextPoints.length)
    setTracePoints(prev => prev.slice(0, -1))
  }, [])

  const clearTracePoints = useCallback(() => {
    roadConnectionDecisionsRef.current = []
    setPendingRoadConnectionState(null)
    pointsRef.current = []
    setTracePoints([])
  }, [])

  const addDrawPoint = useCallback((pt: LatLng) => {
    setDrawPoints(prev => [...prev, pt])
  }, [])

  const setDrawPointsFn = useCallback((pts: LatLng[]) => {
    setDrawPoints(pts)
  }, [])

  const undoLastDrawPoint = useCallback(() => {
    setDrawPoints(prev => prev.slice(0, -1))
  }, [])

  const clearDrawPoints = useCallback(() => {
    setDrawPoints([])
  }, [])

  const requestConfirm = useCallback((type?: PendingType, pointsOverride?: LatLng[]) => {
    // A pending Connect / Keep Separate decision must be resolved first.
    if (pendingRoadConnection) return
    const connections = roadConnectionDecisionsRef.current.length > 0
      ? [...roadConnectionDecisionsRef.current]
      : undefined
    const points = pointsOverride ?? drawPoints
    if (!type) {
      if (tracePoints.length >= 2) {
        setPendingConfirm({ type: 'route', points: [...tracePoints], ...(connections ? { connections } : {}) })
      } else if (points.length >= 3) {
        setPendingConfirm({ type: 'building', points: [...points] })
      }
      return
    }
    if (type === 'route' && tracePoints.length >= 2) {
      setPendingConfirm({ type: 'route', points: [...tracePoints], ...(connections ? { connections } : {}) })
    } else if ((type === 'building' || type === 'boundary' || type === 'area' || type === 'import-osm' || type === 'set-boundary') && points.length >= 3) {
      setPendingConfirm({ type, points: [...points] })
    }
  }, [tracePoints, drawPoints, pendingRoadConnection])

  const confirm = useCallback((): LatLng[] => {
    const points = pendingConfirm?.points ?? []
    roadConnectionDecisionsRef.current = []
    setPendingRoadConnectionState(null)
    pointsRef.current = []
    setPendingConfirm(null)
    setTracePoints([])
    setDrawPoints([])
    return points
  }, [pendingConfirm])

  const cancel = useCallback(() => {
    roadConnectionDecisionsRef.current = []
    setPendingRoadConnectionState(null)
    pointsRef.current = []
    setPendingConfirm(null)
    setTracePoints([])
    setDrawPoints([])
  }, [])

  const setRouteWidth = useCallback((width: number) => {
    setRouteWidthState(Math.max(2, Math.min(24, width)))
  }, [])

  return {
    tracePoints,
    drawPoints,
    routeWidth,
    roomDrag,
    pendingConfirm,
    pendingRoadConnection,
    setPendingRoadConnection,
    resolveRoadConnection,
    addSeparatePoint,
    addTracePoint,
    setTracePoints: setTracePointsFn,
    undoLastPoint,
    clearTracePoints,
    addDrawPoint,
    setDrawPoints: setDrawPointsFn,
    undoLastDrawPoint,
    clearDrawPoints,
    setRoomDrag,
    requestConfirm,
    confirm,
    cancel,
    setRouteWidth,
    subscribe,
  }
}

export function DrawingSessionProvider({ children, value }: {
  children: ReactNode
  value: DrawingSessionValue
}) {
  return (
    <DrawingSessionContext.Provider value={value}>
      {children}
    </DrawingSessionContext.Provider>
  )
}

export function useDrawingSessionContext(): DrawingSessionValue {
  const ctx = useContext(DrawingSessionContext)
  if (!ctx) {
    throw new Error('useDrawingSessionContext must be used within DrawingSessionProvider')
  }
  return ctx
}
