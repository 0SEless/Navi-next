import { create } from 'zustand'
import type { CampusMap, LandmarkType, LandmarkInstance } from '../types/campus-map'
import { genId } from '@navi/editor'

const STORAGE_KEY = 'navi-campus-maps'

interface CampusMapState {
  maps: CampusMap[]
  selectedMapId: string | null

  createMap: (data: Omit<CampusMap, 'id' | 'createdAt' | 'updatedAt' | 'stats'>) => string
  updateMap: (id: string, data: Partial<CampusMap>) => void
  deleteMap: (id: string) => void
  getMap: (id: string) => CampusMap | undefined
  selectMap: (id: string | null) => void
  updateMapStats: (id: string, stats: Partial<CampusMap['stats']>) => void

  landmarkTypes: LandmarkType[]
  landmarkInstances: LandmarkInstance[]
  addLandmarkType: (type: Omit<LandmarkType, 'id'>) => string
  updateLandmarkType: (id: string, data: Partial<LandmarkType>) => void
  removeLandmarkType: (id: string) => void
  getTypesByMap: (mapId: string) => LandmarkType[]
  addLandmarkInstance: (instance: Omit<LandmarkInstance, 'id'>) => string
  removeLandmarkInstance: (id: string) => void
  getInstancesByMap: (mapId: string) => LandmarkInstance[]

  syncToSupabase: () => Promise<void>
  fetchFromSupabase: () => Promise<void>
  deleteFromSupabase: (mapId: string) => Promise<void>

  load: () => void
  save: () => void
  reset: () => void
}

function generateId(): string {
  return genId('map')
}

export const useCampusMapStore = create<CampusMapState>((set, get) => ({
  maps: [],
  selectedMapId: null,
  landmarkTypes: [],
  landmarkInstances: [],

  createMap: (data) => {
    const id = `map-${generateId()}`
    const now = new Date().toISOString()
    const map: CampusMap = { ...data, id, createdAt: now, updatedAt: now, stats: { buildings: 0, nodes: 0, edges: 0 } }
    set((s) => ({ maps: [...s.maps, map] }))
    get().save()
    return id
  },

  updateMap: (id, data) => {
    set((s) => ({ maps: s.maps.map((m) => (m.id === id ? { ...m, ...data, updatedAt: new Date().toISOString() } : m)) }))
    get().save()
  },

    deleteMap: (id) => {
    set((s) => ({
      maps: s.maps.filter((m) => m.id !== id),
      selectedMapId: s.selectedMapId === id ? null : s.selectedMapId,
      landmarkTypes: s.landmarkTypes.filter((t) => t.mapId !== id),
      landmarkInstances: s.landmarkInstances.filter((i) => i.mapId !== id),
    }))
    get().save()
    get().deleteFromSupabase(id)
  },

  getMap: (id) => get().maps.find((m) => m.id === id),
  selectMap: (id) => set({ selectedMapId: id }),

  updateMapStats: (id, stats) => {
    set((s) => ({
      maps: s.maps.map((m) => (m.id === id ? { ...m, stats: { ...m.stats, ...stats }, updatedAt: new Date().toISOString() } : m)),
    }))
    get().save()
  },

  addLandmarkType: (type) => {
    const id = `ltype-${generateId()}`
    set((s) => ({ landmarkTypes: [...s.landmarkTypes, { ...type, id }] }))
    get().save()
    return id
  },

  updateLandmarkType: (id, data) => {
    set((s) => ({ landmarkTypes: s.landmarkTypes.map((t) => (t.id === id ? { ...t, ...data } : t)) }))
    get().save()
  },

  removeLandmarkType: (id) => {
    set((s) => ({
      landmarkTypes: s.landmarkTypes.filter((t) => t.id !== id),
      landmarkInstances: s.landmarkInstances.filter((i) => i.typeId !== id),
    }))
    get().save()
  },

  getTypesByMap: (mapId) => get().landmarkTypes.filter((t) => t.mapId === mapId),

  addLandmarkInstance: (instance) => {
    const id = `lminst-${generateId()}`
    set((s) => ({ landmarkInstances: [...s.landmarkInstances, { ...instance, id }] }))
    get().save()
    return id
  },

  removeLandmarkInstance: (id) => {
    set((s) => ({ landmarkInstances: s.landmarkInstances.filter((i) => i.id !== id) }))
    get().save()
  },

  getInstancesByMap: (mapId) => get().landmarkInstances.filter((i) => i.mapId === mapId),

  syncToSupabase: async () => {
    if (typeof window === 'undefined') return
    const { maps, landmarkTypes, landmarkInstances } = get()
    for (const map of maps) {
      const types = landmarkTypes.filter((t) => t.mapId === map.id)
      const instances = landmarkInstances.filter((i) => i.mapId === map.id)
      try {
        await fetch('/api/campus-maps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ ...map, landmarkTypes: types, landmarkInstances: instances }),
        })
      } catch (e) { console.warn('[campus-map-store] syncToSupabase failed:', e) }
    }
  },

  fetchFromSupabase: async () => {
    if (typeof window === 'undefined') return
    try {
      const res = await fetch('/api/campus-maps', { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json()
      if (!data.maps || !data.maps.length) return
      const maps: CampusMap[] = []
      const landmarkTypes: LandmarkType[] = []
      const landmarkInstances: LandmarkInstance[] = []
      for (const m of data.maps) {
        maps.push({
          id: m.id, name: m.name, schoolName: m.schoolName, campusName: m.campusName,
          imageUrl: m.imageUrl, boundary: m.boundary, center: m.center,
          createdAt: m.createdAt, updatedAt: m.updatedAt, stats: m.stats,
        })
        if (Array.isArray(m.landmarkTypes)) landmarkTypes.push(...m.landmarkTypes)
        if (Array.isArray(m.landmarkInstances)) landmarkInstances.push(...m.landmarkInstances)
      }
      set({ maps, landmarkTypes, landmarkInstances })
    } catch (e) { console.warn('[campus-map-store] fetchFromSupabase failed:', e) }
  },

  deleteFromSupabase: async (mapId) => {
    if (typeof window === 'undefined') return
    try {
      await fetch(`/api/campus-maps?map_id=${encodeURIComponent(mapId)}`, { method: 'DELETE', credentials: 'include' })
    } catch (e) { console.warn('[campus-map-store] deleteFromSupabase failed:', e) }
  },

  load: () => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw)
        set({
          maps: data.maps || [],
          landmarkTypes: data.landmarkTypes || [],
          landmarkInstances: data.landmarkInstances || [],
        })
      }
    } catch (e) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[campus-map-store] Failed to load from localStorage:', e)
      }
    }
    get().fetchFromSupabase()
  },

  save: () => {
    if (typeof window === 'undefined') return
    const { maps, landmarkTypes, landmarkInstances } = get()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ maps, landmarkTypes, landmarkInstances }))
    get().syncToSupabase()
  },

  reset: () => {
    if (typeof window === 'undefined') return
    localStorage.removeItem(STORAGE_KEY)
    set({ maps: [], selectedMapId: null, landmarkTypes: [], landmarkInstances: [] })
  },
}))
