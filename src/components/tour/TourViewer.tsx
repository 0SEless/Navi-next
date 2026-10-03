'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import 'pannellum/build/pannellum.css'
import type { TourPanorama, TourHotspot, TourViewerState } from './types'
import { InformationCard } from './InformationCard'

type PannellumViewer = {
  destroy: () => void
  getYaw: () => number
  getPitch: () => number
  setYaw: (yaw: number) => void
  setPitch: (pitch: number) => void
  addHotspot: (id: string, config: Record<string, unknown>) => void
  removeHotspot: (id: string) => void
  on: (event: string, callback: () => void) => void
}

declare global {
  interface Window {
    pannellum?: {
      viewer: (container: HTMLElement, config: Record<string, unknown>) => PannellumViewer
    }
  }
}

interface TourViewerProps {
  panoramas: TourPanorama[]
  initialIndex?: number
  onPanoramaChange?: (index: number) => void
  className?: string
}

export function TourViewer({
  panoramas,
  initialIndex = 0,
  onPanoramaChange,
  className = '',
}: TourViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PannellumViewer | null>(null)
  const scriptLoadedRef = useRef(false)

  const [state, setState] = useState<TourViewerState>({
    currentPanoramaIndex: initialIndex,
    isLoading: true,
    error: null,
    isFullscreen: false,
    heading: 0,
  })

  const [selectedInformation, setSelectedInformation] = useState<TourHotspot | null>(null)

  const currentPanorama = panoramas[state.currentPanoramaIndex]

  // Sync initialIndex prop with internal state
  useEffect(() => {
    if (initialIndex >= 0 && initialIndex < panoramas.length) {
      setState(prev => ({
        ...prev,
        currentPanoramaIndex: initialIndex,
      }))
    }
  }, [initialIndex, panoramas.length])

  // Initialize Pannellum viewer
  const initViewer = useCallback(() => {
    if (!containerRef.current || !currentPanorama) return

    // Destroy existing viewer
    if (viewerRef.current) {
      viewerRef.current.destroy()
      viewerRef.current = null
    }

    try {
      viewerRef.current = window.pannellum!.viewer(containerRef.current, {
        type: 'equirectangular',
        panorama: currentPanorama.imageUrl,
        autoLoad: true,
        compass: true,
        hotSpots: currentPanorama.hotspots.map(hotspot => ({
          id: hotspot.id,
          yaw: hotspot.yaw,
          pitch: hotspot.pitch,
          type: hotspot.type === 'navigation' ? 'scene' : 'info',
          text: hotspot.label,
          sceneId: hotspot.type === 'navigation' ? hotspot.targetPanoramaId : undefined,
          clickHandlerFunc: hotspot.type === 'information'
            ? () => setSelectedInformation(hotspot)
            : undefined,
        })),
      })

      // Track heading changes
      viewerRef.current.on('mouseup', () => {
        if (viewerRef.current) {
          setState(prev => ({
            ...prev,
            heading: Math.round(viewerRef.current!.getYaw()),
          }))
        }
      })

      setState(prev => ({ ...prev, isLoading: false, error: null }))
    } catch (err) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to initialize viewer',
      }))
    }
  }, [currentPanorama])

  // Load Pannellum script
  useEffect(() => {
    if (window.pannellum) {
      scriptLoadedRef.current = true
      initViewer()
    } else if (!scriptLoadedRef.current) {
      const script = document.createElement('script')
      script.src = '/pannellum.js'
      script.onload = initViewer
      script.onerror = () => {
        setState(prev => ({
          ...prev,
          isLoading: false,
          error: 'Failed to load Pannellum library',
        }))
      }
      document.body.appendChild(script)
    }

    return () => {
      if (viewerRef.current) {
        viewerRef.current.destroy()
        viewerRef.current = null
      }
    }
  }, [initViewer])

  // Reinitialize when panorama changes
  useEffect(() => {
    if (scriptLoadedRef.current) {
      initViewer()
    }
  }, [state.currentPanoramaIndex, initViewer])

  // Handle panorama navigation
  const navigateToPanorama = useCallback((index: number) => {
    if (index >= 0 && index < panoramas.length) {
      setState(prev => ({ ...prev, currentPanoramaIndex: index }))
      onPanoramaChange?.(index)
    }
  }, [panoramas.length, onPanoramaChange])

  // Handle navigation hotspot clicks
  useEffect(() => {
    if (!viewerRef.current) return

    const hotspots = currentPanorama?.hotspots || []
    const navigationHotspots = hotspots.filter(h => h.type === 'navigation')

    navigationHotspots.forEach(hotspot => {
      if (hotspot.targetPanoramaId) {
        const targetIndex = panoramas.findIndex(p => p.id === hotspot.targetPanoramaId)
        if (targetIndex !== -1) {
          // Guard against missing methods (e.g., in test environments)
          if (typeof viewerRef.current!.removeHotspot === 'function') {
            viewerRef.current!.removeHotspot(hotspot.id)
          }
          if (typeof viewerRef.current!.addHotspot === 'function') {
            viewerRef.current!.addHotspot(hotspot.id, {
              yaw: hotspot.yaw,
              pitch: hotspot.pitch,
              type: 'scene',
              text: hotspot.label,
              sceneId: hotspot.targetPanoramaId,
              clickHandlerFunc: () => navigateToPanorama(targetIndex),
            })
          }
        }
      }
    })
  }, [currentPanorama, panoramas, navigateToPanorama])

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen()
      setState(prev => ({ ...prev, isFullscreen: true }))
    } else {
      document.exitFullscreen()
      setState(prev => ({ ...prev, isFullscreen: false }))
    }
  }, [])

  // Listen for fullscreen changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      setState(prev => ({
        ...prev,
        isFullscreen: !!document.fullscreenElement,
      }))
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedInformation) {
          setSelectedInformation(null)
        } else if (state.isFullscreen) {
          toggleFullscreen()
        }
      } else if (e.key === 'ArrowLeft') {
        navigateToPanorama(state.currentPanoramaIndex - 1)
      } else if (e.key === 'ArrowRight') {
        navigateToPanorama(state.currentPanoramaIndex + 1)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedInformation, state.isFullscreen, state.currentPanoramaIndex, navigateToPanorama, toggleFullscreen])

  if (panoramas.length === 0) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 rounded-xl ${className}`}>
        <p className="text-gray-500">No panoramas available</p>
      </div>
    )
  }

  return (
    <div className={`relative ${className}`}>
      {/* Main viewer */}
      <div
        ref={containerRef}
        className="w-full h-full rounded-xl overflow-hidden"
        style={{ minHeight: '400px' }}
      />

      {/* Loading state */}
      {state.isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 rounded-xl">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
            <p className="text-gray-600">Loading panorama...</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {state.error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-50 rounded-xl">
          <div className="text-center p-6">
            <div className="text-red-500 text-4xl mb-4">!</div>
            <p className="text-red-700 font-medium">{state.error}</p>
            <button
              onClick={() => {
                setState(prev => ({ ...prev, error: null, isLoading: true }))
                initViewer()
              }}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Controls overlay */}
      <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
        {/* Navigation arrows */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigateToPanorama(state.currentPanoramaIndex - 1)}
            disabled={state.currentPanoramaIndex === 0}
            className="p-2 bg-black/50 text-white rounded-full hover:bg-black/70 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Previous panorama"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <span className="text-white text-sm bg-black/50 px-3 py-1 rounded-full">
            {state.currentPanoramaIndex + 1} / {panoramas.length}
          </span>

          <button
            onClick={() => navigateToPanorama(state.currentPanoramaIndex + 1)}
            disabled={state.currentPanoramaIndex === panoramas.length - 1}
            className="p-2 bg-black/50 text-white rounded-full hover:bg-black/70 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Next panorama"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Fullscreen and compass */}
        <div className="flex items-center gap-2">
          {/* Compass */}
          <div className="bg-black/50 text-white px-3 py-1 rounded-full text-sm">
            {state.heading}°
          </div>

          {/* Fullscreen button */}
          <button
            onClick={toggleFullscreen}
            className="p-2 bg-black/50 text-white rounded-full hover:bg-black/70"
            aria-label={state.isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {state.isFullscreen ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Panorama title */}
      <div className="absolute top-4 left-4">
        <div className="bg-black/50 text-white px-3 py-1 rounded-full text-sm">
          {currentPanorama?.label || `Panorama ${state.currentPanoramaIndex + 1}`}
        </div>
      </div>

      {/* Information card modal */}
      {selectedInformation && selectedInformation.content && (
        <InformationCard
          content={selectedInformation.content}
          onClose={() => setSelectedInformation(null)}
        />
      )}
    </div>
  )
}