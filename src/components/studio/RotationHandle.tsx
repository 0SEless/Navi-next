'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useGraphStore } from '@/store/graph-store'

interface RotationHandleProps {
  map: maplibregl.Map
  buildingId: string | null
  onRotate: (buildingId: string, angleDelta: number) => void
}

interface Centroid {
  lat: number
  lng: number
}

function computeCentroid(footprint: { lat: number; lng: number }[]): Centroid | null {
  if (!footprint || footprint.length === 0) return null
  const sum = footprint.reduce(
    (acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }),
    { lat: 0, lng: 0 },
  )
  return { lat: sum.lat / footprint.length, lng: sum.lng / footprint.length }
}

function angleFromCenter(center: Centroid, point: { x: number; y: number }, map: maplibregl.Map) {
  const projected = map.project([center.lng, center.lat])
  const dx = point.x - projected.x
  const dy = point.y - projected.y
  return Math.atan2(dy, dx)
}

export function RotationHandle({ map, buildingId, onRotate }: RotationHandleProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragging = useRef(false)
  const startAngle = useRef(0)
  const centroidRef = useRef<Centroid | null>(null)

  const getCentroid = useCallback(() => {
    if (!buildingId) return null
    const buildings = useGraphStore.getState().graph.buildings
    const building = buildings.find((b) => b.id === buildingId)
    if (!building) return null
    return computeCentroid(building.footprint)
  }, [buildingId])

  const updatePosition = useCallback(() => {
    const centroid = getCentroid()
    if (!centroid) {
      setPos(null)
      return
    }
    centroidRef.current = centroid
    const point = map.project([centroid.lng, centroid.lat])
    setPos({ x: point.x, y: point.y - 60 })
  }, [map, getCentroid])

  useEffect(() => {
    if (!buildingId) {
      setPos(null)
      return
    }
    updatePosition()
    map.on('move', updatePosition)
    return () => {
      try { map.off('move', updatePosition) } catch {}
    }
  }, [map, buildingId, updatePosition])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!centroidRef.current) return

      dragging.current = true
      startAngle.current = angleFromCenter(
        centroidRef.current,
        { x: e.clientX, y: e.clientY },
        map,
      )

      const canvas = map.getCanvas()
      canvas.style.cursor = 'grabbing'

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current || !centroidRef.current) return
        const currentAngle = angleFromCenter(
          centroidRef.current,
          { x: ev.clientX, y: ev.clientY },
          map,
        )
        const delta = currentAngle - startAngle.current
        startAngle.current = currentAngle
        if (buildingId) onRotate(buildingId, delta)
      }

      const onMouseUp = () => {
        dragging.current = false
        canvas.style.cursor = ''
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
      }

      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    },
    [map, buildingId, onRotate],
  )

  if (!pos || !buildingId) return null

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        position: 'absolute',
        left: pos.x - 14,
        top: pos.y - 14,
        width: 28,
        height: 28,
        borderRadius: '50%',
        background: '#0F172A',
        border: '2px solid #3B82F6',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'grab',
        zIndex: 30,
        pointerEvents: 'auto',
        boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        userSelect: 'none',
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#e2e8f0"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21.5 2v6h-6" />
        <path d="M21.34 15.57a10 10 0 1 1-.57-8.38" />
      </svg>
    </div>
  )
}
