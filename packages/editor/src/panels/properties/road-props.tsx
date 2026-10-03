import { useCallback } from 'react'
import type { Road, RoadDisplayMode, RoadRouting } from '@navi/core'
import { useEditor, useEditingEngine } from '../../context'
import { tokens, Field, inputStyle, selectStyle, SectionHeader } from './field'
import { RoadRoutingFields } from './road-routing-fields'

interface Props { road: Road }

const ROAD_COLORS = [
  '#1C6BEB', '#22C55E', '#EF4444', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
  '#14B8A6', '#E11D48', '#0EA5E9', '#A855F7', '#64748B',
]

export function RoadProperties({ road }: Props) {
  const { services } = useEditor()
  const editEngine = useEditingEngine()
  const dispatcher = services.get<any>('dispatcher')
  const workflow = services.get('workflow')

  const update = useCallback((changes: Record<string, unknown>) => {
    for (const [property, value] of Object.entries(changes)) {
      editEngine.begin({ kind: 'assign', entityId: road.id, property, value })
      editEngine.doCommit()
    }
    dispatcher.execute({ id: 'entity.update', label: 'Edit Road', payload: { entityId: road.id, changes } })
  }, [editEngine, dispatcher, road.id])

  const saveChanges = useCallback(() => {
    if (!workflow?.save) return
    try {
      const pending = workflow.save('manual')
      if (pending && typeof pending.then === 'function') {
        void pending.catch(() => {
          // WorkflowService records the failure in its lifecycle state; the
          // panel should not create an unhandled rejection on a manual save.
        })
      }
    } catch {
      // Synchronous failures are also represented by the workflow service.
    }
  }, [workflow])

  const currentColor = (road.metadata?.color as string) ?? ROAD_COLORS[0]
  const displayMode: RoadDisplayMode = road.displayMode === 'navigation-only' ? 'navigation-only' : 'visible'

  const updateRouting = useCallback((routing: RoadRouting | undefined) => {
    update({ routing })
  }, [update])

  const handleEditRoad = useCallback(() => {
    const eventBus = services.get('eventBus')
    eventBus?.emit('road.edit', { roadId: road.id })
  }, [services, road.id])

  return (
    <div style={{ padding: '6px 12px 14px', fontSize: tokens.fontSize.md, fontFamily: 'system-ui, sans-serif' }}>
      <SectionHeader>Details</SectionHeader>
      <Field label="Name">
        <input
          value={road.name}
          onChange={e => update({ name: e.target.value })}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              saveChanges()
            }
          }}
          style={inputStyle}
        />
      </Field>

      <Field label="Color">
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {ROAD_COLORS.map(c => (
            <button key={c} title={c}
              onClick={() => update({ metadata: { ...road.metadata, color: c } })}
              style={{
                width: 20, height: 20, borderRadius: '50%', border: c === currentColor ? '2px solid #fff' : '2px solid transparent',
                background: c, cursor: 'pointer', outline: c === currentColor ? '2px solid #3B82F6' : 'none',
                padding: 0, boxSizing: 'border-box',
              }}
            />
          ))}
        </div>
      </Field>

      <Field label="Width (px)">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="range" min={2} max={20} step={1}
            value={road.width}
            onChange={e => update({ width: parseFloat(e.target.value) })}
            style={{ width: 120, accentColor: tokens.accent }} />
          <span style={{ color: tokens.textMuted, fontSize: tokens.fontSize.sm }}>{road.width}px</span>
        </div>
      </Field>
      <Field label="Surface">
        <select value={road.surface} onChange={e => update({ surface: e.target.value })} style={selectStyle}>
          {['paved','concrete','brick','gravel','grass','unpaved'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </Field>
      <Field label="Type">
        <select value={road.type} onChange={e => update({ type: e.target.value })} style={selectStyle}>
          {['arterial','connector','service'].map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </Field>
      <Field label="Map display">
        <div style={{ display: 'flex', gap: 4 }}>
          {([
            { value: 'visible' as const, label: 'Visible route' },
            { value: 'navigation-only' as const, label: 'Navigation-only route' },
          ]).map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={displayMode === option.value}
              onClick={() => update({ displayMode: option.value })}
              title={option.value === 'navigation-only' ? 'Keep this route usable for navigation without showing it on the normal map' : 'Show this route on the normal map'}
              style={{
                flex: 1, padding: '5px 4px', borderRadius: 4, border: '1px solid var(--navi-border)',
                background: displayMode === option.value ? tokens.accent : 'transparent',
                color: displayMode === option.value ? '#fff' : tokens.textMuted,
                cursor: 'pointer', fontSize: 10, fontWeight: 600,
              }}
            >{option.label}</button>
          ))}
        </div>
      </Field>

      <RoadRoutingFields road={road} onUpdate={updateRouting} />

      <div style={{ marginTop: 12 }}>
        <button onClick={handleEditRoad}
          style={{
            width: '100%', padding: '8px 0', background: tokens.accent,
            color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
            fontSize: tokens.fontSize.sm, fontWeight: 600,
          }}>
          Edit Road
        </button>
        <button
          type="button"
          onClick={saveChanges}
          title="Persist the current road properties immediately"
          style={{
            width: '100%', marginTop: 6, padding: '7px 0', background: 'transparent',
            color: tokens.textMuted, border: `1px solid ${tokens.border}`, borderRadius: 6,
            cursor: 'pointer', fontSize: tokens.fontSize.sm, fontWeight: 600,
          }}
        >
          Save changes
        </button>
      </div>
    </div>
  )
}
