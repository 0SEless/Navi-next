'use client'

import Image from 'next/image'
import { useState } from 'react'
import { Building2, DoorOpen, Layers, MapPin, Navigation, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { usePublicStore } from '@/store/public-store'
import type { Building, CampusBundle, SearchEntry } from '@/types/nav-types'
import {
  getAvailablePanoramas,
  getExploreFloors,
  resolveStableExploreDestination,
} from '@/lib/explore-contracts'

export interface BuildingSheetProps {
  /** The canonical published bundle used by the visible Explore map. */
  bundle?: CampusBundle | null
}

type BuildingTab = 'overview' | 'floors' | 'rooms' | 'entrances'

const TABS: Array<{ id: BuildingTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'floors', label: 'Floors' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'entrances', label: 'Entrances' },
]

function metadataString(building: Building, key: string): string | null {
  const value = building.metadata?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function metadataStringArray(building: Building, key: string): string[] {
  const value = building.metadata?.[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function formatFloorLabel(floor: number): string {
  if (floor === 0) return 'GF'
  if (floor > 0) return `${floor}F`
  return `B${Math.abs(floor)}`
}

function getBuildingImageUrl(building: Building): string | null {
  return metadataString(building, 'imageUrl')
    ?? metadataString(building, 'photoUrl')
    ?? metadataString(building, 'image')
}

function getPublishedEntrances(bundle: CampusBundle, building: Building) {
  const declared = (building.entrances ?? []).map(entrance => ({
    id: entrance.id,
    label: entrance.label?.trim() || entrance.id,
    floor: entrance.floor,
  }))
  const indexed = bundle.searchEntries
    .filter(entry => entry.type === 'entrance' && entry.buildingId === building.id)
    .map(entry => ({
      id: entry.id,
      label: entry.label,
      floor: entry.floor,
    }))
  const seen = new Set<string>()
  return [...declared, ...indexed].filter((entrance) => {
    const key = `${entrance.label}:${entrance.floor}`
    if (seen.has(entrance.id) || seen.has(key)) return false
    seen.add(entrance.id)
    seen.add(key)
    return Number.isFinite(entrance.floor)
  })
}

function getRoomEntries(bundle: CampusBundle, buildingId: string): SearchEntry[] {
  return bundle.searchEntries.filter(entry => entry.type === 'room' && entry.buildingId === buildingId)
}

function getFacilityLabels(bundle: CampusBundle, building: Building): string[] {
  const fromMetadata = metadataStringArray(building, 'facilities')
  const fromIndex = bundle.searchEntries
    .filter(entry => entry.type === 'facility' && entry.buildingId === building.id)
    .map(entry => entry.label)
  return [...new Set([...fromMetadata, ...fromIndex])]
}

/** Building discovery surface shared by Explore and other public map contexts. */
export function BuildingSheet({ bundle: bundleProp }: BuildingSheetProps) {
  const router = useRouter()
  const building = usePublicStore((s) => s.selectedBuilding)
  const campus = usePublicStore((s) => s.campus)
  const sheetState = usePublicStore((s) => s.sheetState)
  const selectBuilding = usePublicStore((s) => s.selectBuilding)
  const setSheet = usePublicStore((s) => s.setSheet)
  const exitIndoorContext = usePublicStore((s) => s.exitIndoorContext)
  const setActiveFloor = usePublicStore((s) => s.setActiveFloor)
  const setTo = usePublicStore((s) => s.setTo)
  const addRecentDestination = usePublicStore((s) => s.addRecentDestination)
  const [activeTab, setActiveTab] = useState<BuildingTab>('overview')
  const [selectedRoom, setSelectedRoom] = useState<SearchEntry | null>(null)

  const bundle = bundleProp ?? campus
  if (!building || !bundle) return null

  const floors = getExploreFloors(bundle, building.id)
  const rooms = getRoomEntries(bundle, building.id)
  const entrances = getPublishedEntrances(bundle, building)
  const facilities = getFacilityLabels(bundle, building)
  const panoramas = getAvailablePanoramas(bundle, building.id)
  const imageUrl = getBuildingImageUrl(building)
  const buildingDestination = resolveStableExploreDestination(bundle, { buildingId: building.id })
  const status = metadataString(building, 'status')
  const typeLabel = building.category ?? metadataString(building, 'type') ?? 'Building'

  const handleClose = () => {
    selectBuilding(null)
    exitIndoorContext()
    setSheet('hidden')
    setSelectedRoom(null)
  }

  const handleDirections = () => {
    if (!buildingDestination) return
    setTo(buildingDestination.nodeId)
    addRecentDestination(buildingDestination.nodeId)
    router.push(`/map/navigate?to=${encodeURIComponent(buildingDestination.nodeId)}`)
  }

  const handleRoomDirections = () => {
    if (!selectedRoom) return
    const destination = resolveStableExploreDestination(bundle, { entryId: selectedRoom.id })
    if (!destination) return
    setTo(destination.nodeId)
    addRecentDestination(destination.nodeId)
    router.push(`/map/navigate?to=${encodeURIComponent(destination.nodeId)}`)
  }

  const handleTour = () => {
    const panorama = panoramas[0]
    if (!panorama) return
    router.push(
      `/map/panoramas?building_id=${encodeURIComponent(building.id)}&panorama_id=${encodeURIComponent(panorama.id)}`,
    )
  }

  const panelMaxHeight = sheetState === 'full' ? 'calc(100% - 1rem)' : 'min(72vh, 40rem)'

  return (
    <section
      className="absolute inset-x-0 bottom-0 z-30 min-w-0 overflow-y-auto rounded-t-2xl border-t border-[var(--navi-border)] bg-[var(--navi-card)] shadow-[0_-8px_24px_rgba(0,0,0,0.15)] md:inset-y-4 md:bottom-auto md:left-auto md:right-4 md:w-[min(26rem,calc(100%-2rem))] md:rounded-2xl md:border"
      style={{ maxHeight: panelMaxHeight }}
      role="dialog"
      aria-label={`${building.name} details`}
    >
      <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-[var(--navi-border)] md:hidden" aria-hidden="true" />
      <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--navi-primary-light)] text-[var(--navi-primary)]">
            <Building2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-[var(--navi-text)]">{building.name}</h2>
            <p className="flex min-w-0 gap-1 truncate text-xs text-[var(--navi-text-secondary)]">
              <span className="truncate">{typeLabel}</span>
              {status && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{status}</span>
                </>
              )}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleClose}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--navi-text-secondary)] hover:bg-[var(--navi-content)]"
          aria-label="Close building details"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {imageUrl && (
        <div className="mx-4 overflow-hidden rounded-xl border border-[var(--navi-border)]">
          <Image
            src={imageUrl}
            alt={building.name}
            width={960}
            height={280}
            unoptimized
            className="h-32 w-full object-cover"
          />
        </div>
      )}

      <div className="mt-3 overflow-x-auto border-y border-[var(--navi-border)] px-4">
        <div className="flex min-w-max gap-1" role="group" aria-label="Building details">
          {TABS.map(tab => (
            <button
              type="button"
              key={tab.id}
              aria-pressed={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="min-h-11 shrink-0 border-b-2 px-3 text-xs font-semibold"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-w-0 px-4 py-4" role="tabpanel">
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <SummaryStat icon={<Layers className="h-4 w-4" />} label="Floors" value={floors.length} />
              <SummaryStat icon={<DoorOpen className="h-4 w-4" />} label="Rooms" value={rooms.length} />
              <SummaryStat icon={<MapPin className="h-4 w-4" />} label="Entrances" value={entrances.length} />
            </div>
            <p className="text-sm leading-relaxed text-[var(--navi-text-secondary)]">
              {building.description || 'No summary has been published for this building yet.'}
            </p>
            {facilities.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--navi-text-secondary)]">
                  Facilities
                </h3>
                <div className="flex flex-wrap gap-2">
                  {facilities.map(facility => (
                    <span key={facility} className="rounded-full bg-[var(--navi-content)] px-3 py-1.5 text-xs text-[var(--navi-text)]">
                      {facility}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'floors' && (
          floors.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {floors.map(floor => (
                <button
                  type="button"
                  key={floor}
                  onClick={() => setActiveFloor(floor)}
                  className="flex min-h-11 items-center justify-between rounded-xl border border-[var(--navi-border)] px-3 text-left text-sm font-semibold text-[var(--navi-text)] hover:bg-[var(--navi-content)]"
                >
                  <span>{formatFloorLabel(floor)}</span>
                  <span className="text-xs font-normal text-[var(--navi-text-secondary)]">View floor</span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyTabState text="No published floors for this building." />
          )
        )}

        {activeTab === 'rooms' && (
          rooms.length > 0 ? (
            <div className="space-y-2">
              {rooms.map(room => (
                <button
                  type="button"
                  key={room.id}
                  onClick={() => {
                    setSelectedRoom(room)
                    if (room.floor !== undefined) setActiveFloor(room.floor)
                  }}
                  className="flex min-h-11 w-full min-w-0 items-center gap-3 rounded-xl border border-[var(--navi-border)] px-3 text-left hover:bg-[var(--navi-content)]"
                  aria-pressed={selectedRoom?.id === room.id}
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--navi-text)]">{room.label}</span>
                  {room.floor !== undefined && (
                    <span className="shrink-0 text-xs text-[var(--navi-text-secondary)]">{formatFloorLabel(room.floor)}</span>
                  )}
                </button>
              ))}
              {selectedRoom && (
                <div className="rounded-xl bg-[var(--navi-content)] p-3">
                  <p className="text-xs text-[var(--navi-text-secondary)]">
                    {selectedRoom.label} · {building.name}
                    {selectedRoom.floor !== undefined ? ` · ${formatFloorLabel(selectedRoom.floor)}` : ''}
                  </p>
                  {resolveStableExploreDestination(bundle, { entryId: selectedRoom.id }) && (
                    <button
                      type="button"
                      onClick={handleRoomDirections}
                      className="mt-2 min-h-11 rounded-lg px-3 text-xs font-semibold text-[var(--navi-primary)] hover:bg-[var(--navi-card)]"
                    >
                      Directions to room
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <EmptyTabState text="No rooms have been published for this building." />
          )
        )}

        {activeTab === 'entrances' && (
          entrances.length > 0 ? (
            <div className="space-y-2">
              {entrances.map(entrance => (
                <button
                  type="button"
                  key={entrance.id}
                  onClick={() => setActiveFloor(entrance.floor)}
                  className="flex min-h-11 w-full min-w-0 items-center gap-3 rounded-xl border border-[var(--navi-border)] px-3 text-left hover:bg-[var(--navi-content)]"
                >
                  <MapPin className="h-4 w-4 shrink-0 text-[var(--navi-primary)]" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--navi-text)]">{entrance.label}</span>
                  <span className="shrink-0 text-xs text-[var(--navi-text-secondary)]">{formatFloorLabel(entrance.floor)}</span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyTabState text="No named entrances have been published for this building." />
          )
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-[var(--navi-border)] p-4 sm:flex-row">
        <button
          type="button"
          onClick={handleDirections}
          disabled={!buildingDestination}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--navi-primary)] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={buildingDestination ? 'Directions' : 'Directions unavailable'}
        >
          <Navigation className="h-4 w-4" aria-hidden="true" />
          {buildingDestination ? 'Directions' : 'Directions unavailable'}
        </button>
        {panoramas.length > 0 && (
          <button
            type="button"
            onClick={handleTour}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--navi-border)] px-4 text-sm font-semibold text-[var(--navi-text)] hover:bg-[var(--navi-content)]"
            aria-label="Open 360 Virtual Tour"
          >
            <span aria-hidden="true">360°</span>
            Virtual Tour
          </button>
        )}
      </div>
    </section>
  )
}

function SummaryStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: number
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-[var(--navi-content)] px-2.5 py-2">
      <span className="shrink-0 text-[var(--navi-primary)]">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight text-[var(--navi-text)]">{value}</span>
        <span className="block truncate text-[10px] text-[var(--navi-text-secondary)]">{label}</span>
      </span>
    </div>
  )
}

function EmptyTabState({ text }: { text: string }) {
  return <p className="rounded-xl bg-[var(--navi-content)] px-3 py-4 text-sm text-[var(--navi-text-secondary)]">{text}</p>
}
