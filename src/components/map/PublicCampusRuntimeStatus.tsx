'use client'

import { useEffect, useMemo, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import { usePublicStore } from '@/store/public-store'
import type { CampusBundle } from '@/types/nav-types'
import { useNavigationMap } from './NavigationMap'
import { getCachedNavigationRenderModel } from './NavigationRenderModel'
import { buildPoiGeoJSON } from './layers/POILayer'
import { tracesToGeoJSON } from './authoredTraceGeoJSON'

type Phase = 'loading' | 'interactive' | 'error'

export function PublicCampusRuntimeStatus() {
  const { map, isReady, isActive, hostRequested } = useNavigationMap()
  const campus = usePublicStore((store) => store.campus)
  const campusStatus = usePublicStore((store) => store.campusStatus)
  const campusLoading = usePublicStore((store) => store.campusLoading)
  const requirements = useMemo(() => {
    if (!campus) return []
    const model = getCachedNavigationRenderModel(campus)
    return [
      { source: 'buildings', ids: model.buildings.map((building) => building.id), layers: ['buildings-fill', 'buildings-outline', 'buildings-extrusion', 'buildings-labels'] },
      { source: 'pois', ids: buildPoiGeoJSON([], [], campus.poi.filter((poi) => poi.scope === 'outdoor')).features.map((feature) => feature.id), layers: ['pois-layer', 'pois-outdoor-fill', 'pois-outdoor-outline', 'pois-outdoor-extrusion'] },
      { source: 'authored-roads', ids: tracesToGeoJSON(campus.traces ?? []).features.map((feature) => feature.id), layers: ['authored-roads-outline', 'authored-roads-fill', 'authored-roads-path'] },
    ].filter((required) => required.ids.length > 0)
  }, [campus])
  const [result, setResult] = useState<{ map: maplibregl.Map | null; campus: CampusBundle | null; phase: Phase }>({ map: null, campus: null, phase: 'loading' })
  const phase = result.map === map && result.campus === campus ? result.phase : 'loading'

  useEffect(() => {
    if (!isActive) return
    let active = true
    let settled = false
    let generation = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const publish = (next: Phase) => {
      if (active) setResult((previous) => previous.map === map && previous.campus === campus && previous.phase === next
        ? previous : { map, campus, phase: next })
    }
    const startWatchdog = () => {
      if (timer !== undefined) return
      // Recovery only: source/layer events, not this deadline, establish readiness.
      timer = setTimeout(() => { if (active && !settled) publish('error') }, 20_000)
    }
    const attached = () => map && requirements.every((required) => map.getSource(required.source)
      && required.layers.every((layer) => map.getLayer(layer)))
    const check = async () => {
      const current = ++generation
      if (settled && attached()) return
      if (settled) publish('loading')
      settled = false
      startWatchdog()
      await Promise.resolve()
      if (!active || current !== generation) return
      if (!map || !isReady || !campus || !map.isStyleLoaded() || !attached()) return
      for (const required of requirements) {
        if (!map.isSourceLoaded(required.source)) return
        const data = await (map.getSource(required.source) as maplibregl.GeoJSONSource).getData()
        if (!active || current !== generation) return
        const ids = new Set(data.type === 'FeatureCollection' ? data.features.map((feature) => feature.properties?.id ?? feature.id) : [])
        if (!required.ids.every((id) => ids.has(id))) return
      }
      settled = true
      clearTimeout(timer)
      timer = undefined
      publish('interactive')
    }
    const schedule = () => { void check().catch(() => { if (active) publish('error') }) }
    const invalidate = () => {
      settled = false
      publish('loading')
      schedule()
    }
    const events = ['load', 'idle', 'sourcedata', 'styledata'] as const
    for (const event of events) map?.on(event, schedule)
    map?.on('style.load', invalidate)
    startWatchdog()
    schedule()
    return () => {
      active = false
      generation++
      clearTimeout(timer)
      for (const event of events) map?.off(event, schedule)
      map?.off('style.load', invalidate)
    }
  }, [campus, hostRequested, isActive, isReady, map, requirements])

  if (!isActive) return null
  return <>
    <output hidden data-testid="public-campus-runtime-state" data-state={phase} data-campus-status={campusStatus} data-campus-loading={String(campusLoading)} data-map-requested={String(hostRequested)} />
    {(hostRequested || phase === 'error') && phase !== 'interactive' && <div className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--navi-content)]/30">
      <div className="mx-4 flex items-center gap-3 rounded-2xl border border-[var(--navi-border)] bg-[var(--navi-card)] px-4 py-3 text-sm text-[var(--navi-text)] shadow-lg" role={phase === 'error' ? 'alert' : 'status'} aria-live="polite">
        {phase === 'error' ? <div>
          <p>Campus map could not finish loading.</p>
          <button type="button" className="mt-2 font-semibold text-[var(--navi-accent)]" onClick={() => window.location.reload()}>Reload campus map</button>
        </div> : <>
          <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--navi-border)] border-t-[var(--navi-accent)]" />
          <span>Loading campus map…</span>
        </>}
      </div>
    </div>}
  </>
}
