'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowUpRight,
  Building2,
  ChevronRight,
  Clock3,
  Info,
  MapPin,
  Search,
  ShieldAlert,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { usePublicStore } from '@/store/public-store'
import { useAuth } from '@/hooks/useAuth'
import { useHydrated } from '@/hooks/useHydrated'
import {
  buildHomeContent,
  buildRecentDestination,
  reconcileRecentDestinationIds,
  type HomeAction,
  type HomeAnnouncementPriority,
} from '@/lib/home-content'
import { HomeHeroCarousel } from './HomeHeroCarousel'

const ANNOUNCEMENT_TONE: Record<
  HomeAnnouncementPriority,
  { label: string; icon: LucideIcon; iconClass: string; badgeClass: string }
> = {
  info: {
    label: 'Information',
    icon: Info,
    iconClass: 'text-[var(--navi-info)]',
    badgeClass: 'bg-[var(--navi-tint-blue)] text-[var(--navi-info)]',
  },
  warning: {
    label: 'Warning',
    icon: TriangleAlert,
    iconClass: 'text-[var(--navi-warning)]',
    badgeClass: 'bg-[var(--navi-tint-amber)] text-[var(--navi-warning)]',
  },
  emergency: {
    label: 'Emergency',
    icon: ShieldAlert,
    iconClass: 'text-[var(--navi-error)]',
    badgeClass: 'bg-[var(--navi-tint-red)] text-[var(--navi-error)]',
  },
}

