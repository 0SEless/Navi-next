'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Clock, DoorOpen, MapPin, Navigation, RotateCcw, Search, X } from 'lucide-react'
import { usePublicStore } from '@/store/public-store'
import { floorLabel, groupResults } from '@/lib/search-format'
import { useHydrated } from '@/hooks/useHydrated'
import type { SearchEntry } from '@/types/nav-types'

const DEBOUNCE_MS = 200

export default function SearchPage() {
  const router = useRouter()
  const hydrated = useHydrated()
  const campus = usePublicStore((s) => s.campus)
  const campusLoading = usePublicStore((s) => s.campusLoading)
  const campusError = usePublicStore((s) => s.campusError)
  const fetchCampusData = usePublicStore((s) => s.fetchCampusData)
  const search = usePublicStore((s) => s.search)
  const setTo = usePublicStore((s) => s.setTo)
  const addRecentSearch = usePublicStore((s) => s.addRecentSearch)
  const recentSearches = usePublicStore((s) => s.recentSearches)

  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!campus && !campusLoading && !campusError) void fetchCampusData()
  }, [campus, campusLoading, campusError, fetchCampusData])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebounced(query), DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  const results = useMemo(() => search(debounced), [search, debounced])
  const groups = useMemo(
    () => groupResults(results, campus?.buildings ?? []),
    [results, campus],
  )

  const handleClear = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setQuery('')
    setDebounced('')
  }

  const select = (entry: SearchEntry) => {
    addRecentSearch(entry.label)
    if (!entry.nodeId) {
      if (entry.buildingId) {
        router.push(`/map/explore?building_id=${encodeURIComponent(entry.buildingId)}`)
      }
      return
    }
    setTo(entry.nodeId)
    router.push(`/map/navigate?to=${encodeURIComponent(entry.nodeId)}`)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const q = query.trim()
      if (!q) return
      const matches = search(q)
      if (matches.length > 0) select(matches[0])
    } else if (e.key === 'Escape') {
      handleClear()
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Sticky search bar */}
      <div className="sticky top-0 z-20 border-b border-[var(--navi-border)] bg-[var(--navi-card)] p-3">
        <div className="flex items-center gap-2 rounded-xl border border-[var(--navi-border)] bg-[var(--navi-card)] px-3 py-2.5 shadow-sm">
          <Search className="h-4 w-4 shrink-0 text-[var(--navi-text-secondary)]" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search rooms, buildings, and POIs…"
            aria-label="Search campus"
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--navi-text)] outline-none placeholder:text-[var(--navi-text-secondary)]"
          />
          {query && (
            <button
              onClick={handleClear}
              className="rounded-full p-1 text-[var(--navi-text-secondary)] hover:text-[var(--navi-text)]"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {campusError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center">
          <div className="text-sm text-[var(--navi-text-secondary)]">
            Couldn't load the campus search index.
          </div>
          <div className="text-xs text-[var(--navi-error)]">{campusError}</div>
          <button
            onClick={() => void fetchCampusData()}
            className="flex items-center gap-2 rounded-lg bg-[var(--navi-primary)] px-4 py-2 text-sm font-semibold text-white"
          >
            <RotateCcw className="h-4 w-4" />
            Retry
          </button>
        </div>
      ) : !campus || campusLoading ? (
        <div className="flex flex-1 flex-col gap-4 p-4">
          <div className="h-10 w-full animate-pulse rounded-xl bg-[var(--navi-border)]/60" />
          <div className="h-24 w-full animate-pulse rounded-2xl bg-[var(--navi-border)]/40" />
          <div className="h-24 w-full animate-pulse rounded-2xl bg-[var(--navi-border)]/40" />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {debounced === '' ? (
            <div className="p-4">
              {hydrated && recentSearches.length > 0 && (
                <section>
                  <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--navi-text-secondary)]">
                    Recent searches
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {recentSearches.map((q) => (
                      <button
                        key={q}
                        onClick={() => {
                          setQuery(q)
                          setDebounced(q)
                        }}
                        className="flex items-center gap-1.5 rounded-full border border-[var(--navi-border)] bg-[var(--navi-card)] px-3 py-2.5 text-xs text-[var(--navi-text)] hover:bg-[var(--navi-content)]"
                      >
                        <Clock className="h-3 w-3 text-[var(--navi-text-secondary)]" />
                        {q}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {(!hydrated || recentSearches.length === 0) && (
                <p className="py-10 text-center text-sm text-[var(--navi-text-secondary)]">
                  Search for a room, building, or office to find your way around campus.
                </p>
              )}
            </div>
          ) : groups.length > 0 ? (
            <div className="pb-4">
              {groups.map((group) => (
                <section key={group.buildingId} className="border-b border-[var(--navi-border)] bg-[var(--navi-card)]">
                  <div className="flex items-center gap-2 px-4 pb-1 pt-3">
                    <Building2 className="h-3.5 w-3.5 shrink-0 text-[var(--navi-text-secondary)]" />
                    <h2 className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--navi-text-secondary)]">
                      {group.buildingName}
                    </h2>
                    {group.buildingCode && (
                      <span className="shrink-0 rounded-md bg-[var(--navi-primary-light)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--navi-primary)]">
                        {group.buildingCode}
                      </span>
                    )}
                    <span className="shrink-0 text-[10px] text-[var(--navi-text-secondary)]">
                      {group.entries.length}
                    </span>
                  </div>
                  <ul className="divide-y divide-[var(--navi-border)]">
                    {group.entries.map((entry) => (
                      <li key={entry.id}>
                        <button
                          onClick={() => select(entry)}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--navi-content)]"
                        >
                          {entry.type === 'building' ? (
                            <Building2 className="h-4 w-4 shrink-0 text-[var(--navi-primary)]" />
                          ) : entry.type === 'poi' ? (
                            <MapPin className="h-4 w-4 shrink-0 text-[var(--navi-primary)]" />
                          ) : (
                            <DoorOpen className="h-4 w-4 shrink-0 text-[var(--navi-text-secondary)]" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-[var(--navi-text)]">
                              {entry.label}
                            </span>
                            {(entry.type === 'room' || entry.type === 'poi') && (
                              <span className="block truncate text-xs text-[var(--navi-text-secondary)]">
                                {[
                                  entry.type === 'poi' && entry.category
                                    ? entry.category.replace(/[_-]+/g, ' ')
                                    : null,
                                  entry.floor !== undefined ? floorLabel(entry.floor) : null,
                                  entry.buildingId ? (group.buildingCode ?? group.buildingId) : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </span>
                            )}
                          </span>
                          {entry.nodeId ? (
                            <Navigation className="h-3.5 w-3.5 shrink-0 text-[var(--navi-primary)]" />
                          ) : (
                            <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--navi-primary)]" />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <div className="px-4 py-10 text-center text-sm text-[var(--navi-text-secondary)]">
              No results for “{debounced}”
            </div>
          )}
        </div>
      )}
    </div>
  )
}
