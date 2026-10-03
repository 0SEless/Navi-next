import type maplibregl from 'maplibre-gl'

const STYLE_READINESS_EVENTS = ['load', 'style.load', 'styledata', 'idle'] as const

/** Run once when the current MapLibre style is ready, including after a late mount. */
export function whenMapStyleReady(map: maplibregl.Map, onReady: () => void): () => void {
  let active = true

  const removeListeners = () => {
    for (const event of STYLE_READINESS_EVENTS) map.off(event, checkReadiness)
  }

  const checkReadiness = () => {
    if (!active || !map.isStyleLoaded()) return
    active = false
    removeListeners()
    onReady()
  }

  if (map.isStyleLoaded()) {
    active = false
    onReady()
    return () => undefined
  }

  for (const event of STYLE_READINESS_EVENTS) map.on(event, checkReadiness)
  // Recheck after subscribing so readiness cannot transition between the
  // initial check and listener registration without being observed.
  checkReadiness()

  return () => {
    if (!active) return
    active = false
    removeListeners()
  }
}
