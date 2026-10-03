import { useState, useCallback } from 'react'
import type { Floor } from '@navi/core'
import { useEditor } from '../context'
import { FloorPlanUpload, type FloorPlanImageDimensions } from '../ui/FloorPlanUpload'
import { buildFloorPlanReplaceAlignment, readFloorPlanImageDimensions } from '@/services/floor-plan-lifecycle'

interface FloorManagerDialogProps {
  open: boolean
  onClose: () => void
  buildingId?: string
}

function autoLabel(level: number): string {
  if (level === 0) return 'GF'
  if (level > 0) return `${level}F`
  return `${level}F`
}

export function FloorManagerDialog({ open, onClose, buildingId: propBuildingId }: FloorManagerDialogProps) {
  const { document, services } = useEditor()
  const dispatcher = services.get<any>('dispatcher')
  const publishStore = services.get<any>('publishStore')
  const viewport = services.get<any>('viewport')
  const buildingId = propBuildingId ?? (viewport?.activeBuildingId as string | null)
  const building = buildingId ? document.buildings.find(b => b.id === buildingId) : null

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [renameValues, setRenameValues] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<Record<string, boolean>>({})

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const toggleEditing = useCallback((id: string, currentName: string) => {
    setRenameValues(prev => ({ ...prev, [id]: currentName }))
    setEditing(prev => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const handleRenameSave = useCallback((floorId: string) => {
    const newName = renameValues[floorId]?.trim()
    if (newName && newName !== building?.floors.find(f => f.id === floorId)?.label) {
      dispatcher.execute({ id: 'floor.rename', label: 'Rename Floor', payload: { floorId, label: newName } })
    }
    setEditing(prev => ({ ...prev, [floorId]: false }))
  }, [dispatcher, renameValues, building])

  const handleAddFloor = useCallback(() => {
    if (!buildingId) return
    dispatcher.execute({ id: 'floor.create', label: 'Add Floor', payload: { buildingId } })
  }, [buildingId, dispatcher])

  const handleDelete = useCallback((floorId: string) => {
    dispatcher.execute({ id: 'floor.delete', label: 'Delete Floor', payload: { floorId } })
  }, [dispatcher])

  const handleUpdateMeta = useCallback((floorId: string, changes: Record<string, unknown>) => {
    dispatcher.execute({ id: 'entity.update', label: 'Update Floor', payload: { entityId: floorId, changes } })
  }, [dispatcher])

  const handleMove = useCallback((floorId: string, direction: 'up' | 'down') => {
    if (!building) return
    const idx = building.floors.findIndex(f => f.id === floorId)
    if (idx === -1) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= building.floors.length) return
    const floorIds = building.floors.map(f => f.id)
    const reordered = [...floorIds]
    ;[reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]]
    dispatcher.execute({ id: 'floor.reorder', label: 'Reorder Floor', payload: { buildingId: building.id, floorIds: reordered } })
  }, [building, dispatcher])

  if (!open || !building) return null

  const sortedFloors = [...building.floors].sort((a, b) => b.level - a.level)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.5)',
    }} onClick={onClose}>
      <div style={{
        background: '#0F172A', border: '1px solid #1E293B', borderRadius: 12,
        width: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid #1E293B', flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Manage Floors</div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{building.name || building.code}</div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#64748B', cursor: 'pointer',
            fontSize: 18, padding: '4px 8px', borderRadius: 4,
          }}>✕</button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px' }}>
          {sortedFloors.length === 0 ? (
            <div style={{ color: '#64748B', fontSize: 13, textAlign: 'center', padding: 24 }}>
              No floors yet. Click "Add Floor" to create one.
            </div>
          ) : sortedFloors.map((floor, idx) => (
            <FloorRow
              key={floor.id}
              floor={floor}
              index={idx}
              total={sortedFloors.length}
              expanded={!!expanded[floor.id]}
              isEditing={!!editing[floor.id]}
              renameValue={renameValues[floor.id] ?? floor.label}
              onToggleExpand={() => toggleExpand(floor.id)}
              onStartRename={() => toggleEditing(floor.id, floor.label)}
              onRenameChange={(v) => setRenameValues(prev => ({ ...prev, [floor.id]: v }))}
              onRenameSave={() => handleRenameSave(floor.id)}
              onRenameCancel={() => setEditing(prev => ({ ...prev, [floor.id]: false }))}
              onDelete={() => handleDelete(floor.id)}
              onMoveUp={() => handleMove(floor.id, 'up')}
              onMoveDown={() => handleMove(floor.id, 'down')}
              onUpdateMeta={(changes) => handleUpdateMeta(floor.id, changes)}
            />
          ))}
        </div>

        <div style={{
          display: 'flex', gap: 8, justifyContent: 'flex-end',
          padding: '12px 20px', borderTop: '1px solid #1E293B', flexShrink: 0,
        }}>
          <button onClick={handleAddFloor} style={{
            padding: '8px 16px', borderRadius: 6, border: '1px solid #1C6BEB',
            background: 'transparent', color: '#1C6BEB', cursor: 'pointer', fontSize: 12, fontWeight: 600,
          }}>
            + Add Floor
          </button>
          <button onClick={onClose} style={{
            padding: '8px 16px', borderRadius: 6, border: 'none',
            background: '#1C6BEB', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600,
          }}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

interface FloorRowProps {
  floor: Floor
  index: number
  total: number
  expanded: boolean
  isEditing: boolean
  renameValue: string
  onToggleExpand: () => void
  onStartRename: () => void
  onRenameChange: (v: string) => void
  onRenameSave: () => void
  onRenameCancel: () => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onUpdateMeta: (changes: Record<string, unknown>) => void
}

