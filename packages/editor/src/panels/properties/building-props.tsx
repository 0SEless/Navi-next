import { useCallback, useMemo, useState } from 'react'
import type { Building, Floor } from '@navi/core'
import { useEditor, useEditingEngine } from '../../context'
import { tokens, Field, inputStyle, selectStyle, SectionHeader, ActionButton } from './field'
import { usePublish } from '../workflow/use-publish'
import { FloorManagerDialog } from '../FloorManagerDialog'
import { useStudioStore } from '@/store/studio-store'

interface Props { building: Building }

function floorPlanStatus(floors: Floor[]) {
  return floors.map(f => ({
    id: f.id,
    label: f.label,
    hasPlan: !!f.planImageId,
    state: f.floorPlanState ?? (f.planImageId ? 'active' : 'none'),
  }))
}

const BUILD_STATUS_LABELS: Record<string, string> = {
  idle: '', preparing: 'Preparing...', validating: 'Validating...',
  compiling: 'Compiling...', uploading: 'Uploading...',
  success: '', error: 'Publish failed',
}

function formatTimestamp(ts: number): string {
  if (!ts) return 'Never'
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function getFootprintPoints(building: Building): { lat: number; lng: number }[] {
  const fp: unknown = building.footprint
  if (Array.isArray(fp)) return fp as { lat: number; lng: number }[]
  if (fp && typeof fp === 'object' && 'points' in fp && Array.isArray((fp as { points: unknown }).points)) {
    return (fp as { points: { lat: number; lng: number }[] }).points
  }
  return []
}

function footprintCentroid(points: { lat: number; lng: number }[]): { lat: number; lng: number } | null {
  if (!points || points.length === 0) return null
  const pts = points[0].lat === points[points.length - 1].lat && points[0].lng === points[points.length - 1].lng
    ? points.slice(0, -1) : points
  if (pts.length === 0) return null
  return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length }
}

