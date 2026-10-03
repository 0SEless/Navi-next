import { useCallback } from 'react'
import type { Panorama, PanoramaHotspot } from '@navi/core'
import { useEditor } from '../../context'
import { tokens, Field, inputStyle, selectStyle, ActionButton, SectionHeader } from './field'

interface Props {
  panorama: Panorama
  hotspotIndex: number
  hotspot: PanoramaHotspot
  onUpdate: (changes: Partial<PanoramaHotspot>) => void
  onDelete: () => void
}

export function HotspotProperties({ panorama, hotspotIndex, hotspot, onUpdate, onDelete }: Props) {
  const { services } = useEditor()
  const dispatcher = services.get<any>('dispatcher')

  const updatePosition = useCallback((yaw: number, pitch: number) => {
    onUpdate({ position: { yaw, pitch } })
  }, [onUpdate])

  const updateTarget = useCallback((targetId: string) => {
    onUpdate({ target: { type: 'panorama', targetId } })
  }, [onUpdate])

  const updateContent = useCallback((changes: Record<string, unknown>) => {
    const newContent = { ...hotspot.content, ...changes }
    onUpdate({ content: newContent })
  }, [hotspot.content, onUpdate])

  return (
    <div style={{ padding: '6px 12px 14px', fontSize: tokens.fontSize.md, fontFamily: 'system-ui, sans-serif' }}>
      <SectionHeader>Hotspot #{hotspotIndex + 1}</SectionHeader>
      
      <Field label="Type">
        <select
          value={hotspot.hotspotType || 'navigation'}
          onChange={e => onUpdate({ hotspotType: e.target.value as 'navigation' | 'information' })}
          style={selectStyle}
        >
          <option value="navigation">Navigation</option>
          <option value="information">Information</option>
        </select>
      </Field>

      <Field label="Label">
        <input
          value={hotspot.label}
          onChange={e => onUpdate({ label: e.target.value })}
          style={inputStyle}
        />
      </Field>

      <SectionHeader>Position</SectionHeader>
      <Field label="Yaw (°)">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="range"
            min={0}
            max={360}
            step={1}
            value={hotspot.position.yaw}
            onChange={e => updatePosition(parseFloat(e.target.value), hotspot.position.pitch)}
            style={{ width: 120, accentColor: tokens.accent }}
          />
          <span style={{ color: tokens.textMuted, fontSize: tokens.fontSize.sm }}>
            {hotspot.position.yaw}°
          </span>
        </div>
      </Field>

      <Field label="Pitch (°)">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="range"
            min={-90}
            max={90}
            step={1}
            value={hotspot.position.pitch}
            onChange={e => updatePosition(hotspot.position.yaw, parseFloat(e.target.value))}
            style={{ width: 120, accentColor: tokens.accent }}
          />
          <span style={{ color: tokens.textMuted, fontSize: tokens.fontSize.sm }}>
            {hotspot.position.pitch}°
          </span>
        </div>
      </Field>

      {hotspot.hotspotType === 'navigation' && (
        <>
          <SectionHeader>Target</SectionHeader>
          <Field label="Target Panorama">
            <select
              value={hotspot.target.targetId}
              onChange={e => updateTarget(e.target.value)}
              style={selectStyle}
            >
              <option value="">Select target...</option>
              {panorama.hotspots.length > 0 && (
                <optgroup label="This tour's panoramas">
                  {/* We need to get the list of panoramas from the document */}
                </optgroup>
              )}
            </select>
          </Field>
        </>
      )}

      {hotspot.hotspotType === 'information' && (
        <>
          <SectionHeader>Content</SectionHeader>
          <Field label="Title">
            <input
              value={hotspot.content?.title || ''}
              onChange={e => updateContent({ title: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="Description">
            <textarea
              value={hotspot.content?.description || ''}
              onChange={e => updateContent({ description: e.target.value })}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </Field>
          <Field label="Image URL">
            <input
              value={hotspot.content?.imageUrl || ''}
              onChange={e => updateContent({ imageUrl: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="Link URL">
            <input
              value={hotspot.content?.linkUrl || ''}
              onChange={e => updateContent({ linkUrl: e.target.value })}
              style={inputStyle}
            />
          </Field>
          <Field label="Link Label">
            <input
              value={hotspot.content?.linkLabel || ''}
              onChange={e => updateContent({ linkLabel: e.target.value })}
              style={inputStyle}
            />
          </Field>
        </>
      )}

      <div style={{ marginTop: 12 }}>
        <ActionButton variant="danger" onClick={onDelete}>
          Delete Hotspot
        </ActionButton>
      </div>
    </div>
  )
}
