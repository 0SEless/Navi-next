import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getEffectiveRoadRouting,
  getRoadElevationDeltaMeters,
  getRoadGradePercent,
  normalizeRoadRouting,
} from '@navi/core'
import type {
  Road,
  RoadDirection,
  RoadRouting,
  RoadRoutingFeature,
  RoadSlope,
} from '@navi/core'
import {
  checkboxStyle,
  Field,
  inputStyle,
  mutedTextStyle,
  SectionHeader,
  selectStyle,
  tokens,
} from './field'

interface RoadRoutingFieldsProps {
  road: Road
  onUpdate: (routing: RoadRouting | undefined) => void
}

type ElevationField = 'startElevationMeters' | 'endElevationMeters'

interface ParsedElevation {
  valid: boolean
  value?: number
}

export function mergeRoadRouting(
  current: RoadRouting | undefined,
  patch: Partial<RoadRouting>,
): RoadRouting | undefined {
  return normalizeRoadRouting({ ...(normalizeRoadRouting(current) ?? {}), ...patch })
}

export function parseOptionalElevation(raw: string): ParsedElevation {
  if (raw.trim() === '') return { valid: true, value: undefined }
  const value = Number(raw)
  return Number.isFinite(value) ? { valid: true, value } : { valid: false }
}

function elevationInputValue(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

function shouldRevealElevation(road: Pick<Road, 'routing'>): boolean {
  const routing = getEffectiveRoadRouting(road)
  return (
    routing.feature === 'stairs' ||
    routing.feature === 'ramp' ||
    routing.slope !== 'level' ||
    routing.startElevationMeters !== undefined ||
    routing.endElevationMeters !== undefined
  )
}

function formatElevationDelta(value: number | undefined): string {
  if (value === undefined) return '—'
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(1)
  return `${value > 0 ? '+' : ''}${formatted} m`
}

function formatGrade(value: number | undefined): string {
  return value === undefined ? '—' : `${value.toFixed(1)}%`
}

export function RoadRoutingFields({ road, onUpdate }: RoadRoutingFieldsProps) {
  const initialRouting = normalizeRoadRouting(road.routing)
  const [routingDraft, setRoutingDraft] = useState<RoadRouting | undefined>(initialRouting)
  const routingDraftRef = useRef<RoadRouting | undefined>(initialRouting)
  const [startElevation, setStartElevation] = useState(
    elevationInputValue(initialRouting?.startElevationMeters),
  )
  const [endElevation, setEndElevation] = useState(
    elevationInputValue(initialRouting?.endElevationMeters),
  )
  const [startInvalid, setStartInvalid] = useState(false)
  const [endInvalid, setEndInvalid] = useState(false)
  const [showElevation, setShowElevation] = useState(() => shouldRevealElevation(road))

  useEffect(() => {
    const next = normalizeRoadRouting(road.routing)
    routingDraftRef.current = next
    // This draft intentionally resets when selection or undo replaces Road.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRoutingDraft(next)
    setStartElevation(elevationInputValue(next?.startElevationMeters))
    setEndElevation(elevationInputValue(next?.endElevationMeters))
    setStartInvalid(false)
    setEndInvalid(false)
    setShowElevation(shouldRevealElevation(road))
  }, [road])

  const commitRoutingPatch = useCallback((patch: Partial<RoadRouting>) => {
    const next = mergeRoadRouting(routingDraftRef.current, patch)
    routingDraftRef.current = next
    setRoutingDraft(next)
    onUpdate(next)
  }, [onUpdate])

  const effective = getEffectiveRoadRouting({ routing: routingDraft })
  const derivedRoad = useMemo<Road>(() => ({ ...road, routing: routingDraft }), [road, routingDraft])
  const elevationDelta = getRoadElevationDeltaMeters(derivedRoad)
  const grade = getRoadGradePercent(derivedRoad)
  const hasExplicitLevelConflict = routingDraft?.slope === 'level'
    && elevationDelta !== undefined
    && elevationDelta !== 0

  const updateElevation = useCallback((field: ElevationField, raw: string) => {
    const parsed = parseOptionalElevation(raw)
    if (field === 'startElevationMeters') {
      setStartElevation(raw)
      setStartInvalid(!parsed.valid)
    } else {
      setEndElevation(raw)
      setEndInvalid(!parsed.valid)
    }
    if (parsed.valid) commitRoutingPatch({ [field]: parsed.value })
  }, [commitRoutingPatch])

  const selectFeature = (feature: RoadRoutingFeature) => {
    if (feature === 'stairs' || feature === 'ramp') setShowElevation(true)
    commitRoutingPatch({ feature })
  }

  const selectSlope = (slope: RoadSlope) => {
    if (slope !== 'level') setShowElevation(true)
    commitRoutingPatch({ slope })
  }

  return (
    <>
      <SectionHeader>Routing & Terrain</SectionHeader>

      <Field label="Path feature">
        <select
          aria-label="Path feature"
          value={effective.feature}
          onChange={event => selectFeature(event.target.value as RoadRoutingFeature)}
          style={selectStyle}
        >
          <option value="normal">Normal</option>
          <option value="stairs">Stairs</option>
          <option value="ramp">Ramp</option>
          <option value="bridge">Bridge</option>
        </select>
      </Field>

      <Field label="Slope">
        <select
          aria-label="Slope"
          value={effective.slope}
          onChange={event => selectSlope(event.target.value as RoadSlope)}
          style={selectStyle}
        >
          <option value="level">Level</option>
          <option value="gentle">Gentle</option>
          <option value="moderate">Moderate</option>
          <option value="steep">Steep</option>
        </select>
      </Field>

      <Field label="Direction">
        <select
          aria-label="Direction"
          value={effective.direction}
          onChange={event => commitRoutingPatch({
            direction: event.target.value as RoadDirection,
          })}
          style={selectStyle}
        >
          <option value="both">Both directions</option>
          <option value="forward">Forward only</option>
          <option value="reverse">Reverse only</option>
        </select>
        <div style={{ ...mutedTextStyle, marginTop: 3 }}>
          Forward follows the first authored point to the last.
        </div>
      </Field>

      <Field label="Accessibility">
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6, color: tokens.textPrimary }}>
          <input
            type="checkbox"
            aria-label="Walkable"
            checked={effective.walkable}
            onChange={event => commitRoutingPatch({ walkable: event.target.checked })}
            style={checkboxStyle}
          />
          <span style={{ fontSize: tokens.fontSize.base }}>Walkable</span>
        </label>
        <select
          aria-label="Wheelchair accessible"
          value={
            effective.wheelchairAccessible === undefined
              ? 'unknown'
              : effective.wheelchairAccessible
                ? 'accessible'
                : 'not-accessible'
          }
          onChange={event => commitRoutingPatch({
            wheelchairAccessible:
              event.target.value === 'unknown'
                ? undefined
                : event.target.value === 'accessible',
          })}
          style={selectStyle}
        >
          <option value="unknown">Wheelchair: Unknown</option>
          <option value="accessible">Wheelchair: Accessible</option>
          <option value="not-accessible">Wheelchair: Not accessible</option>
        </select>
      </Field>

      <button
        type="button"
        aria-expanded={showElevation}
        aria-label={showElevation ? 'Hide elevation details' : 'Show elevation details'}
        onClick={() => setShowElevation(value => !value)}
        style={{
          width: '100%', padding: '6px 8px', marginBottom: showElevation ? 8 : 2,
          border: `1px solid ${tokens.border}`, borderRadius: tokens.radius.sm,
          background: 'transparent', color: tokens.textSecondary, cursor: 'pointer',
          fontSize: tokens.fontSize.sm, fontFamily: 'inherit', textAlign: 'left',
        }}
      >
        {showElevation ? 'Hide elevation' : 'Add elevation'}
      </button>

      {showElevation && (
        <div style={{ padding: '8px 8px 2px', border: `1px solid ${tokens.border}`, borderRadius: tokens.radius.md }}>
          <Field label="Start elevation (m)">
            <input
              type="text"
              inputMode="decimal"
              aria-label="Start elevation (m)"
              aria-invalid={startInvalid || undefined}
              value={startElevation}
              onChange={event => updateElevation('startElevationMeters', event.target.value)}
              style={startInvalid ? { ...inputStyle, borderColor: tokens.danger } : inputStyle}
            />
            {startInvalid && (
              <div role="alert" style={{ color: tokens.danger, fontSize: tokens.fontSize.xs, marginTop: 3 }}>
                Enter a finite number or leave blank.
              </div>
            )}
          </Field>

          <Field label="End elevation (m)">
            <input
              type="text"
              inputMode="decimal"
              aria-label="End elevation (m)"
              aria-invalid={endInvalid || undefined}
              value={endElevation}
              onChange={event => updateElevation('endElevationMeters', event.target.value)}
              style={endInvalid ? { ...inputStyle, borderColor: tokens.danger } : inputStyle}
            />
            {endInvalid && (
              <div role="alert" style={{ color: tokens.danger, fontSize: tokens.fontSize.xs, marginTop: 3 }}>
                Enter a finite number or leave blank.
              </div>
            )}
          </Field>

          <dl style={{ margin: '2px 0 6px', display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 8px' }}>
            <dt style={mutedTextStyle}>Elevation change</dt>
            <dd style={{ margin: 0, color: tokens.textPrimary, fontSize: tokens.fontSize.sm }}>
              {formatElevationDelta(elevationDelta)}
            </dd>
            <dt style={mutedTextStyle}>Grade</dt>
            <dd style={{ margin: 0, color: tokens.textPrimary, fontSize: tokens.fontSize.sm }}>
              {formatGrade(grade)}
            </dd>
          </dl>
          {hasExplicitLevelConflict && (
            <div
              role="status"
              style={{ color: tokens.warning, fontSize: tokens.fontSize.xs, margin: '2px 0 6px', lineHeight: 1.4 }}
            >
              Elevation suggests a grade, but Slope is set to Level. Manual slope controls routing cost.
            </div>
          )}
        </div>
      )}
    </>
  )
}