export function BuildingProperties({ building }: Props) {
  const { services } = useEditor()
  const editEngine = useEditingEngine()
  const dispatcher = services.get('dispatcher')
  const { snapshot } = usePublish()
  const [showFloorManager, setShowFloorManager] = useState(false)
  const positionEditTarget = useStudioStore((s) => s.positionEditTarget)
  const setPositionEditTarget = useStudioStore((s) => s.setPositionEditTarget)
  const isAdjusting = positionEditTarget?.type === 'building' && positionEditTarget?.id === building.id

  const centroid = useMemo(() => footprintCentroid(getFootprintPoints(building)), [building])

  const update = useCallback((changes: Record<string, unknown>) => {
    for (const [property, value] of Object.entries(changes)) {
      editEngine.begin({ kind: 'assign', entityId: building.id, property, value })
      editEngine.doCommit()
    }
    dispatcher?.execute({ id: 'entity.update', label: 'Edit Building', payload: { entityId: building.id, changes } })
  }, [editEngine, dispatcher, building.id])

  const openPositionEditor = useCallback(() => {
    dispatcher.execute({ id: 'building.adjustPosition', label: 'Adjust Position', payload: { buildingId: building.id } })
    setPositionEditTarget({ type: 'building', id: building.id })
  }, [dispatcher, building.id, setPositionEditTarget])

  const closePositionEditor = useCallback(() => {
    setPositionEditTarget(null)
  }, [setPositionEditTarget])

  const openFloorManager = useCallback(() => {
    dispatcher.execute({ id: 'floor.manage', label: 'Manage Floors', payload: { buildingId: building.id } })
    setShowFloorManager(true)
  }, [dispatcher, building.id])

  const plans = useMemo(() => floorPlanStatus(building.floors), [building.floors])

  const hasPanoramas = useMemo(() =>
    building.floors?.some(f =>
      f.connectorStops?.some(cs => cs.anchors?.some(a => 'imageAssetId' in a && !('code' in a)))
    ), [building.floors])

  const buildStatus = useMemo(() => {
    if (snapshot.publishState === 'success' || (snapshot.publishState === 'idle' && snapshot.lastPublishedAt > 0)) {
      return { label: 'Published', ok: true }
    }
    if (snapshot.publishState === 'error') {
      return { label: 'Publish failed', ok: false }
    }
    if (snapshot.publishState !== 'idle') {
      return { label: BUILD_STATUS_LABELS[snapshot.publishState] || 'Publishing...', ok: false }
    }
    return { label: 'Not published', ok: false }
  }, [snapshot])

  return (
    <div style={{ padding: '6px 12px 14px' }}>
      {/* ── 1. Information ── */}
      <SectionHeader>Information</SectionHeader>
      <Field label="Name">
        <input value={building.name} onChange={e => update({ name: e.target.value })} style={inputStyle} />
      </Field>
      <Field label="Code">
        <input value={building.code} onChange={e => update({ code: e.target.value })} style={inputStyle} />
      </Field>
      <Field label="Category">
        <select value={building.category} onChange={e => update({ category: e.target.value })} style={selectStyle}>
          {['academic','residential','administrative','facility','library','dining','sports','parking','health','other'].map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </Field>
      <Field label="Description">
        <textarea value={building.description} onChange={e => update({ description: e.target.value })} rows={2} style={{
          ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5,
        }} />
      </Field>

      {/* ── 2. Physical ── */}
      <SectionHeader>Physical</SectionHeader>
      <Field label="Building Height">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="number" step="0.5" value={building.height}
            onChange={e => update({ height: parseFloat(e.target.value) || 0 })}
            style={{ ...inputStyle, width: 80 }} />
          <span style={{ color: tokens.textMuted, fontSize: tokens.fontSize.sm }}>m</span>
        </div>
      </Field>
      <Field label="Elevation">
        <div style={{ color: tokens.textPrimary, fontSize: tokens.fontSize.md }}>
          {building.baseElevation.toFixed(1)} m
        </div>
      </Field>
      <Field label="Color">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="color" value={building.color}
            onChange={e => update({ color: e.target.value })}
            style={{
              width: 36, height: 28, padding: 1, border: `1px solid ${tokens.border}`,
              borderRadius: tokens.radius.sm, cursor: 'pointer', background: 'transparent',
            }} />
          <span style={{ color: tokens.textMuted, fontSize: tokens.fontSize.sm, fontFamily: 'monospace' }}>
            {building.color}
          </span>
        </div>
      </Field>
      <Field label="Floors">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: tokens.textPrimary, fontSize: tokens.fontSize.md }}>
            {building.floors.length} Floor{building.floors.length !== 1 ? 's' : ''}
          </span>
          <button style={{
            background: tokens.accent, color: '#fff', border: 'none',
            borderRadius: tokens.radius.sm, padding: '5px 12px',
            fontSize: tokens.fontSize.sm, fontWeight: 600, cursor: 'pointer',
          }} onClick={openFloorManager}>
            Manage Floors
          </button>
        </div>
      </Field>

      {/* ── 3. Status ── */}
      <SectionHeader>Status</SectionHeader>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: tokens.fontSize.base, color: buildStatus.ok ? tokens.success : tokens.warning,
        marginBottom: 4,
      }}>
        <span style={{ fontSize: 14 }}>{buildStatus.ok ? '✓' : '⚠'}</span>
        <span>Build Status: {buildStatus.label}</span>
      </div>
      <div style={{ color: tokens.textMuted, fontSize: tokens.fontSize.sm, marginBottom: 2 }}>
        Last Published: {formatTimestamp(snapshot.lastPublishedAt)}
      </div>

      {/* ── 4. Actions ── */}
      <SectionHeader>Actions</SectionHeader>
      <ActionButton
        disabled={building.floors.length === 0}
        style={{ opacity: building.floors.length === 0 ? 0.5 : 1 }}
        onClick={async () => {
          const workflow = services.get('workflow')
          if (workflow?.save) {
            try {
              await workflow.save('manual')
            } catch (err) {
              console.warn('Pre-navigation save failed:', err)
            }
          }
          const viewport = services.get('viewport')
          const activeFloor = building.floors.find((f) => f.id === viewport?.activeFloorId)
          dispatcher?.execute({
            id: 'building.editInterior',
            label: 'Edit Interior',
            payload: { buildingId: building.id, floor: activeFloor?.level ?? building.floors[0]?.level ?? 0 },
          })
        }}
      >
        Edit Interior
      </ActionButton>

      <div style={{
        background: isAdjusting ? '#1A1A3A' : 'transparent',
        border: isAdjusting ? `1px solid #3A3A6A` : 'none',
        borderRadius: tokens.radius.md, padding: isAdjusting ? 10 : 0,
        marginBottom: 8,
      }}>
        {!isAdjusting ? (
          <>
            <div style={{
              color: tokens.textMuted, fontSize: tokens.fontSize.xs,
              fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
              marginBottom: 6,
            }}>
              Position
            </div>
            <div style={{ color: tokens.textSecondary, fontSize: tokens.fontSize.base, marginBottom: 8, lineHeight: 1.6 }}>
              <div>Lat: {centroid?.lat.toFixed(6) ?? '—'}</div>
              <div>Lng: {centroid?.lng.toFixed(6) ?? '—'}</div>
              <div>Elev: {building.baseElevation.toFixed(1)} m</div>
            </div>
            <ActionButton onClick={openPositionEditor}>
              Adjust on Map
            </ActionButton>
          </>
        ) : (
          <>
            <div style={{ color: tokens.textSecondary, fontSize: tokens.fontSize.base, marginBottom: 10 }}>
              Drag the building on the map to adjust its position.
            </div>
            <ActionButton variant="success" style={{ textAlign: 'center' }} onClick={closePositionEditor}>
              ✓ Done
            </ActionButton>
          </>
        )}
      </div>

      {/* ── 5. Assets ── */}
      <SectionHeader>Assets</SectionHeader>
      <Field label="Floor Plans">
        {plans.length === 0 ? (
          <div style={{ color: tokens.textMuted, fontSize: tokens.fontSize.sm }}>No floors yet</div>
        ) : (
          plans.map(p => (
            <div key={p.id} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontSize: tokens.fontSize.base, color: tokens.textPrimary,
              padding: '4px 0', borderBottom: `1px solid transparent`,
            }}>
              <span>{p.label}</span>
              <span style={{
                color: p.state === 'none' ? tokens.warning
                  : p.state === 'locked' ? tokens.textMuted
                  : tokens.success,
                fontSize: tokens.fontSize.sm,
              }}>
                {p.state === 'none' ? '⚠ Missing'
                  : p.state === 'locked' ? '🔒 Locked'
                  : '✓ Uploaded'}
              </span>
            </div>
          ))
        )}
      </Field>
      <Field label="Panoramas">
        <div style={{
          fontSize: tokens.fontSize.base,
          color: hasPanoramas ? tokens.success : tokens.textMuted,
        }}>
          {hasPanoramas ? '✓ Panorama hotspots exist' : 'No panoramas'}
        </div>
      </Field>

      {/* ── 6. Danger Zone ── */}
      <SectionHeader>Danger Zone</SectionHeader>
      <ActionButton variant="danger" onClick={() => {
        editEngine.begin({ kind: 'delete', entityIds: [building.id] })
        editEngine.doCommit()
        dispatcher?.execute({
          id: 'building.delete', label: 'Delete Building',
          payload: { buildingId: building.id },
        })
      }}>
        Delete Building
      </ActionButton>

      <FloorManagerDialog open={showFloorManager} onClose={() => setShowFloorManager(false)} buildingId={building.id} />
    </div>
  )
}
