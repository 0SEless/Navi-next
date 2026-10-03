import { useState, useCallback } from 'react'
import { useEditor } from '../context'
import type { Floor } from '@navi/core'

interface FloorItemProps {
  floor: Floor
  isActive: boolean
  index: number
  total: number
  onSetActive: () => void
  onRename: (label: string) => void
  onDuplicate: () => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onEditInterior: () => void
}

function FloorItem({
  floor, isActive, index, total,
  onSetActive, onRename, onDuplicate, onDelete, onMoveUp, onMoveDown, onEditInterior,
}: FloorItemProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(floor.label)

  const handleSave = useCallback(() => {
    if (editValue.trim() && editValue !== floor.label) {
      onRename(editValue.trim())
    }
    setEditing(false)
  }, [editValue, floor.label, onRename])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '3px 6px',
        borderRadius: 3,
        background: isActive ? '#094771' : 'transparent',
        color: isActive ? '#fff' : '#ccc',
        cursor: 'pointer',
        fontSize: 13,
      }}
    >
      {isActive && <span style={{ color: '#60A5FA', fontSize: 10 }}>▶</span>}
      <div
        onClick={onSetActive}
        style={{ flex: 1, minWidth: 0 }}
        title={floor.label}
      >
        {editing ? (
          <input
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false) }}
            autoFocus
            style={{ width: '100%', background: '#1a1a2e', color: '#fff', border: '1px solid #444', borderRadius: 2, padding: '1px 4px', fontSize: 12 }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span onDoubleClick={e => { e.stopPropagation(); setEditing(true); setEditValue(floor.label) }}>
            {floor.label} <span style={{ color: '#666', fontSize: 11 }}>(L{floor.level})</span>
          </span>
        )}
      </div>
      <button
        onClick={e => { e.stopPropagation(); onMoveUp() }}
        disabled={index === 0}
        title="Move up"
        style={{ background: 'none', border: 'none', color: index === 0 ? '#444' : '#888', cursor: index === 0 ? 'default' : 'pointer', fontSize: 12, padding: '0 2px' }}
      >▲</button>
      <button
        onClick={e => { e.stopPropagation(); onMoveDown() }}
        disabled={index === total - 1}
        title="Move down"
        style={{ background: 'none', border: 'none', color: index === total - 1 ? '#444' : '#888', cursor: index === total - 1 ? 'default' : 'pointer', fontSize: 12, padding: '0 2px' }}
      >▼</button>
      <button
        onClick={e => { e.stopPropagation(); onEditInterior() }}
        title="Edit floor interior"
        style={{ background: 'none', border: 'none', color: '#60A5FA', cursor: 'pointer', fontSize: 12, padding: '0 2px' }}
      >✎</button>
      <button
        onClick={e => { e.stopPropagation(); onDuplicate() }}
        title="Duplicate"
        style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 11, padding: '0 2px' }}
      >⧉</button>
      <button
        onClick={e => { e.stopPropagation(); onDelete() }}
        title="Delete floor"
        style={{ background: 'none', border: 'none', color: '#f14c4c', cursor: 'pointer', fontSize: 12, padding: '0 2px' }}
      >✕</button>
    </div>
  )
}

export function FloorManager() {
  const { document, services } = useEditor()
  const dispatcher = services.get('dispatcher')
  const viewport = services.get('viewport')
  const buildingId = viewport?.activeBuildingId ?? null

  const building = buildingId ? document.buildings.find(b => b.id === buildingId) : null

  const handleAddFloor = useCallback(() => {
    if (!buildingId || !dispatcher || !viewport) return
    dispatcher.execute({ id: 'floor.create', label: 'Add Floor', payload: { buildingId } })
    // auto-set active floor to new one
    const bld = document.buildings.find(b => b.id === buildingId)
    if (bld && bld.floors.length > 0) {
      viewport.setActiveFloor(bld.floors[bld.floors.length - 1].id)
    }
  }, [buildingId, dispatcher, document.buildings, viewport])

  const handleSetActive = useCallback((floorId: string) => {
    if (!viewport) return
    viewport.setActiveFloor(floorId === viewport.activeFloorId ? null : floorId)
  }, [viewport])

  const handleEditInterior = useCallback(async (level: number) => {
    if (!buildingId || !dispatcher) return
    const workflow = services.get('workflow')
    if (workflow?.save) {
      try {
        await workflow.save('manual')
      } catch (err) {
        console.warn('Pre-navigation save failed:', err)
      }
    }
    dispatcher.execute({
      id: 'building.editInterior',
      label: 'Edit Interior',
      payload: { buildingId, floor: level },
    })
  }, [buildingId, dispatcher, services])

  const handleRename = useCallback((floorId: string, label: string) => {
    dispatcher?.execute({ id: 'floor.rename', label: 'Rename Floor', payload: { floorId, label } })
  }, [dispatcher])

  const handleDuplicate = useCallback((floorId: string) => {
    dispatcher?.execute({ id: 'floor.duplicate', label: 'Duplicate Floor', payload: { floorId } })
  }, [dispatcher])

  const handleDelete = useCallback((floorId: string) => {
    if (!dispatcher || !viewport) return
    dispatcher.execute({ id: 'floor.delete', label: 'Delete Floor', payload: { floorId } })
    if (viewport.activeFloorId === floorId) {
      viewport.setActiveFloor(null)
    }
  }, [dispatcher, viewport])

  const handleMoveFloor = useCallback((floorId: string, direction: 'up' | 'down') => {
    if (!building || !dispatcher) return
    const floorIds = building.floors.map((f) => f.id)
    const idx = floorIds.indexOf(floorId)
    if (idx === -1) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= floorIds.length) return
    const temp = floorIds[idx]
    floorIds[idx] = floorIds[swapIdx]
    floorIds[swapIdx] = temp
    dispatcher.execute({
      id: 'floor.reorder',
      label: 'Reorder Floors',
      payload: { buildingId: building.id, floorIds },
    })
  }, [building, dispatcher])

  if (!building) return null

  return (
    <div style={{ padding: 8, fontSize: 13, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontWeight: 600, color: '#fff', textTransform: 'uppercase', fontSize: 11, letterSpacing: 1 }}>
          Floors — {building.name || building.code}
        </div>
        <button
          onClick={handleAddFloor}
          title="Add floor"
          style={{ background: '#094771', border: 'none', color: '#fff', borderRadius: 3, padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}
        >+ Add</button>
      </div>
      {building.floors.length === 0 && (
        <div style={{ color: '#666', fontStyle: 'italic', padding: '4px 0' }}>No floors. Click + to add one.</div>
      )}
      {[...building.floors].sort((a, b) => b.level - a.level).map((flr, i, arr) => (
        <FloorItem
          key={flr.id}
          floor={flr}
          isActive={flr.id === viewport.activeFloorId}
          index={i}
          total={arr.length}
          onSetActive={() => handleSetActive(flr.id)}
          onEditInterior={() => handleEditInterior(flr.level)}
          onRename={(label) => handleRename(flr.id, label)}
          onDuplicate={() => handleDuplicate(flr.id)}
          onDelete={() => handleDelete(flr.id)}
          onMoveUp={() => handleMoveFloor(flr.id, 'up')}
          onMoveDown={() => handleMoveFloor(flr.id, 'down')}
        />
      ))}
    </div>
  )
}
