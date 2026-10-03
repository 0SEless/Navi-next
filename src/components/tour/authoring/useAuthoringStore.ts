import { useState, useCallback } from 'react'
import type { Panorama, PanoramaHotspot, HotspotContent } from '@navi/core'
import { validatePanoramaCoordinates } from '@navi/core'

export interface TourDefinition {
  id: string
  name: string
  panoramas: Panorama[]
  createdAt: string
  updatedAt: string
}

export interface AuthoringState {
  tour: TourDefinition
  selectedPanoramaId: string | null
  selectedHotspotIndex: number | null
  isDirty: boolean
  errors: string[]
}

export interface AuthoringActions {
  updateTourName: (name: string) => void
  addPanorama: (panorama: Panorama) => void
  updatePanorama: (id: string, updates: Partial<Panorama>) => void
  removePanorama: (id: string) => void
  selectPanorama: (id: string | null) => void
  addHotspot: (panoramaId: string, hotspot: PanoramaHotspot) => void
  updateHotspot: (panoramaId: string, hotspotIndex: number, updates: Partial<PanoramaHotspot>) => void
  removeHotspot: (panoramaId: string, hotspotIndex: number) => void
  selectHotspot: (index: number | null) => void
  updateHotspotContent: (panoramaId: string, hotspotIndex: number, content: Partial<HotspotContent>) => void
  validate: () => string[]
  exportTour: () => TourDefinition
}

export function useAuthoringStore(initialTour?: TourDefinition): [AuthoringState, AuthoringActions] {
  const [state, setState] = useState<AuthoringState>({
    tour: initialTour ?? createEmptyTour(),
    selectedPanoramaId: null,
    selectedHotspotIndex: null,
    isDirty: false,
    errors: [],
  })

  const updateTourName = useCallback((name: string) => {
    setState(prev => ({
      ...prev,
      tour: { ...prev.tour, name, updatedAt: new Date().toISOString() },
      isDirty: true,
    }))
  }, [])

  const addPanorama = useCallback((panorama: Panorama) => {
    setState(prev => ({
      ...prev,
      tour: {
        ...prev.tour,
        panoramas: [...prev.tour.panoramas, panorama],
        updatedAt: new Date().toISOString(),
      },
      isDirty: true,
    }))
  }, [])

  const updatePanorama = useCallback((id: string, updates: Partial<Panorama>) => {
    setState(prev => ({
      ...prev,
      tour: {
        ...prev.tour,
        panoramas: prev.tour.panoramas.map(p =>
          p.id === id ? { ...p, ...updates } : p
        ),
        updatedAt: new Date().toISOString(),
      },
      isDirty: true,
    }))
  }, [])

  const removePanorama = useCallback((id: string) => {
    setState(prev => ({
      ...prev,
      tour: {
        ...prev.tour,
        panoramas: prev.tour.panoramas.filter(p => p.id !== id),
        updatedAt: new Date().toISOString(),
      },
      selectedPanoramaId: prev.selectedPanoramaId === id ? null : prev.selectedPanoramaId,
      isDirty: true,
    }))
  }, [])

  const selectPanorama = useCallback((id: string | null) => {
    setState(prev => ({
      ...prev,
      selectedPanoramaId: id,
      selectedHotspotIndex: null,
    }))
  }, [])

  const addHotspot = useCallback((panoramaId: string, hotspot: PanoramaHotspot) => {
    setState(prev => ({
      ...prev,
      tour: {
        ...prev.tour,
        panoramas: prev.tour.panoramas.map(p =>
          p.id === panoramaId
            ? { ...p, hotspots: [...p.hotspots, hotspot] }
            : p
        ),
        updatedAt: new Date().toISOString(),
      },
      isDirty: true,
    }))
  }, [])

  const updateHotspot = useCallback((panoramaId: string, hotspotIndex: number, updates: Partial<PanoramaHotspot>) => {
    setState(prev => ({
      ...prev,
      tour: {
        ...prev.tour,
        panoramas: prev.tour.panoramas.map(p =>
          p.id === panoramaId
            ? {
                ...p,
                hotspots: p.hotspots.map((h, i) =>
                  i === hotspotIndex ? { ...h, ...updates } : h
                ),
              }
            : p
        ),
        updatedAt: new Date().toISOString(),
      },
      isDirty: true,
    }))
  }, [])

  const removeHotspot = useCallback((panoramaId: string, hotspotIndex: number) => {
    setState(prev => ({
      ...prev,
      tour: {
        ...prev.tour,
        panoramas: prev.tour.panoramas.map(p =>
          p.id === panoramaId
            ? { ...p, hotspots: p.hotspots.filter((_, i) => i !== hotspotIndex) }
            : p
        ),
        updatedAt: new Date().toISOString(),
      },
      selectedHotspotIndex: prev.selectedHotspotIndex === hotspotIndex ? null : prev.selectedHotspotIndex,
      isDirty: true,
    }))
  }, [])

  const selectHotspot = useCallback((index: number | null) => {
    setState(prev => ({
      ...prev,
      selectedHotspotIndex: index,
    }))
  }, [])

  const updateHotspotContent = useCallback((panoramaId: string, hotspotIndex: number, content: Partial<HotspotContent>) => {
    setState(prev => ({
      ...prev,
      tour: {
        ...prev.tour,
        panoramas: prev.tour.panoramas.map(p =>
          p.id === panoramaId
            ? {
                ...p,
                hotspots: p.hotspots.map((h, i) =>
                  i === hotspotIndex
                    ? { ...h, content: { ...h.content, ...content } }
                    : h
                ),
              }
            : p
        ),
        updatedAt: new Date().toISOString(),
      },
      isDirty: true,
    }))
  }, [])

  const validate = useCallback((): string[] => {
    const errors: string[] = []
    for (const panorama of state.tour.panoramas) {
      const issues = validatePanoramaCoordinates(panorama)
      for (const issue of issues) {
        if (issue.severity === 'error') {
          errors.push(issue.message)
        }
      }
    }
    setState(prev => ({ ...prev, errors }))
    return errors
  }, [state.tour.panoramas])

  const exportTour = useCallback((): TourDefinition => {
    return { ...state.tour }
  }, [state.tour])

  return [state, {
    updateTourName,
    addPanorama,
    updatePanorama,
    removePanorama,
    selectPanorama,
    addHotspot,
    updateHotspot,
    removeHotspot,
    selectHotspot,
    updateHotspotContent,
    validate,
    exportTour,
  }]
}

export function createEmptyTour(): TourDefinition {
  return {
    id: `tour-${Date.now()}`,
    name: 'New 360 Tour',
    panoramas: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}
