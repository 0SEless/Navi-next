import { useCallback } from 'react'
import {
  DEFAULT_POI_2_5D_HEIGHT,
  getPointOfInterestPosition,
  getWorldPointOfInterestRepresentative,
  resolvePointOfInterestAppearance,
  resolveOutdoorPointOfInterestAppearance,
  resolvePoiVisibility,
  resolvePointOfInterestGeometry,
  POICATEGORIES,
  type OutdoorPointOfInterest,
  type PointOfInterest,
  type PointOfInterestAppearanceMode,
  type PointOfInterestVisibility,
  type POICategory,
  type WorldPOIGeometry,
} from '@navi/core'
import { useEditor } from '../../context'
import { tokens, ActionButton, Field, inputStyle, selectStyle, SectionHeader } from './field'

interface Props { poi: PointOfInterest | OutdoorPointOfInterest }

/** Authored color palette; brown is a first-class default-style choice. */
const POI_COLOR_SWATCHES = ['#8B4513', '#F59E0B', '#22C55E', '#0EA5E9', '#EF4444', '#8B5CF6', '#64748B', '#111827']

/**
 * Inspector for the canonical authored POI.
 *
 * Handles both scopes with one identity/appearance contract:
 *   - indoor: Floor.pois with floor-local meter coordinates;
 *   - outdoor: CampusDocument.pois with world LatLng coordinates.
 *
 * This panel deliberately uses the specialized POI commands. A POI is not a
 * generic graph entity, and editing it must not create route or Area state.
 */