export function HomeDashboard() {
  const router = useRouter()
  const hydrated = useHydrated()
  const { user } = useAuth()
  const campus = usePublicStore((state) => state.campus)
  const currentCampusId = usePublicStore((state) => state.currentCampusId)
  const recentDestinationIds = usePublicStore((state) => state.recentDestinations)
  const setTo = usePublicStore((state) => state.setTo)
  const reducedMotion = usePublicStore((state) => state.preferences.accessibility.reducedMotion)

  const homeContent = useMemo(
    () => buildHomeContent({
      campusName: campus?.campusName,
      campusId: currentCampusId,
      buildings: campus?.buildings ?? [],
      nodes: campus?.nodes ?? [],
      searchEntries: campus?.searchEntries ?? [],
    }),
    [campus, currentCampusId],
  )

  const recentDestinations = useMemo(() => {
    if (!hydrated) return []
    const source = {
      buildings: campus?.buildings ?? [],
      nodes: campus?.nodes ?? [],
      searchEntries: campus?.searchEntries ?? [],
    }
    return reconcileRecentDestinationIds(recentDestinationIds, source)
      .map((nodeId) => buildRecentDestination(nodeId, source))
  }, [campus, hydrated, recentDestinationIds])

  const buildingNames = useMemo(
    () => new Map((campus?.buildings ?? []).map((building) => [building.id, building.name])),
    [campus],
  )

  const greeting = typeof user?.name === 'string' && user.name.trim() ? user.name.trim() : null

  const openExplore = (buildingId?: string) => {
    const query = buildingId ? `?building_id=${encodeURIComponent(buildingId)}` : ''
    router.push(`/map/explore${query}`)
  }

  const openNavigate = (nodeId: string) => {
    setTo(nodeId)
    router.push(`/map/navigate?to=${encodeURIComponent(nodeId)}`)
  }

  const handleHeroAction = (action: HomeAction) => {
    if (action.type === 'search') {
      router.push('/map/search')
      return
    }
    if (action.type === 'explore') {
      openExplore(action.buildingId)
      return
    }
    openNavigate(action.nodeId)
  }

  return (
    <div className="mx-auto flex min-h-full w-full min-w-0 max-w-6xl flex-col overflow-x-hidden px-4 pb-10 pt-5 sm:px-6 sm:pt-8 lg:px-10">
      <header data-home-section="welcome" className="mb-7 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-4 flex items-center gap-2.5">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--navi-primary)] text-sm font-bold text-white shadow-sm"
              aria-hidden="true"
            >
              N
            </div>
            <div>
              <p className="text-sm font-semibold tracking-wide text-[var(--navi-text)]">NAVI</p>
              <p className="text-[11px] text-[var(--navi-text-secondary)]">Student campus guide</p>
            </div>
          </div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--navi-primary)]">
            Your campus, in one place
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--navi-text)] sm:text-4xl">
            Welcome to {homeContent.campusName}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--navi-text-secondary)] sm:text-base">
            Discover what is happening around campus, find a place to study, and plan where to go next.
          </p>
        </div>
        {greeting && (
          <div className="hidden shrink-0 items-center gap-2 rounded-full border border-[var(--navi-border)] bg-[var(--navi-card)] px-3 py-2 text-xs text-[var(--navi-text-secondary)] sm:flex">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--navi-primary-light)] font-semibold text-[var(--navi-primary)]">
              {greeting.charAt(0).toUpperCase()}
            </span>
            <span className="max-w-32 truncate">{greeting}</span>
          </div>
        )}
      </header>

      <section data-home-section="search" aria-labelledby="home-search-heading" className="mb-8">
        <h2 id="home-search-heading" className="sr-only">Search campus</h2>
        <button
          type="button"
          onClick={() => router.push('/map/search')}
          className="group flex min-h-14 w-full items-center gap-3 rounded-2xl border border-[var(--navi-border)] bg-[var(--navi-card)] px-4 text-left shadow-sm transition-colors hover:border-[var(--navi-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--navi-primary)] focus-visible:ring-offset-2 sm:px-5"
          aria-label="Search campus buildings, rooms, or services"
        >
          <Search className="h-5 w-5 shrink-0 text-[var(--navi-text-secondary)] transition-colors group-hover:text-[var(--navi-primary)]" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm text-[var(--navi-text-secondary)] sm:text-base">
            Search campus buildings, rooms, or services…
          </span>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-[var(--navi-primary)]" aria-hidden="true" />
        </button>
      </section>

      <section data-home-section="hero" className="mb-10">
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--navi-text-secondary)]">
              Start here
            </p>
            <h2 id="home-hero-heading" className="text-xl font-semibold tracking-tight text-[var(--navi-text)] sm:text-2xl">
              Campus highlights
            </h2>
          </div>
          <span className="hidden text-xs text-[var(--navi-text-secondary)] sm:block">
            {homeContent.heroSlides.length > 1 ? 'Swipe or use the arrows' : 'A quick view of campus'}
          </span>
        </div>
        <HomeHeroCarousel
          slides={homeContent.heroSlides}
          reducedMotion={reducedMotion}
          onAction={handleHeroAction}
        />
      </section>

      <section data-home-section="explore" aria-labelledby="home-explore-heading" className="mb-10 min-w-0">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--navi-primary)]">
              Discover
            </p>
            <h2 id="home-explore-heading" className="text-xl font-semibold tracking-tight text-[var(--navi-text)] sm:text-2xl">
              Explore Our Campus
            </h2>
          </div>
          <button
            type="button"
            onClick={() => openExplore()}
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-[var(--navi-primary)] transition-colors hover:bg-[var(--navi-primary-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--navi-primary)] focus-visible:ring-offset-2"
          >
            Open map
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {homeContent.featuredPlaces.length > 0 ? (
          <div className="flex min-w-0 gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-thin">
            {homeContent.featuredPlaces.map((place) => (
              <button
                key={place.id}
                type="button"
                data-home-building-id={place.id}
                onClick={() => openExplore(place.id)}
                className="group flex min-h-36 w-[min(78vw,18rem)] shrink-0 snap-start flex-col justify-between rounded-2xl border border-[var(--navi-border)] bg-[var(--navi-card)] p-4 text-left shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-[var(--navi-primary-light)] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--navi-primary)] focus-visible:ring-offset-2 sm:w-72"
                aria-label={`Open ${place.title} in Explore`}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--navi-primary-light)] text-[var(--navi-primary)]" aria-hidden="true">
                    <Building2 className="h-5 w-5" />
                  </span>
                  <ArrowUpRight className="h-4 w-4 text-[var(--navi-text-secondary)] transition-colors group-hover:text-[var(--navi-primary)]" aria-hidden="true" />
                </span>
                <span className="mt-5 min-w-0">
                  <span className="block truncate text-base font-semibold text-[var(--navi-text)]">{place.title}</span>
                  <span className="mt-1 block truncate text-xs text-[var(--navi-text-secondary)]">{place.subtitle}</span>
                  <span className="mt-2 block text-xs text-[var(--navi-text-secondary)]">
                    {place.floorCount > 0 ? `${place.floorCount} ${place.floorCount === 1 ? 'floor' : 'floors'}` : 'Floor details unavailable'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[var(--navi-border)] bg-[var(--navi-card)] px-4 py-5 text-sm text-[var(--navi-text-secondary)]">
            Campus places will appear here when the public map data is available.
          </div>
        )}
      </section>

      <section data-home-section="recent" aria-labelledby="home-recent-heading" className="mb-10 min-w-0">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--navi-text-secondary)]">
              Pick up where you left off
            </p>
            <h2 id="home-recent-heading" className="text-xl font-semibold tracking-tight text-[var(--navi-text)] sm:text-2xl">
              Recent Destinations
            </h2>
          </div>
          <Clock3 className="h-5 w-5 text-[var(--navi-text-secondary)]" aria-hidden="true" />
        </div>
        {recentDestinations.length > 0 ? (
          <div className="flex min-w-0 gap-3 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-thin">
            {recentDestinations.map((destination) => (
              <button
                key={destination.nodeId}
                type="button"
                data-home-recent-id={destination.nodeId}
                onClick={() => openNavigate(destination.nodeId)}
                className="flex min-h-16 w-[min(82vw,20rem)] shrink-0 snap-start items-center gap-3 rounded-2xl border border-[var(--navi-border)] bg-[var(--navi-card)] px-4 py-3 text-left shadow-sm transition-colors hover:border-[var(--navi-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--navi-primary)] focus-visible:ring-offset-2 sm:w-80"
                aria-label={`Navigate to ${destination.label}`}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--navi-primary-light)] text-[var(--navi-primary)]" aria-hidden="true">
                  <MapPin className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[var(--navi-text)]">{destination.label}</span>
                  {(destination.buildingName || destination.floorLabel) && (
                    <span className="mt-1 block truncate text-xs text-[var(--navi-text-secondary)]">
                      {[destination.buildingName, destination.floorLabel].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--navi-text-secondary)]" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-[var(--navi-border)] bg-[var(--navi-card)] px-4 py-4 text-sm text-[var(--navi-text-secondary)]">
            <span className="block font-medium text-[var(--navi-text)]">No recent destinations yet.</span>
            <span className="mt-1 block">Search a campus place to build your list.</span>
          </p>
        )}
      </section>

      <section data-home-section="announcements" aria-labelledby="home-announcements-heading" className="min-w-0">
        <div className="mb-4">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--navi-text-secondary)]">
            Stay informed
          </p>
          <h2 id="home-announcements-heading" className="text-xl font-semibold tracking-tight text-[var(--navi-text)] sm:text-2xl">
            Campus Announcements
          </h2>
        </div>
        <div className="grid gap-3 lg:grid-cols-2" role="list">
          {homeContent.announcements.map((announcement) => {
            const tone = ANNOUNCEMENT_TONE[announcement.priority]
            const Icon = tone.icon
            const locationLabel = announcement.location
              ? announcement.location.label ?? buildingNames.get(announcement.location.buildingId)
              : undefined

            return (
              <article
                key={announcement.id}
                role="listitem"
                data-home-announcement-id={announcement.id}
                data-priority={announcement.priority}
                className="flex min-w-0 items-start gap-3 rounded-2xl border border-[var(--navi-border)] bg-[var(--navi-card)] p-4 shadow-sm"
              >
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone.badgeClass}`} aria-hidden="true">
                  <Icon className={`h-5 w-5 ${tone.iconClass}`} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${tone.badgeClass}`}>
                      {tone.label}
                    </span>
                    {announcement.date && (
                      <time dateTime={announcement.date} className="text-[11px] text-[var(--navi-text-secondary)]">
                        {announcement.date}
                      </time>
                    )}
                  </div>
                  <h3 className="mt-2 truncate text-sm font-semibold text-[var(--navi-text)]">{announcement.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--navi-text-secondary)]">{announcement.description}</p>
                  {locationLabel && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-[var(--navi-text-secondary)]">
                      <MapPin className="h-3.5 w-3.5 text-[var(--navi-primary)]" aria-hidden="true" />
                      {locationLabel}
                    </p>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
