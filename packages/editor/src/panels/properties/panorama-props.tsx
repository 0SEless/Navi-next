import { useCallback, useState, useMemo } from 'react'
import type { Panorama } from '@navi/core'
import { useEditor, useEditingEngine } from '../../context'
import { tokens, Field, inputStyle, ActionButton, SectionHeader } from './field'
import { useStudioStore } from '@/store/studio-store'
import { HotspotProperties } from './hotspot-props'
import { HotspotPlacementTool } from '../HotspotPlacementTool'
import { validatePanoramaHotspots } from '@navi/core'

interface Props { panorama: Panorama }

export function PanoramaProperties({ panorama }: Props) {
  const { services, document } = useEditor()
  const editEngine = useEditingEngine()
  const dispatcher = services.get<any>('dispatcher')
  const positionEditTarget = useStudioStore((s) => s.positionEditTarget)
  const setPositionEditTarget = useStudioStore((s) => s.setPositionEditTarget)
  const isAdjusting = positionEditTarget?.type === 'panorama' && positionEditTarget?.id === panorama.id
  const [selectedHotspotIndex, setSelectedHotspotIndex] = useState<number | null>(null)
  const [placementTool, setPlacementTool] = useState<{ isOpen: boolean; type: 'navigation' | 'information' }>({ isOpen: false, type: 'navigation' })

  // Validate hotspots
  const allPanoramaIds = useMemo(() => 
    (document.panoramas || []).map(p => p.id),
    [document.panoramas]
  )
  const hotspotIssues = useMemo(() =>
    validatePanoramaHotspots(panorama, allPanoramaIds),
    [panorama, allPanoramaIds]
  )
  const errors = hotspotIssues.filter(i => i.severity === 'error')
  const warnings = hotspotIssues.filter(i => i.severity === 'warning')

  const update = useCallback((changes: Record<string, unknown>) => {
    for (const [property, value] of Object.entries(changes)) {
      editEngine.begin({ kind: 'assign', entityId: panorama.id, property, value })
      editEngine.doCommit()
    }
    dispatcher.execute({ id: 'entity.update', label: 'Edit Panorama', payload: { entityId: panorama.id, changes } })
  }, [editEngine, dispatcher, panorama.id])

  const addHotspot = useCallback((hotspotType: 'navigation' | 'information') => {
    dispatcher.execute({
      id: 'hotspot.create',
      label: `Add ${hotspotType} hotspot`,
      payload: {
        panoramaId: panorama.id,
        hotspotType,
        label: '',
        yaw: 0,
        pitch: 0,
        targetId: '',
        content: hotspotType === 'information' ? { title: '' } : undefined,
      },
    })
  }, [dispatcher, panorama.id])

  const updateHotspot = useCallback((index: number, changes: Record<string, unknown>) => {
    dispatcher.execute({
      id: 'hotspot.update',
      label: 'Update hotspot',
      payload: {
        panoramaId: panorama.id,
        hotspotIndex: index,
        changes,
      },
    })
  }, [dispatcher, panorama.id])

  const deleteHotspot = useCallback((index: number) => {
    dispatcher.execute({
      id: 'hotspot.delete',
      label: 'Delete hotspot',
      payload: {
        panoramaId: panorama.id,
        hotspotIndex: index,
      },
    })
    setSelectedHotspotIndex(null)
  }, [dispatcher, panorama.id])

  // If a hotspot is selected, show its properties
  if (selectedHotspotIndex !== null && selectedHotspotIndex < panorama.hotspots.length) {
    const hotspot = panorama.hotspots[selectedHotspotIndex]
    return (
      <div>
        <div style={{ padding: '6px 12px', borderBottom: '1px solid #eee' }}>
          <button
            onClick={() => setSelectedHotspotIndex(null)}
            style={{ fontSize: 12, color: '#666', cursor: 'pointer', background: 'none', border: 'none' }}
          >← Back to Panorama</button>
        </div>
        <HotspotProperties
          panorama={panorama}
          hotspotIndex={selectedHotspotIndex}
          hotspot={hotspot}
          onUpdate={(changes) => updateHotspot(selectedHotspotIndex, changes)}
          onDelete={() => deleteHotspot(selectedHotspotIndex)}
        />
      </div>
    )
  }

  return (
    <div style={{ padding: '6px 12px 14px', fontSize: tokens.fontSize.md, fontFamily: 'system-ui, sans-serif' }}>
      <SectionHeader>Details</SectionHeader>
      <Field label="Label">
        <input value={panorama.label} onChange={e => update({ label: e.target.value })} style={inputStyle} />
      </Field>
      <Field label="Heading (°)">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="range" min={0} max={360} step={1}
            value={panorama.heading}
            onChange={e => update({ heading: parseFloat(e.target.value) })}
            style={{ width: 120, accentColor: tokens.accent }} />
          <span style={{ color: tokens.textMuted, fontSize: tokens.fontSize.sm }}>{panorama.heading}°</span>
        </div>
      </Field>
      <Field label="Image Asset">
        <input value={panorama.imageAssetId} onChange={e => update({ imageAssetId: e.target.value })} style={inputStyle} />
      </Field>

      <SectionHeader>Hotspots ({panorama.hotspots.length})</SectionHeader>
      {(errors.length > 0 || warnings.length > 0) && (
        <div style={{ marginBottom: 8 }}>
          {errors.map((error, i) => (
            <div key={`error-${i}`} style={{ padding: '4px 8px', background: '#fee2e2', borderRadius: 4, marginBottom: 4, fontSize: 11, color: '#991b1b' }}>
              ⚠ {error.message}
            </div>
          ))}
          {warnings.map((warning, i) => (
            <div key={`warning-${i}`} style={{ padding: '4px 8px', background: '#fef3c7', borderRadius: 4, marginBottom: 4, fontSize: 11, color: '#92400e' }}>
              ⚡ {warning.message}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <ActionButton onClick={() => setPlacementTool({ isOpen: true, type: 'navigation' })}>+ Navigation</ActionButton>
        <ActionButton onClick={() => setPlacementTool({ isOpen: true, type: 'information' })}>+ Information</ActionButton>
      </div>
      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
        {panorama.hotspots.map((hotspot, index) => (
          <div
            key={index}
            onClick={() => setSelectedHotspotIndex(index)}
            style={{
              padding: '6px 8px',
              marginBottom: 4,
              background: '#f5f5f5',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            <span style={{ marginRight: 4 }}>{hotspot.hotspotType === 'information' ? 'ℹ️' : '→'}</span>
            {hotspot.label || `Hotspot ${index + 1}`}
            {hotspot.position && (
              <span style={{ color: '#999', marginLeft: 4 }}>({hotspot.position.yaw}°, {hotspot.position.pitch}°)</span>
            )}
          </div>
        ))}
        {panorama.hotspots.length === 0 && (
          <div style={{ color: '#999', fontSize: 12, textAlign: 'center', padding: 8 }}>
            No hotspots yet. Add one above.
          </div>
        )}
      </div>

      <SectionHeader>Position</SectionHeader>
      {!isAdjusting ? (
        <ActionButton onClick={() => setPositionEditTarget({ type: 'panorama', id: panorama.id })}>
          Adjust on Map
        </ActionButton>
      ) : (
        <div style={{
          background: '#1A1A3A', border: `1px solid #3A3A6A`,
          borderRadius: tokens.radius.md, padding: 10,
        }}>
          <div style={{ color: tokens.textSecondary, fontSize: tokens.fontSize.base, marginBottom: 10 }}>
            Drag the panorama marker on the map to adjust its position.
          </div>
          <ActionButton variant="success" style={{ textAlign: 'center' }}
            onClick={() => setPositionEditTarget(null)}>
            ✓ Done
          </ActionButton>
        </div>
      )}

      {/* Hotspot Placement Tool */}
      <HotspotPlacementTool
        isOpen={placementTool.isOpen}
        onClose={() => setPlacementTool({ isOpen: false, type: 'navigation' })}
        panoramaId={panorama.id}
        hotspotType={placementTool.type}
      />
    </div>
  )
}