export function POIProperties({ poi }: Props) {
  const { services } = useEditor()
  const dispatcher = services.get('dispatcher')

  const isOutdoor = (poi as { scope?: unknown }).scope === 'outdoor'
  const outdoorPoi = isOutdoor ? (poi as OutdoorPointOfInterest) : null

  const update = useCallback((patch: Record<string, unknown>) => {
    dispatcher?.execute({
      id: 'poi.update',
      label: 'Edit POI',
      payload: { poiId: poi.id, patch },
    })
  }, [dispatcher, poi.id])

  const categoryLabel = (category: POICategory): string => category.replace(/_/g, ' ')
  const position = outdoorPoi ? null : getPointOfInterestPosition(poi as PointOfInterest)
  const geometry = outdoorPoi ? outdoorPoi.geometry : resolvePointOfInterestGeometry(poi as PointOfInterest)
  const worldPosition = outdoorPoi
    ? getWorldPointOfInterestRepresentative(outdoorPoi.geometry as WorldPOIGeometry)
    : null
  const geometryLabel = geometry ? geometry.type[0].toUpperCase() + geometry.type.slice(1) : 'Unknown'
  const resolvedAppearance = outdoorPoi
    ? resolveOutdoorPointOfInterestAppearance(outdoorPoi)
    : resolvePointOfInterestAppearance(poi as PointOfInterest)
  const appearanceMode = resolvedAppearance?.mode ?? (geometry?.type === 'point' ? 'marker' : '2d')
  const isPoint = geometry?.type === 'point'
  const isTwoPointFiveD = appearanceMode === '2.5d'

  const updateAppearance = (mode: PointOfInterestAppearanceMode) => {
    if (mode === 'marker') {
      update({ appearance: { mode } })
    } else if (mode === '2.5d') {
      update({ appearance: { mode, height: resolvedAppearance?.height ?? DEFAULT_POI_2_5D_HEIGHT } })
    } else {
      update({ appearance: { mode } })
    }
  }

  const updateHeight = (rawValue: string) => {
    const height = Number(rawValue)
    if (Number.isFinite(height)) update({ appearance: { mode: '2.5d', height } })
  }

  const updateColor = (color?: string) => {
    const base = appearanceMode === '2.5d'
      ? { mode: '2.5d' as const, height: resolvedAppearance?.height ?? DEFAULT_POI_2_5D_HEIGHT }
      : { mode: appearanceMode }
    update({ appearance: color !== undefined ? { ...base, color } : base })
  }

  const visibility = resolvePoiVisibility((poi as { visibility?: PointOfInterestVisibility }).visibility)
  const updateVisibility = (patch: Partial<PointOfInterestVisibility>) => {
    update({ visibility: { ...visibility, ...patch } })
  }

  const navigation = (poi as { navigation?: { approachMode: 'automatic' | 'preferred'; anchor?: unknown } }).navigation
  const approachMode = navigation?.approachMode ?? 'automatic'

  /** `<input type="color">` only accepts lowercase `#rrggbb`. */
  const customColorValue = (() => {
    const color = resolvedAppearance?.color
    if (!color) return '#8b4513'
    if (/^#[0-9a-fA-F]{6}$/.test(color)) return color.toLowerCase()
    if (/^#[0-9a-fA-F]{3}$/.test(color)) {
      return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`.toLowerCase()
    }
    return '#8b4513'
  })()
  const updateApproach = (mode: 'automatic' | 'preferred') => {
    update({
      navigation: mode === 'automatic'
        ? { approachMode: 'automatic' }
        : { approachMode: 'preferred', ...(navigation?.anchor !== undefined ? { anchor: structuredClone(navigation.anchor) } : {}) },
    })
  }
  const requestAnchorPick = () => {
    const eventBus = services.get('eventBus') as unknown as { emit?: (event: string, payload: unknown) => void } | undefined
    eventBus?.emit?.('poi.anchor.pick', { poiId: poi.id })
  }

  return (
    <div style={{ padding: '6px 12px 14px', fontSize: tokens.fontSize.md, fontFamily: 'system-ui, sans-serif' }}>
      <SectionHeader>Details</SectionHeader>
      <Field label="Name">
        <input
          value={poi.name}
          onChange={event => update({ name: event.target.value })}
          style={inputStyle}
        />
      </Field>
      <Field label="Category">
        <select
          value={poi.category}
          onChange={event => update({ category: event.target.value as POICategory })}
          style={selectStyle}
        >
          {POICATEGORIES.map(category => (
            <option key={category} value={category}>{categoryLabel(category)}</option>
          ))}
        </select>
      </Field>

      <SectionHeader>Geometry</SectionHeader>
      <div style={{ color: tokens.textSecondary, fontSize: tokens.fontSize.base, lineHeight: 1.6 }}>
        <div>{geometryLabel}</div>
        <div>{isOutdoor ? 'Outdoor · world coordinates' : 'Indoor · floor-local geometry'}</div>
      </div>

      <SectionHeader>Appearance</SectionHeader>
      <Field label="Appearance">
        <select
          aria-label="Appearance"
          value={appearanceMode}
          disabled={isPoint}
          onChange={event => updateAppearance(event.target.value as PointOfInterestAppearanceMode)}
          style={selectStyle}
        >
          {isPoint ? <option value="marker">Marker</option> : (
            <>
              <option value="2d">2D</option>
              <option value="2.5d">2.5D</option>
            </>
          )}
        </select>
      </Field>
      {isTwoPointFiveD && !isPoint && (
        <Field label="Height (m)">
          <input
            aria-label="Appearance height"
            type="number"
            min="0.1"
            max="100"
            step="0.1"
            value={resolvedAppearance?.height ?? DEFAULT_POI_2_5D_HEIGHT}
            onChange={event => updateHeight(event.target.value)}
            style={inputStyle}
          />
        </Field>
      )}
      <Field label="Color">
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            aria-label="Default POI color"
            title="Default renderer color"
            onClick={() => updateColor(undefined)}
            style={{
              padding: '3px 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
              border: resolvedAppearance?.color === undefined ? '2px solid #3B82F6' : '1px solid var(--navi-border, #334155)',
              background: 'transparent', color: 'inherit',
            }}
          >Auto</button>
          {POI_COLOR_SWATCHES.map(color => (
            <button
              key={color}
              type="button"
              aria-label={`POI color ${color}`}
              onClick={() => updateColor(color)}
              style={{
                width: 20, height: 20, borderRadius: 4, background: color, cursor: 'pointer',
                border: resolvedAppearance?.color?.toLowerCase() === color.toLowerCase()
                  ? '2px solid #3B82F6'
                  : '1px solid var(--navi-border, #334155)',
              }}
            />
          ))}
          <input
            type="color"
            aria-label="Custom POI color"
            title="Pick a custom color"
            value={customColorValue}
            onChange={event => updateColor(event.target.value.toUpperCase())}
            style={{
              width: 24, height: 20, padding: 0, borderRadius: 4, cursor: 'pointer',
              border: '1px solid var(--navi-border, #334155)', background: 'transparent',
            }}
          />
        </div>
      </Field>

      <SectionHeader>Visibility</SectionHeader>
      <Field label="Map & Search">
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: tokens.fontSize.base, cursor: 'pointer' }}>
          <input
            type="checkbox"
            aria-label="Show on map"
            checked={visibility.showOnMap}
            onChange={event => updateVisibility({ showOnMap: event.target.checked })}
          />
          Show on map
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: tokens.fontSize.base, cursor: 'pointer', marginTop: 4 }}>
          <input
            type="checkbox"
            aria-label="Searchable"
            checked={visibility.searchable}
            onChange={event => updateVisibility({ searchable: event.target.checked })}
          />
          Searchable
        </label>
      </Field>

      <SectionHeader>Navigation</SectionHeader>
      <Field label="Approach">
        <select
          aria-label="Approach"
          value={approachMode}
          onChange={event => updateApproach(event.target.value as 'automatic' | 'preferred')}
          style={selectStyle}
        >
          <option value="automatic">Automatic</option>
          <option value="preferred" disabled={isPoint}>Preferred anchor</option>
        </select>
      </Field>
      {approachMode === 'preferred' && !isPoint && (
        <button
          type="button"
          aria-label="Pick approach anchor"
          onClick={requestAnchorPick}
          style={{
            marginTop: 4, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
            border: '1px solid var(--navi-border, #334155)', background: 'transparent',
            color: 'inherit', fontSize: tokens.fontSize.base,
          }}
        >Pick anchor on shape</button>
      )}

      <SectionHeader>Position</SectionHeader>
      {position ? (
        <div style={{ color: tokens.textSecondary, fontSize: tokens.fontSize.base, lineHeight: 1.6 }}>
          <div>X: {position.x.toFixed(2)} m</div>
          <div>Y: {position.y.toFixed(2)} m</div>
          <div style={{ color: tokens.textMuted, fontSize: tokens.fontSize.sm }}>Floor-local coordinates</div>
        </div>
      ) : worldPosition ? (
        <div style={{ color: tokens.textSecondary, fontSize: tokens.fontSize.base, lineHeight: 1.6 }}>
          <div>Lat: {worldPosition.lat.toFixed(6)}</div>
          <div>Lng: {worldPosition.lng.toFixed(6)}</div>
          <div style={{ color: tokens.textMuted, fontSize: tokens.fontSize.sm }}>World coordinates</div>
        </div>
      ) : (
        <div style={{ color: tokens.textMuted, fontSize: tokens.fontSize.sm }}>
          Shape geometry is saved; shape editing is deferred to the next geometry-authoring phase.
        </div>
      )}

      <SectionHeader>Actions</SectionHeader>
      <ActionButton
        variant="danger"
        aria-label="Delete POI"
        onClick={() => dispatcher?.execute({
          id: 'poi.delete',
          label: 'Delete POI',
          payload: { poiId: poi.id },
        })}
      >
        Delete POI
      </ActionButton>
    </div>
  )
}
