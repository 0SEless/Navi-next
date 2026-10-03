'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { Building2, RotateCcw, Search, X } from 'lucide-react'
import { usePublicStore } from '@/store/public-store'
import type { CampusBundle } from '@/types/nav-types'
import {
  filterExploreEntries,
  getExploreCategories,
  type ExploreCategory,
} from '@/lib/explore-contracts'
import { BuildingSheet } from '@/components/map/BuildingSheet'

const ExploreMap = dynamic(() => import('@/components/public/ExploreMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-[var(--navi-text-secondary)]">
      Loading map…
    </div>
  ),
})

export default function ExplorePage() {
  return (
    <Suspense fallback={
      <div className="flex h-full flex-col gap-4 p-4" aria-label="Loading campus map" role="status">
        <div className="h-12 w-full animate-pulse rounded-2xl bg-[var(--navi-border)]/60" />
        <div className="flex-1 animate-pulse rounded-2xl bg-[var(--navi-border)]/40" />
      </div>
    }>
      <ExplorePageContent />
    </Suspense>
  )
}

function ExplorePageContent() {
  const searchParams = useSearchParams()
  const campus = usePublicStore((s) => s.campus)
  const campusLoading = usePublicStore((s) => s.campusLoading)
  const campusError = usePublicStore((s) => s.campusError)
  const fetchCampusData = usePublicStore((s) => s.fetchCampusData)
  const selectBuilding = usePublicStore((s) => s.selectBuilding)
  const setSheet = usePublicStore((s) => s.setSheet)
  const mapAppearance = usePublicStore((s) => s.preferences.mapAppearance)
  const setMapAppearance = usePublicStore((s) => s.setMapAppearance)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ExploreCategory>('all')
  const requestedBuildingId = searchParams.get('building_id')

  useEffect(() => {
    if (!campus && !campusLoading && !campusError) void fetchCampusData()
  }, [campus, campusLoading, campusError, fetchCampusData])

  useEffect(() => {
    if (!campus || !requestedBuildingId) return
    const building = campus.buildings.find(candidate => candidate.id === requestedBuildingId)
    if (!building) return
    selectBuilding(building)
    setSheet('half')
  }, [campus, requestedBuildingId, selectBuilding, setSheet])

  const categories = useMemo(
    () => (campus ? getExploreCategories(campus) : []),
    [campus],
  )
  const results = useMemo(
    () => (campus ? filterExploreEntries(campus, { query, category }) : []),
    [campus, category, query],
  )

  const handleSearchResult = (entry: CampusBundle['searchEntries'][number]) => {
    if (!campus) return
    const building = campus.buildings.find(candidate =>
      candidate.id === entry.buildingId
      || (entry.type === 'building' && candidate.id === entry.id),
    )
    if (!building) return
    selectBuilding(building)
    setSheet('half')
    setSearchOpen(false)
    setQuery('')
    setCategory('all')
  }

  if (campusError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
        <div className="text-sm text-[var(--navi-text-secondary)]">
          Couldn&apos;t load the campus map.
        </div>
        <div className="text-xs text-[var(--navi-error)]">{campusError}</div>
        <button
          type="button"
          onClick={() => void fetchCampusData()}
          className="flex items-center gap-2 rounded-lg bg-[var(--navi-primary)] px-4 py-2 text-sm font-semibold text-white"
          aria-label="Retry loading campus map"
        >
          <RotateCcw className="h-4 w-4" />
          Retry
        </button>
      </div>
    )
  }

  if (!campus || campusLoading) {
    return (
      <div className="flex h-full flex-col gap-4 p-4" aria-label="Loading campus map" role="status">
        <div className="h-12 w-full animate-pulse rounded-2xl bg-[var(--navi-border)]/60" />
        <div className="flex-1 animate-pulse rounded-2xl bg-[var(--navi-border)]/40" />
      </div>
    )
  }

  if (campus.buildings.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <Building2 className="h-8 w-8 text-[var(--navi-text-secondary)]" />
        <div className="text-sm text-[var(--navi-text-secondary)]">
          No buildings available on this campus yet.
        </div>
      </div>
    )
  }

  return (
    <div className="relative flex-1 min-w-0 w-full overflow-hidden">
      <ExploreMap bundle={campus} />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-4">
        <div className="pointer-events-auto min-w-0">
          {!searchOpen ? (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-[var(--navi-border)] bg-[var(--navi-card)] px-3 py-2.5 text-left shadow-lg"
              aria-label="Search campus"
            >
              <Search className="h-4 w-4 shrink-0 text-[var(--navi-text-secondary)]" />
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--navi-text-secondary)]">
                Search rooms, buildings…
              </span>
            </button>
          ) : (
            <div className="max-h-[min(70vh,36rem)] overflow-y-auto rounded-2xl border border-[var(--navi-border)] bg-[var(--navi-card)] p-3 shadow-xl">
              <div className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--navi-border)] px-3">
                <Search className="h-4 w-4 shrink-0 text-[var(--navi-text-secondary)]" />
                <input
                  autoFocus
                  type="search"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-sm text-[var(--navi-text)] outline-none placeholder:text-[var(--navi-text-secondary)]"
                  placeholder="Search published places"
                  aria-label="Search campus places"
                />
                <button
                  type="button"
                  onClick={() => {
                    setSearchOpen(false)
                    setQuery('')
                    setCategory('all')
                  }}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--navi-text-secondary)] hover:bg-[var(--navi-content)]"
                  aria-label="Close campus search"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 flex min-w-0 gap-2 overflow-x-auto pb-1" role="group" aria-label="Explore categories">
                <button
                  type="button"
                  onClick={() => setCategory('all')}
                  aria-pressed={category === 'all'}
                  className="min-h-11 shrink-0 rounded-full border px-3 text-xs font-semibold"
                >
                  All
                </button>
                {categories.map((value) => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => setCategory(value)}
                    aria-pressed={category === value}
                    className="min-h-11 shrink-0 rounded-full border px-3 text-xs font-semibold"
                  >
                    {formatCategoryLabel(value)}
                  </button>
                ))}
              </div>

              <div className="mt-3 flex min-w-0 items-center gap-2" role="group" aria-label="Map presentation">
                <span className="shrink-0 text-[11px] font-semibold text-[var(--navi-text-secondary)]">
                  Map style
                </span>
                <div className="flex min-w-0 gap-1 overflow-x-auto">
                  {(['department', 'navi', 'uniform'] as const).map(mode => (
                    <button
                      type="button"
                      key={mode}
                      onClick={() => setMapAppearance(mode)}
                      aria-pressed={mapAppearance === mode}
                      className="min-h-11 shrink-0 rounded-full border px-3 text-xs font-semibold"
                    >
                      {formatMapAppearanceLabel(mode)}
                    </button>
                  ))}
                </div>
              </div>

              {query.trim() ? (
                results.length > 0 ? (
                  <div className="mt-2 space-y-1" role="listbox" aria-label="Campus search results">
                    {results.slice(0, 12).map(entry => (
                      <button
                        type="button"
                        key={entry.id}
                        onClick={() => handleSearchResult(entry)}
                        className="flex min-h-11 w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-[var(--navi-content)]"
                        aria-label={`Explore ${entry.label}`}
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--navi-text)]">
                          {entry.label}
                        </span>
                        <span className="shrink-0 text-[11px] text-[var(--navi-text-secondary)]">
                          {formatCategoryLabel(entry.type)}
                          {entry.type === 'poi' && entry.category
                            ? ` · ${formatPoiCategoryLabel(entry.category)}`
                            : ''}
                          {entry.floor !== undefined ? ` · F${entry.floor}` : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="px-2 py-4 text-center text-sm text-[var(--navi-text-secondary)]">
                    No matching campus places.
                  </p>
                )
              ) : (
                <p className="px-2 py-4 text-sm text-[var(--navi-text-secondary)]">
                  Search published buildings, rooms, and facilities.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <BuildingSheet bundle={campus} />
    </div>
  )
}

function formatCategoryLabel(category: Exclude<ExploreCategory, 'all'>): string {
  if (category === 'building') return 'Buildings'
  if (category === 'facility') return 'Facilities'
  if (category === 'room') return 'Rooms'
  if (category === 'entrance') return 'Entrances'
  return 'POIs'
}

function formatPoiCategoryLabel(category: string): string {
  return category
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase())
}

function formatMapAppearanceLabel(mode: 'department' | 'navi' | 'uniform'): string {
  if (mode === 'navi') return 'NAVI'
  return mode.charAt(0).toUpperCase() + mode.slice(1)
}
