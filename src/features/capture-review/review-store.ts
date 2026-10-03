import { create } from 'zustand'
import type { CaptureReviewSelection, ReviewDecision, ReviewLayerKey } from './types'

export const CAPTURE_REVIEW_STORAGE_KEY = 'navi-capture-review-v1'

const DEFAULT_LAYERS: Record<ReviewLayerKey, boolean> = {
  rawGps: true,
  candidateRoute: true,
  candidateNodes: true,
  markers: true,
  gpsWarnings: true,
}

export interface ReviewStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export interface CaptureReviewStoreState {
  selectedItemId: string | null
  layers: Record<ReviewLayerKey, boolean>
  selectionsBySessionId: Record<string, CaptureReviewSelection>
  hydrated: boolean
  hydrate: () => Promise<void>
  setSelectedItem: (id: string | null) => void
  setLayerVisible: (layer: ReviewLayerKey, visible: boolean) => void
  setRouteSegmentDecision: (sessionId: string, segmentId: string, decision: ReviewDecision) => void
  setMarkerDecision: (sessionId: string, markerId: string, decision: ReviewDecision) => void
  getSelection: (sessionId: string) => CaptureReviewSelection
  resetForTests: () => void
}

function cloneSelection(selection: CaptureReviewSelection): CaptureReviewSelection {
  return {
    routeSegments: { ...selection.routeSegments },
    markers: { ...selection.markers },
  }
}

export function getDefaultCaptureReviewSelection(): CaptureReviewSelection {
  return { routeSegments: {}, markers: {} }
}

function browserStorage(): ReviewStorage | undefined {
  if (typeof window === 'undefined' || !window.localStorage) return undefined
  return window.localStorage
}

function persistedState(state: Pick<CaptureReviewStoreState, 'selectedItemId' | 'layers' | 'selectionsBySessionId'>) {
  return {
    schemaVersion: 1,
    selectedItemId: state.selectedItemId,
    layers: state.layers,
    selectionsBySessionId: state.selectionsBySessionId,
  }
}

function readState(storage: ReviewStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(CAPTURE_REVIEW_STORAGE_KEY) ?? 'null') as Record<string, unknown> | null
    if (!parsed || parsed.schemaVersion !== 1) return null
    const layers = parsed.layers as Record<string, unknown> | undefined
    const selections = parsed.selectionsBySessionId as Record<string, CaptureReviewSelection> | undefined
    return {
      selectedItemId: typeof parsed.selectedItemId === 'string' ? parsed.selectedItemId : null,
      layers: {
        ...DEFAULT_LAYERS,
        ...Object.fromEntries(Object.entries(layers ?? {}).filter(([key, value]) => key in DEFAULT_LAYERS && typeof value === 'boolean')),
      } as Record<ReviewLayerKey, boolean>,
      selectionsBySessionId: selections && typeof selections === 'object' ? selections : {},
    }
  } catch {
    return null
  }
}

export function createMemoryReviewStorage(): ReviewStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

export function createCaptureReviewStore(storage: ReviewStorage | undefined = browserStorage()) {
  return create<CaptureReviewStoreState>((set, get) => {
    const persist = () => {
      try {
        storage?.setItem(CAPTURE_REVIEW_STORAGE_KEY, JSON.stringify(persistedState(get())))
      } catch {
        // Review state is useful but non-critical; an unavailable storage must not break review.
      }
    }

    const selectionFor = (state: CaptureReviewStoreState, sessionId: string) =>
      cloneSelection(state.selectionsBySessionId[sessionId] ?? getDefaultCaptureReviewSelection())

    return {
      selectedItemId: null,
      layers: { ...DEFAULT_LAYERS },
      selectionsBySessionId: {},
      hydrated: false,

      async hydrate() {
        const restored = storage ? readState(storage) : null
        if (restored) set({ ...restored, hydrated: true })
        else set({ hydrated: true })
      },

      setSelectedItem(id) {
        set({ selectedItemId: id })
        persist()
      },

      setLayerVisible(layer, visible) {
        set((state) => ({ layers: { ...state.layers, [layer]: visible } }))
        persist()
      },

      setRouteSegmentDecision(sessionId, segmentId, decision) {
        set((state) => {
          const selection = selectionFor(state, sessionId)
          return {
            selectionsBySessionId: {
              ...state.selectionsBySessionId,
              [sessionId]: {
                ...selection,
                routeSegments: { ...selection.routeSegments, [segmentId]: decision },
              },
            },
          }
        })
        persist()
      },

      setMarkerDecision(sessionId, markerId, decision) {
        set((state) => {
          const selection = selectionFor(state, sessionId)
          return {
            selectionsBySessionId: {
              ...state.selectionsBySessionId,
              [sessionId]: {
                ...selection,
                markers: { ...selection.markers, [markerId]: decision },
              },
            },
          }
        })
        persist()
      },

      getSelection(sessionId) {
        return selectionFor(get(), sessionId)
      },

      resetForTests() {
        storage?.removeItem(CAPTURE_REVIEW_STORAGE_KEY)
        set({ selectedItemId: null, layers: { ...DEFAULT_LAYERS }, selectionsBySessionId: {}, hydrated: false })
      },
    }
  })
}

export type CaptureReviewStore = ReturnType<typeof createCaptureReviewStore>

export const useCaptureReviewStore = createCaptureReviewStore()
