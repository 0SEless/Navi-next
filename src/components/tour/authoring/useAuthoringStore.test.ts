import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAuthoringStore, createEmptyTour } from './useAuthoringStore'
import type { Panorama, PanoramaHotspot } from '@navi/core'

describe('useAuthoringStore', () => {
  const mockPanorama: Panorama = {
    id: 'pano-1',
    label: 'Test Panorama',
    position: { lat: 14.5995, lng: 120.9842 },
    heading: 90,
    imageAssetId: 'img-1',
    hotspots: [],
  }

  const mockHotspot: PanoramaHotspot = {
    hotspotType: 'navigation',
    target: { type: 'panorama', targetId: 'pano-2' },
    position: { yaw: 120, pitch: 0 },
    label: 'Go to next',
  }

  describe('Tour management', () => {
    it('should create an empty tour', () => {
      const tour = createEmptyTour()
      expect(tour.name).toBe('New 360 Tour')
      expect(tour.panoramas).toHaveLength(0)
    })

    it('should update tour name', () => {
      const { result } = renderHook(() => useAuthoringStore())
      act(() => {
        result.current[1].updateTourName('My Tour')
      })
      expect(result.current[0].tour.name).toBe('My Tour')
      expect(result.current[0].isDirty).toBe(true)
    })
  })

  describe('Panorama management', () => {
    it('should add a panorama', () => {
      const { result } = renderHook(() => useAuthoringStore())
      act(() => {
        result.current[1].addPanorama(mockPanorama)
      })
      expect(result.current[0].tour.panoramas).toHaveLength(1)
      expect(result.current[0].tour.panoramas[0].id).toBe('pano-1')
    })

    it('should update a panorama', () => {
      const { result } = renderHook(() => useAuthoringStore())
      act(() => {
        result.current[1].addPanorama(mockPanorama)
      })
      act(() => {
        result.current[1].updatePanorama('pano-1', { label: 'Updated' })
      })
      expect(result.current[0].tour.panoramas[0].label).toBe('Updated')
    })

    it('should remove a panorama', () => {
      const { result } = renderHook(() => useAuthoringStore())
      act(() => {
        result.current[1].addPanorama(mockPanorama)
      })
      act(() => {
        result.current[1].removePanorama('pano-1')
      })
      expect(result.current[0].tour.panoramas).toHaveLength(0)
    })

    it('should select a panorama', () => {
      const { result } = renderHook(() => useAuthoringStore())
      act(() => {
        result.current[1].addPanorama(mockPanorama)
      })
      act(() => {
        result.current[1].selectPanorama('pano-1')
      })
      expect(result.current[0].selectedPanoramaId).toBe('pano-1')
    })

    it('should deselect panorama on remove', () => {
      const { result } = renderHook(() => useAuthoringStore())
      act(() => {
        result.current[1].addPanorama(mockPanorama)
      })
      act(() => {
        result.current[1].selectPanorama('pano-1')
      })
      act(() => {
        result.current[1].removePanorama('pano-1')
      })
      expect(result.current[0].selectedPanoramaId).toBeNull()
    })
  })

  describe('Hotspot management', () => {
    beforeEach(() => {
      // Setup with a panorama
    })

    it('should add a hotspot to a panorama', () => {
      const { result } = renderHook(() => useAuthoringStore())
      act(() => {
        result.current[1].addPanorama(mockPanorama)
      })
      act(() => {
        result.current[1].addHotspot('pano-1', mockHotspot)
      })
      expect(result.current[0].tour.panoramas[0].hotspots).toHaveLength(1)
      expect(result.current[0].tour.panoramas[0].hotspots[0].label).toBe('Go to next')
    })

    it('should update a hotspot', () => {
      const { result } = renderHook(() => useAuthoringStore())
      act(() => {
        result.current[1].addPanorama(mockPanorama)
      })
      act(() => {
        result.current[1].addHotspot('pano-1', mockHotspot)
      })
      act(() => {
        result.current[1].updateHotspot('pano-1', 0, { label: 'Updated' })
      })
      expect(result.current[0].tour.panoramas[0].hotspots[0].label).toBe('Updated')
    })

    it('should remove a hotspot', () => {
      const { result } = renderHook(() => useAuthoringStore())
      act(() => {
        result.current[1].addPanorama(mockPanorama)
      })
      act(() => {
        result.current[1].addHotspot('pano-1', mockHotspot)
      })
      act(() => {
        result.current[1].removeHotspot('pano-1', 0)
      })
      expect(result.current[0].tour.panoramas[0].hotspots).toHaveLength(0)
    })

    it('should select a hotspot', () => {
      const { result } = renderHook(() => useAuthoringStore())
      act(() => {
        result.current[1].addPanorama(mockPanorama)
      })
      act(() => {
        result.current[1].addHotspot('pano-1', mockHotspot)
      })
      act(() => {
        result.current[1].selectHotspot(0)
      })
      expect(result.current[0].selectedHotspotIndex).toBe(0)
    })
  })

  describe('Content management', () => {
    it('should update hotspot content', () => {
      const { result } = renderHook(() => useAuthoringStore())
      const infoHotspot: PanoramaHotspot = {
        hotspotType: 'information',
        target: { type: 'url', targetId: '' },
        position: { yaw: 0, pitch: -10 },
        label: 'Info',
        content: { title: 'Old Title' },
      }
      act(() => {
        result.current[1].addPanorama(mockPanorama)
      })
      act(() => {
        result.current[1].addHotspot('pano-1', infoHotspot)
      })
      act(() => {
        result.current[1].updateHotspotContent('pano-1', 0, { title: 'New Title' })
      })
      expect(result.current[0].tour.panoramas[0].hotspots[0].content?.title).toBe('New Title')
    })
  })

  describe('Validation', () => {
    it('should pass validation for valid tour', () => {
      const { result } = renderHook(() => useAuthoringStore())
      act(() => {
        result.current[1].addPanorama(mockPanorama)
      })
      const errors = result.current[1].validate()
      expect(errors).toHaveLength(0)
    })

    it('should fail validation for outdoor panorama with LocalCoord', () => {
      const { result } = renderHook(() => useAuthoringStore())
      const badPanorama: Panorama = {
        id: 'bad-pano',
        label: 'Bad Outdoor',
        position: { x: 10, y: 20 },
        heading: 0,
        imageAssetId: 'img',
        hotspots: [],
      }
      act(() => {
        result.current[1].addPanorama(badPanorama)
      })
      const errors = result.current[1].validate()
      expect(errors.length).toBeGreaterThan(0)
      expect(errors[0]).toContain('outdoor')
    })
  })

  describe('Export', () => {
    it('should export the tour definition', () => {
      const { result } = renderHook(() => useAuthoringStore())
      act(() => {
        result.current[1].addPanorama(mockPanorama)
      })
      const tour = result.current[1].exportTour()
      expect(tour.panoramas).toHaveLength(1)
      expect(tour.panoramas[0].id).toBe('pano-1')
    })
  })
})
