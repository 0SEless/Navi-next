'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Building2,
  Check,
  ChevronRight,
  Map,
  MapPin,
  RotateCcw,
  Search,
} from 'lucide-react'
import { usePublicStore } from '@/store/public-store'

interface CampusListItem {
  id: string
  campus_id: string
  name: string
  description: string
  address: string
  version: string
  updated_at: string
  building_count: number
}

function formatRelativeTime(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    if (diffDays === 0) return 'Updated today'
    if (diffDays === 1) return 'Updated yesterday'
    if (diffDays < 7) return `Updated ${diffDays} days ago`
    if (diffDays < 30) return `Updated ${Math.floor(diffDays / 7)} weeks ago`
    return `Updated ${Math.floor(diffDays / 30)} months ago`
  } catch {
    return ''
  }
}

export function CampusBrowser() {
  const [campuses, setCampuses] = useState<CampusListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const currentCampusId = usePublicStore((state) => state.currentCampusId ?? state.campusData?.campusId)
  const defaultCampusId = usePublicStore((state) => state.defaultCampusId)
  const fetchCampusData = usePublicStore((state) => state.fetchCampusData)
  const setDefaultCampus = usePublicStore((state) => state.setDefaultCampus)

  const loadCampuses = useCallback(async (): Promise<CampusListItem[]> => {
    const response = await fetch('/api/campuses')
    if (!response.ok) throw new Error('Failed to load campuses')
    const data: unknown = await response.json()
    if (!Array.isArray(data)) throw new Error('Campus catalog is unavailable')
    return data as CampusListItem[]
  }, [])

  useEffect(() => {
    let cancelled = false
    void loadCampuses()
      .then((data) => {
        if (cancelled) return
        setCampuses(data)
        setError(null)
      })
      .catch((cause) => {
        if (cancelled) return
        setCampuses([])
        setError(cause instanceof Error ? cause.message : 'Failed to load campuses')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [loadCampuses])

  const handleRetry = () => {
    setLoading(true)
    setError(null)
    void loadCampuses()
      .then((data) => setCampuses(data))
      .catch((cause) => {
        setCampuses([])
        setError(cause instanceof Error ? cause.message : 'Failed to load campuses')
      })
      .finally(() => setLoading(false))
  }

  const filtered = useMemo(() => {
    if (!query.trim()) return campuses
    const normalizedQuery = query.trim().toLowerCase()
    return campuses.filter(
      (campus) =>
        campus.name.toLowerCase().includes(normalizedQuery) ||
        campus.campus_id.toLowerCase().includes(normalizedQuery) ||
        campus.description.toLowerCase().includes(normalizedQuery),
    )
  }, [campuses, query])

  const currentCampusName = campuses.find((campus) => campus.campus_id === currentCampusId)?.name ?? currentCampusId
  const defaultCampusName = campuses.find((campus) => campus.campus_id === defaultCampusId)?.name ?? defaultCampusId

  const handleSelectCampus = (campusId: string) => {
    if (campusId === currentCampusId) return
    // The store action owns the current-campus reset and hydration sequence.
    // It intentionally does not change defaultCampusId.
    void fetchCampusData(campusId)
  }

  const handleSetDefault = (campusId: string) => {
    if (campusId !== defaultCampusId) setDefaultCampus(campusId)
  }

  if (loading) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
        <div className="h-28 w-full animate-pulse rounded-3xl bg-[var(--navi-border)]/60" />
        <div className="h-12 w-full animate-pulse rounded-2xl bg-[var(--navi-border)]/40" />
        <div className="grid gap-3 lg:grid-cols-2">
          {[1, 2, 3].map((item) => <div key={item} className="h-40 rounded-3xl bg-[var(--navi-border)]/40" />)}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--navi-tint-red)] text-[var(--navi-error)]">
          <Map className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold text-[var(--navi-text)]">Campuses are unavailable</h1>
        <p className="max-w-md text-sm leading-6 text-[var(--navi-text-secondary)]">NAVI could not load the public campus catalog. Try again when you have a connection.</p>
        <p className="text-xs text-[var(--navi-error)]">{error}</p>
        <button
          type="button"
          onClick={handleRetry}
          className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--navi-primary)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-full w-full min-w-0 max-w-5xl flex-col px-4 pb-10 pt-5 sm:px-6 sm:pt-8">
      <header className="mb-6">
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--navi-primary)]">Campus directory</p>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--navi-text)]">Campuses</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--navi-text-secondary)]">
              Choose a campus to view its public map. Your current view and saved default are separate.
            </p>
          </div>
          <div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--navi-primary-light)] text-[var(--navi-primary)] sm:flex">
            <Map className="h-5 w-5" aria-hidden="true" />
          </div>
        </div>
      </header>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <CampusSummary label="Current campus" value={currentCampusName ?? 'No campus selected'} hint="Viewing now" current />
        <CampusSummary label="Default campus" value={defaultCampusName ?? 'Not set'} hint="Used when NAVI opens a map" />
      </div>

      <label htmlFor="campus-search" className="relative mb-3 block">
        <span className="sr-only">Search campuses</span>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--navi-text-secondary)]" aria-hidden="true" />
        <input
          id="campus-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by campus name or area"
          aria-label="Search campuses"
          className="min-h-12 w-full rounded-2xl border border-[var(--navi-border)] bg-[var(--navi-card)] py-3 pl-10 pr-4 text-sm text-[var(--navi-text)] outline-none transition-colors placeholder:text-[var(--navi-text-secondary)] focus:border-[var(--navi-primary)] focus:ring-2 focus:ring-[var(--navi-primary)]/15"
        />
      </label>
      <div className="mb-5 flex items-start gap-2 px-1 text-[11px] leading-5 text-[var(--navi-text-secondary)]">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--navi-primary)]" aria-hidden="true" />
        <p>Catalog availability is listed here; selecting a campus loads its public runtime map.</p>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-[var(--navi-border)] px-6 py-14 text-center">
          <Building2 className="h-8 w-8 text-[var(--navi-text-secondary)]" aria-hidden="true" />
          <p className="text-sm font-medium text-[var(--navi-text)]">{query ? 'No campuses match your search.' : 'No campuses available yet.'}</p>
          <p className="max-w-sm text-xs leading-5 text-[var(--navi-text-secondary)]">{query ? 'Try a different name or area.' : 'Public campus maps will appear here when they are available.'}</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((campus) => {
            const isCurrent = campus.campus_id === currentCampusId
            const isDefault = campus.campus_id === defaultCampusId
            return (
              <article
                key={campus.campus_id}
                data-current={isCurrent ? 'true' : 'false'}
                data-default={isDefault ? 'true' : 'false'}
                className={`overflow-hidden rounded-3xl border bg-[var(--navi-card)] shadow-[var(--navi-shadow-sm)] transition-colors ${isCurrent ? 'border-[var(--navi-primary)]/60' : 'border-[var(--navi-border)]'}`}
              >
                <button
                  type="button"
                  onClick={() => handleSelectCampus(campus.campus_id)}
                  aria-label={`Open ${campus.name} map`}
                  className="block min-h-[154px] w-full px-4 pb-4 pt-4 text-left transition-colors hover:bg-[var(--navi-content)] focus-visible:outline-none sm:px-5"
                >
                  <div className="flex items-start gap-3">
                    <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${isCurrent ? 'bg-[var(--navi-primary-light)] text-[var(--navi-primary)]' : 'bg-[var(--navi-content)] text-[var(--navi-text-secondary)]'}`}>
                      <Map className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="min-w-0 truncate text-base font-semibold text-[var(--navi-text)]">{campus.name}</h2>
                        {isCurrent && <StatusBadge current>Current</StatusBadge>}
                        {isDefault && <StatusBadge>Default</StatusBadge>}
                      </div>
                      {campus.description && <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--navi-text-secondary)]">{campus.description}</p>}
                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--navi-text-secondary)]">
                        <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" aria-hidden="true" />{campus.building_count} {campus.building_count === 1 ? 'building' : 'buildings'}</span>
                        {campus.address && <span className="inline-flex min-w-0 items-center gap-1"><MapPin className="h-3 w-3 shrink-0" aria-hidden="true" /><span className="truncate">{campus.address}</span></span>}
                      </div>
                    </div>
                    <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-[var(--navi-text-secondary)]" aria-hidden="true" />
                  </div>
                </button>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--navi-border)] px-4 py-3 sm:px-5">
                  <span className="text-[11px] text-[var(--navi-text-secondary)]">{campus.updated_at ? formatRelativeTime(campus.updated_at) : `Catalog v${campus.version}`}</span>
                  {isDefault ? (
                    <span className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-[var(--navi-primary-light)] px-2.5 text-[11px] font-semibold text-[var(--navi-primary)]">
                      <Check className="h-3 w-3" aria-hidden="true" />
                      Default campus
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSetDefault(campus.campus_id)}
                      className="min-h-11 rounded-lg border border-[var(--navi-primary)]/25 px-2.5 text-[11px] font-semibold text-[var(--navi-primary)] transition-colors hover:bg-[var(--navi-primary-light)]"
                    >
                      Set as Default
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CampusSummary({ label, value, hint, current = false }: {
  label: string
  value: string
  hint: string
  current?: boolean
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-[var(--navi-border)] bg-[var(--navi-card)] px-4 py-3 shadow-[var(--navi-shadow-sm)]">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${current ? 'bg-[var(--navi-primary-bright)]' : 'bg-[var(--navi-text-secondary)]'}`} />
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--navi-text-secondary)]">{label}</p>
      </div>
      <p className="mt-1 truncate text-sm font-semibold text-[var(--navi-text)]">{value}</p>
      <p className="mt-0.5 text-[11px] text-[var(--navi-text-secondary)]">{hint}</p>
    </div>
  )
}

function StatusBadge({ children, current = false }: { children: React.ReactNode; current?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${current ? 'bg-[var(--navi-primary)] text-white' : 'bg-[var(--navi-primary-light)] text-[var(--navi-primary)]'}`}>
      {current && <Check className="h-3 w-3" aria-hidden="true" />}
      {children}
    </span>
  )
}