function FloorRow({
  floor, index, total, expanded, isEditing, renameValue,
  onToggleExpand, onStartRename, onRenameChange, onRenameSave, onRenameCancel,
  onDelete, onMoveUp, onMoveDown, onUpdateMeta,
}: FloorRowProps) {
  const isVisible = floor.visible !== false
  const isLocked = !!floor.locked
  const shortLabel = floor.shortLabel || autoLabel(floor.level)
  const handleFloorPlanUpload = useCallback(async (dataUrl: string, dimensions?: FloorPlanImageDimensions) => {
    const previousDimensions = await readFloorPlanImageDimensions(floor.planImageId)
    const nextAlignment = buildFloorPlanReplaceAlignment(floor.planAlignment, previousDimensions, dimensions)
    onUpdateMeta({
      planImageId: dataUrl,
      floorPlanState: 'active',
      planAlignment: nextAlignment,
    })
  }, [floor.planAlignment, floor.planImageId, onUpdateMeta])

  const handleFloorPlanRemove = useCallback(() => {
    onUpdateMeta({
      planImageId: null,
      floorPlanState: 'none',
      planAlignment: null,
    })
  }, [onUpdateMeta])

  return (
    <div style={{
      marginBottom: 6, borderRadius: 8, overflow: 'hidden',
      border: '1px solid #1E293B',
    }}>
      <div onClick={onToggleExpand} style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '8px 10px', background: '#1E293B', cursor: 'pointer',
      }}>
        <span style={{ color: '#64748B', fontSize: 10, width: 16, textAlign: 'center' }}>
          {expanded ? '▼' : '▶'}
        </span>

        <div style={{ fontSize: 11, color: '#64748B', minWidth: 28 }}>{shortLabel}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {isEditing ? (
            <input value={renameValue} onChange={e => onRenameChange(e.target.value)}
              onBlur={onRenameSave}
              onKeyDown={e => { if (e.key === 'Enter') onRenameSave(); if (e.key === 'Escape') onRenameCancel() }}
              onClick={e => e.stopPropagation()}
              autoFocus
              style={{ width: '100%', background: '#0F172A', color: '#fff', border: '1px solid #334155', borderRadius: 4, padding: '3px 6px', fontSize: 12 }}
            />
          ) : (
            <span onDoubleClick={e => { e.stopPropagation(); onStartRename() }}
              style={{ color: '#fff', fontSize: 13, cursor: 'pointer' }}>
              {floor.label}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }} onClick={e => e.stopPropagation()}>
          <button onClick={onMoveUp} disabled={index === 0}
            style={{ background: 'none', border: 'none', color: index === 0 ? '#1E293B' : '#64748B', cursor: index === 0 ? 'default' : 'pointer', fontSize: 11, padding: '2px 4px' }}>▲</button>
          <button onClick={onMoveDown} disabled={index === total - 1}
            style={{ background: 'none', border: 'none', color: index === total - 1 ? '#1E293B' : '#64748B', cursor: index === total - 1 ? 'default' : 'pointer', fontSize: 11, padding: '2px 4px' }}>▼</button>
        </div>

        <button onClick={e => { e.stopPropagation(); onDelete() }}
          style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 12, padding: '2px 4px' }}>✕</button>
      </div>

      {expanded && (
        <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>NAME</div>
              <input value={floor.label} onChange={e => onUpdateMeta({ label: e.target.value })}
                style={{ width: '100%', background: '#0F172A', color: '#fff', border: '1px solid #334155', borderRadius: 4, padding: '4px 8px', fontSize: 12 }} />
            </div>
            <div style={{ width: 100 }}>
              <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>LABEL</div>
              <input value={floor.shortLabel || ''} onChange={e => onUpdateMeta({ shortLabel: e.target.value || null })}
                placeholder={autoLabel(floor.level)}
                style={{ width: '100%', background: '#0F172A', color: '#fff', border: '1px solid #334155', borderRadius: 4, padding: '4px 8px', fontSize: 12 }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>HEIGHT</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="number" step="0.1" value={floor.height ?? 3.5} onChange={e => onUpdateMeta({ height: parseFloat(e.target.value) || 3.5 })}
                  style={{ width: '100%', background: '#0F172A', color: '#fff', border: '1px solid #334155', borderRadius: 4, padding: '4px 8px', fontSize: 12 }} />
                <span style={{ color: '#64748B', fontSize: 11 }}>m</span>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>ELEVATION</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="number" value={floor.elevation} readOnly
                  style={{ width: '100%', background: '#0F172A', color: '#64748B', border: '1px solid #1E293B', borderRadius: 4, padding: '4px 8px', fontSize: 12 }} />
                <span style={{ color: '#64748B', fontSize: 11 }}>m</span>
              </div>
            </div>
            <div style={{ width: 140 }}>
              <FloorPlanUpload
                imageUrl={floor.planImageId}
                state={floor.floorPlanState ?? (floor.planImageId ? 'active' : 'none')}
                onUpload={handleFloorPlanUpload}
                onRemove={handleFloorPlanRemove}
                locked={isLocked}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: '#ccc' }}>
              <input type="checkbox" checked={isVisible} onChange={e => onUpdateMeta({ visible: e.target.checked })}
                style={{ accentColor: '#1C6BEB' }} />
              Visible
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: '#ccc' }}>
              <input type="checkbox" checked={isLocked} onChange={e => onUpdateMeta({ locked: e.target.checked })}
                style={{ accentColor: '#F59E0B' }} />
              Locked
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
