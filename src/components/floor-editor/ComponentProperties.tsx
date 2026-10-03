'use client'

import { useState, useEffect, useMemo } from 'react'
import { useEditor, useEditingEngine, useDocumentVersion } from '@navi/editor'
import { canonicalRoomId, SpatialQueryService } from '@navi/core'
import type { Road } from '@navi/core'
import { RelationshipService, RelationshipSuggestionService } from '@navi/editor'
import { isSemanticRoomComponent, useFloorComponent } from '@/hooks/floor-graph-selectors'
import { useGraphStore } from '@/store/graph-store'
import { useInteraction } from './InteractionContext'
import { getSemanticRoomIdentity } from './semantic-room-interaction'
import { isSelectableOutdoorRouteNode, traceIdForOutdoorRouteNode } from './outdoor-route-picker-model'
import type { ValidationCheck } from './validation-checks'
import type { RelationshipSuggestion } from '@navi/editor'

// ── Helpers ──────────────────────────────────────────────────────────────────

function isEntranceType(type: string): boolean {
  return type === 'entrance'
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string, legacyKey?: string): string {
  const value = metadata?.[key]
  if (typeof value === 'string') return value
  const legacyValue = legacyKey ? metadata?.[legacyKey] : undefined
  return typeof legacyValue === 'string' ? legacyValue : ''
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_ROOM_WIDTH = 4
const DEFAULT_ROOM_HEIGHT = 5
const DEFAULT_FLOOR = 0
const ROOM_TYPE_OPTIONS = ['Classroom', 'Laboratory', 'Office', 'Restroom', 'Storage', 'Circulation', 'Other']
const DOOR_TYPE_OPTIONS = ['standard', 'opening', 'fire', 'double', 'sliding']
const SEARCHABLE_HELP_TEXT = 'Searchable Rooms can be found by campus users through search using the room name, code, or description.'

function readableOutdoorRoutePoint(node: { name?: string; label?: string; type?: string } | undefined): string {
  return node?.name ?? node?.label ?? (node?.type === 'building_entrance' ? 'Campus entrance' : 'Outdoor route point')
}

function readableIndoorRoutePoint(nodes: Array<{ id: string; type?: string }>, nodeId: string | undefined): string {
  const index = nodes.findIndex((node) => node.id === nodeId)
  return index >= 0 ? `Route point ${index + 1}` : 'Route point'
}

// ── Entrance Road Section ────────────────────────────────────────────────────

interface EntranceRoadSectionProps {
  component: { id: string }
  connectedRoad: Road | null
  hasNoRoadWarning: boolean
  topSuggestion: RelationshipSuggestion | null
  dispatcher: { execute: (cmd: { id: string; label: string; payload: Record<string, unknown> }) => void }
  enterRelationshipSelection: (ownerId: string, ownerType: string, relationshipType: string) => void
  onAcceptSuggestion: (roadId: string) => void
}

function EntranceRoadSection({
  component,
  connectedRoad,
  hasNoRoadWarning,
  topSuggestion,
  dispatcher,
  enterRelationshipSelection,
  onAcceptSuggestion,
}: EntranceRoadSectionProps) {
  const handleConnect = () => {
    enterRelationshipSelection(component.id, 'entrance', 'entrance-road')
  }

  const handleChange = () => {
    dispatcher.execute({
      id: 'entrance.disconnectRoad',
      label: 'Disconnect Entrance',
      payload: { entranceId: component.id },
    })
    enterRelationshipSelection(component.id, 'entrance', 'entrance-road')
  }

  const handleDisconnect = () => {
    dispatcher.execute({
      id: 'entrance.disconnectRoad',
      label: 'Disconnect Entrance',
      payload: { entranceId: component.id },
    })
  }

  return (
    <div style={{ marginTop: 4 }}>
      <label style={{ fontSize: 10, color: 'var(--navi-text-secondary)', display: 'block', marginBottom: 2 }}>ROAD CONNECTION</label>
      {connectedRoad ? (
        <div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 8px', borderRadius: 4,
            background: '#0F2A1A', border: '1px solid #1A4A2A',
          }}>
            <span style={{ color: '#4ADE80', fontSize: 12 }}>✓</span>
            <span style={{ fontSize: 11, color: 'var(--navi-text)', flex: 1 }}>
              {connectedRoad.name || 'Unnamed Road'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            <button onClick={handleChange}
              style={{
                flex: 1, padding: '4px 0', borderRadius: 4, border: '1px solid var(--navi-border)',
                background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 10, cursor: 'pointer',
              }}
            >Change</button>
            <button onClick={handleDisconnect}
              style={{
                flex: 1, padding: '4px 0', borderRadius: 4, border: '1px solid #7F1D1D',
                background: '#7F1D1D', color: '#FCA5A5', fontSize: 10, cursor: 'pointer',
              }}
            >Disconnect</button>
          </div>
        </div>
      ) : (
        <div>
          {hasNoRoadWarning && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 8px', borderRadius: 4,
              background: '#2A1A0F', border: '1px solid #4A3A1A',
              marginBottom: 4,
            }}>
              <span style={{ color: '#FBBF24', fontSize: 12 }}>⚠</span>
              <span style={{ fontSize: 11, color: 'var(--navi-text)' }}>
                No explicit outdoor route assignment
              </span>
            </div>
          )}
          {topSuggestion ? (
            <div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 8px', borderRadius: 4,
                background: '#0F1A2A', border: '1px solid #1A3A5A',
                marginBottom: 4,
              }}>
                <span style={{ color: '#60A5FA', fontSize: 12 }}>💡</span>
                <span style={{ fontSize: 11, color: 'var(--navi-text)', flex: 1 }}>
                  {topSuggestion.targetName}
                </span>
                <span style={{ fontSize: 9, color: 'var(--navi-text-secondary)' }}>
                  {topSuggestion.distanceMeters.toFixed(1)}m
                </span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={() => onAcceptSuggestion(topSuggestion.targetId)}
                  style={{
                    flex: 1, padding: '4px 0', borderRadius: 4, border: '1px solid #1E40AF',
                    background: '#1E40AF', color: '#BFDBFE', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  }}
                >Accept</button>
                <button onClick={handleConnect}
                  style={{
                    flex: 1, padding: '4px 0', borderRadius: 4, border: '1px solid var(--navi-border)',
                    background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 10, cursor: 'pointer',
                  }}
                >Choose Another</button>
              </div>
            </div>
          ) : (
            <button onClick={handleConnect}
              style={{
                width: '100%', padding: '5px 0', borderRadius: 4, border: '1px solid #1E40AF',
                background: '#1E40AF', color: '#BFDBFE', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}
            >Connect...</button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

interface ComponentPropertiesProps {
  componentId: string | null
  onClose: () => void
  validationChecks?: ValidationCheck[]
  onOpenOutdoorRoutePicker?: (entranceId: string) => void
  onStartRouteConnect?: (doorId: string) => void
  onSelectComponent?: (id: string) => void
}

export function ComponentProperties({ componentId, onClose, validationChecks, onOpenOutdoorRoutePicker, onStartRouteConnect, onSelectComponent }: ComponentPropertiesProps) {
  const component = useFloorComponent(componentId)
  const { services, document } = useEditor()
  const documentVersion = useDocumentVersion()
  const graphNodes = useGraphStore((state) => state.graph.nodes)
  const dispatcher = services.get('dispatcher')!
  const editEngine = useEditingEngine()
  const { enterRelationshipSelection } = useInteraction()

  const [name, setName] = useState(component?.name ?? '')
  const [width, setWidth] = useState(component?.dimensions?.width ?? DEFAULT_ROOM_WIDTH)
  const [height, setHeight] = useState(component?.dimensions?.height ?? DEFAULT_ROOM_HEIGHT)
  const [doorRotationDegrees, setDoorRotationDegrees] = useState(((component?.metadata?.rotation as number | undefined) ?? 0) * 180 / Math.PI)
  const [doorType, setDoorType] = useState(metadataString(component?.metadata, 'doorType') || 'standard')
  const [doorRoomId, setDoorRoomId] = useState(metadataString(component?.metadata, 'roomId'))
  const [roomType, setRoomType] = useState(metadataString(component?.metadata, 'type', 'category'))
  const [roomCode, setRoomCode] = useState(metadataString(component?.metadata, 'code', 'number'))
  const [roomDescription, setRoomDescription] = useState(metadataString(component?.metadata, 'description'))
  const [searchable, setSearchable] = useState(component?.metadata?.searchable !== false)
  const [showSearchableHelp, setShowSearchableHelp] = useState(false)
  const [roomAccessNodeId, setRoomAccessNodeId] = useState('')
  const [roomAccessPrimary, setRoomAccessPrimary] = useState(true)
  const [entranceIndoorRouteNodeId, setEntranceIndoorRouteNodeId] = useState('')
  const [entranceOutdoorNodeId, setEntranceOutdoorNodeId] = useState('')
  const [rangeFrom, setRangeFrom] = useState(component?.range?.from ?? component?.floor ?? DEFAULT_FLOOR)
  const [rangeTo, setRangeTo] = useState(component?.range?.to ?? (component?.floor ?? DEFAULT_FLOOR) + 1)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  useEffect(() => {
    setName(component?.name ?? '')
    setWidth(component?.dimensions?.width ?? DEFAULT_ROOM_WIDTH)
    setHeight(component?.dimensions?.height ?? DEFAULT_ROOM_HEIGHT)
    setDoorRotationDegrees(((component?.metadata?.rotation as number | undefined) ?? 0) * 180 / Math.PI)
    setDoorType(metadataString(component?.metadata, 'doorType') || 'standard')
    setDoorRoomId(metadataString(component?.metadata, 'roomId'))
    setRoomType(metadataString(component?.metadata, 'type', 'category'))
    setRoomCode(metadataString(component?.metadata, 'code', 'number'))
    setRoomDescription(metadataString(component?.metadata, 'description'))
    setSearchable(component?.metadata?.searchable !== false)
    setShowSearchableHelp(false)
    setRoomAccessNodeId('')
    setRoomAccessPrimary(true)
    setEntranceIndoorRouteNodeId('')
    setEntranceOutdoorNodeId('')
    setRangeFrom(component?.range?.from ?? component?.floor ?? DEFAULT_FLOOR)
    setRangeTo(component?.range?.to ?? (component?.floor ?? DEFAULT_FLOOR) + 1)
  }, [component])

  // ── Entrance suggestion logic (all hooks at top level) ──

  const entranceEntity = useMemo(() => {
    if (!component || !isEntranceType(component.type)) return null
    return document.buildings
      .flatMap(b => b.floors)
      .flatMap(f => f.entrances)
      .find(e => e.id === component.id) ?? null
  }, [component, document])

  const connectedRoad = useMemo(() => {
    if (!entranceEntity?.connectorRoadId) return null
    return document.roads.find(r => r.id === entranceEntity.connectorRoadId) ?? null
  }, [entranceEntity, document])

  const suggestionService = useMemo(() => {
    if (!component || !isEntranceType(component.type) || connectedRoad) return null
    const spatial = new SpatialQueryService()
    // Load roads with multiple sample points along each polyline
    // so nearestRoad finds the actual closest segment, not just the centroid
    spatial.loadFromRoads(document.roads as never)
    const relationships = new RelationshipService(document)
    return new RelationshipSuggestionService(spatial, relationships)
  }, [connectedRoad, document, component])

  const suggestions: RelationshipSuggestion[] = useMemo(() => {
    if (!suggestionService || !entranceEntity) return []
    return suggestionService.suggestEntranceRoad(entranceEntity.id)
  }, [suggestionService, entranceEntity])

  const topSuggestion = useMemo(() => {
    return suggestions.find(s => !dismissed.has(s.targetId)) ?? null
  }, [suggestions, dismissed])

  const semanticIdentity = getSemanticRoomIdentity(component)

  const componentFloor = useMemo(() => {
    if (!component) return null
    const building = document.buildings.find((candidate) => candidate.id === component.buildingId)
    if (!building) return null
    const floorId = typeof component.metadata?.floorId === 'string' ? component.metadata.floorId : undefined
    return building.floors.find((floor) => floor.id === floorId || floor.level === component.floor) ?? null
  }, [component, document, documentVersion])

  const routeNodesForAccess = useMemo(() => {
    return componentFloor?.routeNetwork?.nodes.filter((node) => node.floor === componentFloor.level) ?? []
  }, [componentFloor])

  const doorEntity = useMemo(() => {
    if (!component || component.type !== 'door') return null
    return componentFloor?.doors?.find((door) => door.id === component.id) ?? null
  }, [component, componentFloor])

  const doorRoomOptions = useMemo(() => {
    const options = new Map<string, string>()
    for (const room of componentFloor?.rooms ?? []) options.set(room.id, room.name || room.number || room.id)
    for (const attributes of componentFloor?.roomAttributes ?? []) {
      const canonicalId = canonicalRoomId(attributes)
      options.set(canonicalId, attributes.name || attributes.code || attributes.number || canonicalId)
    }
    return [...options.entries()].map(([id, label]) => ({ id, label }))
  }, [componentFloor])

  const verticalLevelGeometry = useMemo(() => {
    if (!component || (component.type !== 'stair' && component.type !== 'elevator')) return null
    const building = document.buildings.find((candidate) => candidate.id === component.buildingId)
    const featureId = component.featureId ?? component.id
    const feature = component.type === 'stair'
      ? building?.staircases?.find((candidate) => candidate.id === featureId)
      : building?.elevators?.find((candidate) => candidate.id === featureId)
    return feature?.levels?.[component.floor] ?? null
  }, [component, document, documentVersion])

  const outdoorNodeOptions = useMemo(() => {
    return graphNodes.filter(isSelectableOutdoorRouteNode)
  }, [graphNodes])

  const semanticRoomAttributes = useMemo(() => {
    if (!component || !isSemanticRoomComponent(component) || !semanticIdentity) return null
    return componentFloor?.roomAttributes?.find((attributes) => attributes.faceId === semanticIdentity.faceId) ?? null
  }, [component, componentFloor])

  const roomAccessPoints = semanticRoomAttributes?.accessPoints ?? []
  const entranceAccess = useMemo(() => {
    if (!component || !isEntranceType(component.type)) return null
    return componentFloor?.entranceAccess?.find((access) => access.entranceId === component.id) ?? null
  }, [component, componentFloor])

  const connectedOutdoorRoutePoint = useMemo(() => {
    if (!entranceAccess) return null
    return outdoorNodeOptions.find((node) => node.id === entranceAccess.outdoorNodeId) ?? null
  }, [entranceAccess, outdoorNodeOptions])

  const connectedOutdoorRouteLabel = connectedOutdoorRoutePoint
    ? readableOutdoorRoutePoint(connectedOutdoorRoutePoint)
    : entranceAccess?.outdoorRouteId
      ? `Route ${entranceAccess.outdoorRouteId} junction`
      : readableOutdoorRoutePoint(undefined)
  const connectedIndoorRouteLabel = readableIndoorRoutePoint(routeNodesForAccess, entranceAccess?.indoorRouteNodeId)

  if (!component) return null

  const isSemanticRoom = isSemanticRoomComponent(component)
  const isRoom = component.type === 'room' && !isSemanticRoom
  const isDoor = component.type === 'door'
  const isStairOrElevator = component.type === 'stair' || component.type === 'elevator'
  const isRouteNode = component.type === 'route-node'
  const isRouteEdge = component.type === 'route-edge'
  const isRouteEntity = isRouteNode || isRouteEdge
  const routeLocalPosition = component.metadata?.localPosition as { x?: unknown; y?: unknown } | undefined
  const routeNodeType = typeof component.metadata?.nodeType === 'string' ? component.metadata.nodeType : 'waypoint'
  const routeEdgeType = typeof component.metadata?.edgeType === 'string' ? component.metadata.edgeType : 'walk'
  const routeFrom = typeof component.metadata?.from === 'string' ? component.metadata.from : '—'
  const routeTo = typeof component.metadata?.to === 'string' ? component.metadata.to : '—'
  const routeDistance = typeof component.metadata?.distance === 'number' ? component.metadata.distance : null
  const formatLocalPosition = () => {
    if (typeof routeLocalPosition?.x !== 'number' || typeof routeLocalPosition.y !== 'number') return '—'
    return `${routeLocalPosition.x.toFixed(1)}, ${routeLocalPosition.y.toFixed(1)}`
  }

  const handleAssignRoomAccess = () => {
    if (!semanticIdentity || !roomAccessNodeId) return
    dispatcher.execute({
      id: 'room.access.assign',
      label: 'Assign Room Access',
      payload: {
        ...semanticIdentity,
        routeNodeId: roomAccessNodeId,
        primary: roomAccessPrimary,
      },
    })
  }

  const handleRemoveRoomAccess = (access: { routeNodeId: string; openingId?: string }) => {
    if (!semanticIdentity) return
    dispatcher.execute({
      id: 'room.access.unassign',
      label: 'Remove Room Access',
      payload: {
        ...semanticIdentity,
        routeNodeId: access.routeNodeId,
        ...(access.openingId !== undefined ? { openingId: access.openingId } : {}),
      },
    })
  }

  const handleAssignEntranceAccess = () => {
    if (!componentFloor || !entranceEntity || !entranceIndoorRouteNodeId || !entranceOutdoorNodeId.trim()) return
    const selectedOutdoorNode = outdoorNodeOptions.find((node) => node.id === entranceOutdoorNodeId.trim())
    const outdoorRouteId = traceIdForOutdoorRouteNode(selectedOutdoorNode)
    dispatcher.execute({
      id: 'entrance.access.assign',
      label: 'Assign Entrance Route Access',
      payload: {
        buildingId: component.buildingId,
        floorId: componentFloor.id,
        entranceId: entranceEntity.id,
        outdoorNodeId: entranceOutdoorNodeId.trim(),
        indoorRouteNodeId: entranceIndoorRouteNodeId,
        ...(outdoorRouteId && selectedOutdoorNode ? { outdoorRouteId, outdoorPosition: selectedOutdoorNode.position } : {}),
      },
    })
  }

  const handleRemoveEntranceAccess = () => {
    if (!componentFloor || !entranceEntity) return
    dispatcher.execute({
      id: 'entrance.access.unassign',
      label: 'Remove Entrance Route Access',
      payload: {
        buildingId: component.buildingId,
        floorId: componentFloor.id,
        entranceId: entranceEntity.id,
      },
    })
  }

  const handleSave = () => {
    if (isRouteEntity) return
    if (isSemanticRoom) {
      if (!semanticIdentity) return
      dispatcher.execute({
        id: 'roomAttributes.update',
        label: 'Update Room Properties',
        payload: {
          ...semanticIdentity,
          changes: { name, type: roomType, code: roomCode, description: roomDescription, searchable },
        },
      })
      return
    }

    if (isDoor && doorEntity) {
      const rotation = doorRotationDegrees * Math.PI / 180
      dispatcher.execute({
        id: 'door.update',
        label: 'Update Door Properties',
        payload: {
          doorId: component.id,
          patch: {
            name,
            roomId: doorRoomId || undefined,
            width,
            depth: height,
            rotation,
            doorType,
            geometry: {
              type: 'rectangle',
              min: { x: doorEntity.position.x - width / 2, y: doorEntity.position.y - height / 2 },
              max: { x: doorEntity.position.x + width / 2, y: doorEntity.position.y + height / 2 },
              rotation,
            },
          },
        },
      })
      return
    }

    const changes: Record<string, unknown> = { name }
    if (isEntranceType(component.type)) {
      changes.label = name
    }
    editEngine.begin({ kind: 'rename', entityId: component.id, name })
    editEngine.doCommit()
    if (isRoom) {
      changes.dimensions = { width, height }
      editEngine.begin({ kind: 'assign', entityId: component.id, property: 'dimensions', value: changes.dimensions })
      editEngine.doCommit()
    }
    if (isStairOrElevator) {
      const featureId = component.featureId || (component.id.includes('-') ? component.id.split('-')[0] : component.id)
      changes.range = { from: rangeFrom, to: rangeTo }
      editEngine.begin({ kind: 'assign', entityId: component.id, property: 'range', value: changes.range })
      editEngine.doCommit()
      dispatcher.execute({
        id: 'feature.update',
        label: 'Update Feature Properties',
        payload: {
          featureId,
          level: component.floor,
          patch: {
            name,
            fromLevel: rangeFrom,
            toLevel: rangeTo,
            ...(verticalLevelGeometry ? (() => {
              const rotation = doorRotationDegrees * Math.PI / 180
              const center = verticalLevelGeometry.position
              const localCorners = [
                { x: -width / 2, y: -height / 2 }, { x: width / 2, y: -height / 2 },
                { x: width / 2, y: height / 2 }, { x: -width / 2, y: height / 2 },
              ]
              const cos = Math.cos(rotation)
              const sin = Math.sin(rotation)
              return {
                position: { ...center },
                rotation,
                polygon: { points: localCorners.map((point) => ({ x: center.x + point.x * cos - point.y * sin, y: center.y + point.x * sin + point.y * cos })) },
              }
            })() : {}),
          },
        },
      })
    } else {
      dispatcher.execute({
        id: 'entity.update',
        label: 'Update Properties',
        payload: { entityId: component.id, changes },
      })
    }
  }

  const handlePropertyKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleSave()
    }
  }

  const handleDelete = () => {
    if (semanticIdentity) {
      dispatcher.execute({ id: 'roomAttributes.unassign', label: 'Unassign Room', payload: { ...semanticIdentity } })
      onClose()
      return
    }

    if (isRouteNode) {
      dispatcher.execute({ id: 'route.node.delete', label: 'Delete Route Node', payload: { nodeId: component.id } })
      onClose()
      return
    }
    if (isRouteEdge) {
      dispatcher.execute({ id: 'route.edge.delete', label: 'Delete Route Edge', payload: { edgeId: component.id } })
      onClose()
      return
    }

    editEngine.begin({ kind: 'delete', entityIds: [component.id] })
    editEngine.doCommit()
    if (component.type === 'stair' || component.type === 'elevator') {
      const featureId = component.featureId || (component.id.includes('-') ? component.id.split('-')[0] : component.id)
      dispatcher.execute({
        id: 'feature.delete',
        label: `Delete ${component.type}`,
        payload: { featureId },
      })
    } else {
      const commandByType: Record<string, string> = { room: 'room.delete', hallway: 'hallway.delete', entrance: 'entrance.delete', restroom: 'room.delete', area: 'area.delete', door: 'door.delete' }
      const payloadByType: Record<string, string> = { room: 'roomId', hallway: 'hallwayId', entrance: 'entranceId', restroom: 'roomId', area: 'areaId', door: 'doorId' }
      const cmdId = commandByType[component.type]
      const payloadKey = payloadByType[component.type]
      if (cmdId && payloadKey) {
        dispatcher.execute({ id: cmdId, label: `Delete ${component.type}`, payload: { [payloadKey]: component.id } })
      }
    }
    onClose()
  }

  const handleDuplicateDoor = () => {
    if (!isDoor) return
    const result = dispatcher.execute({ id: 'door.duplicate', label: 'Duplicate Door', payload: { doorId: component.id } })
    if (result?.success && typeof result.entityId === 'string') onSelectComponent?.(result.entityId)
  }


  return (
    <div style={{ borderTop: '1px solid var(--navi-border)' }}>
      <div style={{ padding: '10px 12px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--navi-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
          Properties
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div>
            <label style={{ fontSize: 10, color: 'var(--navi-text-secondary)', display: 'block', marginBottom: 2 }}>NAME</label>
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={handlePropertyKeyDown}
              style={{
                width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--navi-border)',
                background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 11, outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: 10, color: 'var(--navi-text-secondary)', display: 'block', marginBottom: 2 }}>{isSemanticRoom ? 'ENTITY TYPE' : 'TYPE'}</label>
            <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: 'var(--navi-content)', color: 'var(--navi-text-secondary)', textTransform: 'uppercase' }}>
              {isSemanticRoom ? 'Room' : isRouteNode ? 'Route Node' : isRouteEdge ? 'Route Edge' : component.type}
            </span>
          </div>

          {isRouteNode && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 6px', borderRadius: 4, background: 'var(--navi-content)' }}>
              <div><label style={{ fontSize: 9, color: 'var(--navi-text-secondary)', display: 'block' }}>ID</label><span style={{ fontSize: 10, color: 'var(--navi-text)' }}>{component.id}</span></div>
              <div><label style={{ fontSize: 9, color: 'var(--navi-text-secondary)', display: 'block' }}>NODE TYPE</label><span style={{ fontSize: 10, color: 'var(--navi-text)' }}>{routeNodeType}</span></div>
              <div><label style={{ fontSize: 9, color: 'var(--navi-text-secondary)', display: 'block' }}>FLOOR</label><span style={{ fontSize: 10, color: 'var(--navi-text)' }}>{component.floor}</span></div>
              <div><label style={{ fontSize: 9, color: 'var(--navi-text-secondary)', display: 'block' }}>POSITION</label><span style={{ fontSize: 10, color: 'var(--navi-text)' }}>{formatLocalPosition()}</span></div>
            </div>
          )}

          {isRouteEdge && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 6px', borderRadius: 4, background: 'var(--navi-content)' }}>
              <div><label style={{ fontSize: 9, color: 'var(--navi-text-secondary)', display: 'block' }}>ID</label><span style={{ fontSize: 10, color: 'var(--navi-text)' }}>{component.id}</span></div>
              <div><label style={{ fontSize: 9, color: 'var(--navi-text-secondary)', display: 'block' }}>FROM → TO</label><span style={{ fontSize: 10, color: 'var(--navi-text)' }}>{routeFrom} → {routeTo}</span></div>
              <div><label style={{ fontSize: 9, color: 'var(--navi-text-secondary)', display: 'block' }}>EDGE TYPE</label><span style={{ fontSize: 10, color: 'var(--navi-text)' }}>{routeEdgeType}</span></div>
              <div><label style={{ fontSize: 9, color: 'var(--navi-text-secondary)', display: 'block' }}>DISTANCE</label><span style={{ fontSize: 10, color: 'var(--navi-text)' }}>{routeDistance == null ? '—' : `${routeDistance.toFixed(1)} m`}</span></div>
            </div>
          )}

          {isSemanticRoom && (
            <>
              <div>
                <label style={{ fontSize: 10, color: 'var(--navi-text-secondary)', display: 'block', marginBottom: 2 }}>ROOM TYPE</label>
                <input aria-label="Room type" list={`room-type-options-${component.id}`} value={roomType} onChange={(e) => setRoomType(e.target.value)} onKeyDown={handlePropertyKeyDown}
                  style={{
                    width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--navi-border)',
                    background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 11, outline: 'none', boxSizing: 'border-box',
                  }}
                />
                <datalist id={`room-type-options-${component.id}`}>
                  {ROOM_TYPE_OPTIONS.map((option) => <option key={option} value={option} />)}
                </datalist>
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--navi-text-secondary)', display: 'block', marginBottom: 2 }}>CODE</label>
                <input aria-label="Room code" value={roomCode} onChange={(e) => setRoomCode(e.target.value)} onKeyDown={handlePropertyKeyDown}
                  style={{
                    width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--navi-border)',
                    background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 11, outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--navi-text-secondary)', display: 'block', marginBottom: 2 }}>DESCRIPTION</label>
                <textarea aria-label="Room description" value={roomDescription} onChange={(e) => setRoomDescription(e.target.value)} rows={2}
                  style={{
                    width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--navi-border)',
                    background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 11, outline: 'none', boxSizing: 'border-box', resize: 'vertical',
                  }}
                />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--navi-text-secondary)', cursor: 'pointer' }}>
                    <input aria-label="Searchable" type="checkbox" checked={searchable} onChange={(e) => setSearchable(e.target.checked)} />
                    SEARCHABLE
                  </label>
                  <button
                    type="button"
                    aria-label="What does searchable mean?"
                    aria-expanded={showSearchableHelp}
                    aria-controls={`searchable-help-${component.id}`}
                    onClick={() => setShowSearchableHelp((visible) => !visible)}
                    title="What does searchable mean?"
                    style={{
                      width: 15, height: 15, padding: 0, borderRadius: '50%', border: '1px solid var(--navi-border)',
                      background: 'var(--navi-content)', color: 'var(--navi-text-secondary)', fontSize: 10, lineHeight: '13px', cursor: 'pointer',
                    }}
                  >?</button>
                </div>
                {showSearchableHelp && (
                  <div id={`searchable-help-${component.id}`} role="tooltip" style={{ marginTop: 4, padding: '5px 6px', borderRadius: 4, background: 'var(--navi-content)', color: 'var(--navi-text-secondary)', fontSize: 10, lineHeight: 1.35 }}>
                    {SEARCHABLE_HELP_TEXT}
                  </div>
                )}
              </div>
            </>
          )}

          {isSemanticRoom && semanticIdentity && (
            <div style={{ marginTop: 4, paddingTop: 6, borderTop: '1px solid var(--navi-border)' }}>
              <label style={{ fontSize: 10, color: 'var(--navi-text-secondary)', display: 'block', marginBottom: 2 }}>ROUTE ACCESS</label>
              <div style={{ fontSize: 10, color: 'var(--navi-text-secondary)', lineHeight: 1.35, marginBottom: 5 }}>
                Connect this Room to a navigation point. Room access is point-based in V1; it does not create room geometry.
              </div>
              {roomAccessPoints.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 5 }}>
                  {roomAccessPoints.map((access) => (
                    <div key={`${access.routeNodeId}-${access.openingId ?? 'point'}`} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 6px', borderRadius: 4, background: '#0F2A1A', border: '1px solid #1A4A2A' }}>
                      <span style={{ color: '#4ADE80', fontSize: 11 }}>●</span>
                      <span style={{ flex: 1, fontSize: 10, color: 'var(--navi-text)' }}>
                        {access.routeNodeId}{access.primary ? ' · primary' : ''}{access.openingId ? ` · opening ${access.openingId}` : ' · point'}
                      </span>
                      <button type="button" aria-label={`Remove route access ${access.routeNodeId}`} onClick={() => handleRemoveRoomAccess(access)}
                        style={{ padding: '2px 5px', borderRadius: 3, border: '1px solid #7F1D1D', background: '#7F1D1D', color: '#FCA5A5', fontSize: 9, cursor: 'pointer' }}
                      >Remove</button>
                    </div>
                  ))}
                </div>
              )}
              {routeNodesForAccess.length > 0 ? (
                <>
                  <select aria-label="Room access route node" value={roomAccessNodeId} onChange={(event) => setRoomAccessNodeId(event.target.value)}
                    style={{ width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--navi-border)', background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 11, outline: 'none', boxSizing: 'border-box' }}
                  >
                    <option value="">Choose a route node…</option>
                    {routeNodesForAccess.map((node) => <option key={node.id} value={node.id}>{node.id} · {node.type}</option>)}
                  </select>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--navi-text-secondary)', cursor: 'pointer', marginTop: 4 }}>
                    <input aria-label="Primary Room access" type="checkbox" checked={roomAccessPrimary} onChange={(event) => setRoomAccessPrimary(event.target.checked)} />
                    PRIMARY ACCESS
                  </label>
                  <button type="button" onClick={handleAssignRoomAccess} disabled={!roomAccessNodeId}
                    style={{ width: '100%', marginTop: 4, padding: '5px 0', borderRadius: 4, border: '1px solid #1E40AF', background: roomAccessNodeId ? '#1E40AF' : 'var(--navi-content)', color: roomAccessNodeId ? '#BFDBFE' : 'var(--navi-text-secondary)', fontSize: 10, fontWeight: 600, cursor: roomAccessNodeId ? 'pointer' : 'not-allowed' }}
                  >Assign Room Access</button>
                </>
              ) : (
                <div style={{ padding: '5px 6px', borderRadius: 4, background: 'var(--navi-content)', color: 'var(--navi-text-secondary)', fontSize: 10 }}>
                  Create a Route first, then choose its node here.
                </div>
              )}
            </div>
          )}

          {isRoom && (
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, color: 'var(--navi-text-secondary)', display: 'block', marginBottom: 2 }}>WIDTH</label>
                <input type="number" min={1} value={width} onChange={(e) => setWidth(Number(e.target.value))} onKeyDown={handlePropertyKeyDown}
                  style={{
                    width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--navi-border)',
                    background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 11, outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, color: 'var(--navi-text-secondary)', display: 'block', marginBottom: 2 }}>HEIGHT</label>
                <input type="number" min={1} value={height} onChange={(e) => setHeight(Number(e.target.value))} onKeyDown={handlePropertyKeyDown}
                  style={{
                    width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--navi-border)',
                    background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 11, outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
          )}

          {isDoor && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 4, borderTop: '1px solid var(--navi-border)' }}>
              <div>
                <label style={{ fontSize: 10, color: 'var(--navi-text-secondary)', display: 'block', marginBottom: 2 }}>PARENT ROOM</label>
                <select aria-label="Door parent room" value={doorRoomId} onChange={(event) => setDoorRoomId(event.target.value)}
                  style={{ width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--navi-border)', background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 11 }}>
                  <option value="">Unassigned</option>
                  {doorRoomOptions.map((room) => <option key={room.id} value={room.id}>{room.label}</option>)}
                </select>
                <div style={{ marginTop: 3, fontSize: 10, color: 'var(--navi-text-secondary)' }}>
                  {doorEntity?.ownership?.status === 'ambiguous' ? 'Ambiguous' : doorRoomId ? 'Assigned' : 'Unassigned'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, color: 'var(--navi-text-secondary)', display: 'block' }}>WIDTH</label>
                  <input aria-label="Door width" type="number" min={0.2} step={0.1} value={width} onChange={(event) => setWidth(Number(event.target.value))} onKeyDown={handlePropertyKeyDown}
                    style={{ width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--navi-border)', background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 11, boxSizing: 'border-box' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, color: 'var(--navi-text-secondary)', display: 'block' }}>DEPTH</label>
                  <input aria-label="Door depth" type="number" min={0.2} step={0.05} value={height} onChange={(event) => setHeight(Number(event.target.value))} onKeyDown={handlePropertyKeyDown}
                    style={{ width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--navi-border)', background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 11, boxSizing: 'border-box' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, color: 'var(--navi-text-secondary)', display: 'block' }}>ROTATION</label>
                  <input aria-label="Door rotation" type="number" step={1} value={Number(doorRotationDegrees.toFixed(3))} onChange={(event) => setDoorRotationDegrees(Number(event.target.value))} onKeyDown={handlePropertyKeyDown}
                    style={{ width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--navi-border)', background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 11, boxSizing: 'border-box' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, color: 'var(--navi-text-secondary)', display: 'block' }}>DOOR TYPE</label>
                  <select aria-label="Door type" value={doorType} onChange={(event) => setDoorType(event.target.value)}
                    style={{ width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--navi-border)', background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 11 }}>
                    {DOOR_TYPE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--navi-text-secondary)', display: 'block', marginBottom: 2 }}>ROUTE CONNECTION</label>
                {doorEntity?.routeConnection && (
                  <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 10, color: '#4ADE80' }}>Connected to {doorEntity.routeConnection.targetRouteNodeId}</span>
                    <button
                      type="button"
                      onClick={() => dispatcher.execute({ id: 'door.route.disconnect', label: 'Disconnect Door from Route', payload: { doorId: component.id } })}
                      style={{ marginBottom: 4, padding: '3px 6px', borderRadius: 4, border: '1px solid #7F1D1D', background: '#7F1D1D', color: '#FCA5A5', fontSize: 10, cursor: 'pointer' }}
                    >
                      Disconnect
                    </button>
                  </div>
                )}
                <button type="button" onClick={() => onStartRouteConnect?.(component.id)} disabled={!onStartRouteConnect}
                  style={{ width: '100%', padding: '5px 0', borderRadius: 4, border: '1px solid #1E40AF', background: onStartRouteConnect ? '#1E40AF' : 'var(--navi-content)', color: onStartRouteConnect ? '#BFDBFE' : 'var(--navi-text-secondary)', fontSize: 10, fontWeight: 600, cursor: onStartRouteConnect ? 'pointer' : 'not-allowed' }}>
                  Connect to Route…
                </button>
              </div>
              <button type="button" onClick={handleDuplicateDoor}
                style={{ width: '100%', padding: '5px 0', borderRadius: 4, border: '1px solid var(--navi-border)', background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
                Duplicate
              </button>
            </div>
          )}

          {isEntranceType(component.type) && (
            <div>
              <label style={{ fontSize: 10, color: 'var(--navi-text-secondary)', display: 'block', marginBottom: 2 }}>FLOOR</label>
              <span style={{ fontSize: 11, color: 'var(--navi-text)' }}>
                {component.floor === 0 ? 'GF' : component.floor > 0 ? `${component.floor}F` : `${component.floor}F`}
              </span>
            </div>
          )}

          {isEntranceType(component.type) && componentFloor && (
            <div style={{ marginTop: 4, paddingTop: 6, borderTop: '1px solid var(--navi-border)' }}>
              <label style={{ fontSize: 10, color: 'var(--navi-text-secondary)', display: 'block', marginBottom: 2 }}>INDOOR ROUTE ACCESS</label>
              <div style={{ fontSize: 10, color: 'var(--navi-text-secondary)', lineHeight: 1.35, marginBottom: 5 }}>
                Connect this Entrance to an indoor Route point and an outdoor navigation point.
              </div>
              {onOpenOutdoorRoutePicker && (
                <button
                  type="button"
                  onClick={() => onOpenOutdoorRoutePicker(component.id)}
                  style={{ width: '100%', marginBottom: 5, padding: '5px 0', borderRadius: 4, border: '1px solid #0E7490', background: '#164E63', color: '#A5F3FC', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
                >{entranceAccess ? 'Change outdoor route' : 'Connect to Outdoor Route'}</button>
              )}
              {entranceAccess ? (
                <div>
                  <div style={{ padding: '5px 6px', borderRadius: 4, background: '#0F2A1A', border: '1px solid #1A4A2A', fontSize: 10, color: 'var(--navi-text)' }}>
                    <div><span style={{ color: 'var(--navi-text-secondary)' }}>Indoor:</span> {connectedIndoorRouteLabel}</div>
                    <div><span style={{ color: 'var(--navi-text-secondary)' }}>Outdoor:</span> {connectedOutdoorRouteLabel}</div>
                  </div>
                  <button type="button" onClick={handleRemoveEntranceAccess}
                    style={{ width: '100%', marginTop: 4, padding: '4px 0', borderRadius: 4, border: '1px solid #7F1D1D', background: '#7F1D1D', color: '#FCA5A5', fontSize: 10, cursor: 'pointer' }}
                  >Remove Entrance Route Access</button>
                </div>
              ) : (
                <div style={{ padding: '5px 6px', borderRadius: 4, background: 'var(--navi-content)', color: 'var(--navi-text-secondary)', fontSize: 10 }}>
                  Choose an outdoor point above, then create the indoor Route from this Entrance.
                </div>
              )}
              {routeNodesForAccess.length > 0 && outdoorNodeOptions.length > 0 && (
                <details style={{ marginTop: 5 }}>
                  <summary style={{ color: 'var(--navi-text-secondary)', fontSize: 10, cursor: 'pointer' }}>Advanced route assignment</summary>
                  <div style={{ marginTop: 5 }}>
                    <select aria-label="Entrance indoor route node" value={entranceIndoorRouteNodeId} onChange={(event) => setEntranceIndoorRouteNodeId(event.target.value)}
                      style={{ width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--navi-border)', background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 11, outline: 'none', boxSizing: 'border-box' }}
                    >
                      <option value="">Choose an indoor route point…</option>
                      {routeNodesForAccess.map((node, index) => <option key={node.id} value={node.id}>Route point {index + 1} · {node.type}</option>)}
                    </select>
                    <select aria-label="Entrance outdoor route point" value={entranceOutdoorNodeId} onChange={(event) => setEntranceOutdoorNodeId(event.target.value)}
                      style={{ width: '100%', marginTop: 4, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--navi-border)', background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 11, outline: 'none', boxSizing: 'border-box' }}
                    >
                      <option value="">Choose an outdoor route point…</option>
                      {outdoorNodeOptions.map((node) => <option key={node.id} value={node.id}>{readableOutdoorRoutePoint(node)} · {node.type}</option>)}
                    </select>
                    <button type="button" onClick={handleAssignEntranceAccess} disabled={!entranceIndoorRouteNodeId || !entranceOutdoorNodeId.trim()}
                      style={{ width: '100%', marginTop: 4, padding: '5px 0', borderRadius: 4, border: '1px solid #1E40AF', background: entranceIndoorRouteNodeId && entranceOutdoorNodeId.trim() ? '#1E40AF' : 'var(--navi-content)', color: entranceIndoorRouteNodeId && entranceOutdoorNodeId.trim() ? '#BFDBFE' : 'var(--navi-text-secondary)', fontSize: 10, fontWeight: 600, cursor: entranceIndoorRouteNodeId && entranceOutdoorNodeId.trim() ? 'pointer' : 'not-allowed' }}
                    >Assign Entrance Route Access</button>
                  </div>
                </details>
              )}
            </div>
          )}

          {isEntranceType(component.type) && (
            <EntranceRoadSection
              component={component}
              connectedRoad={connectedRoad}
              hasNoRoadWarning={validationChecks?.some(c => c.entityId === component.id && (c.code === 'ENTRANCE_NO_ROAD' || c.code === 'ROUTE_ENTRANCE_ACCESS')) ?? false}
              topSuggestion={topSuggestion}
              dispatcher={dispatcher}
              enterRelationshipSelection={enterRelationshipSelection}
              onAcceptSuggestion={(roadId) => {
                dispatcher.execute({
                  id: 'entrance.connectRoad',
                  label: 'Connect Entrance to Road',
                  payload: { entranceId: component.id, roadId },
                })
              }}
            />
          )}

          {isStairOrElevator && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, color: 'var(--navi-text-secondary)', display: 'block' }}>WIDTH</label>
                  <input aria-label={`${component.type === 'stair' ? 'Stair' : 'Elevator'} width`} type="number" min={0.2} step={0.1} value={width} onChange={(event) => setWidth(Number(event.target.value))} onKeyDown={handlePropertyKeyDown}
                    style={{ width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--navi-border)', background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 11, boxSizing: 'border-box' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, color: 'var(--navi-text-secondary)', display: 'block' }}>DEPTH</label>
                  <input aria-label={`${component.type === 'stair' ? 'Stair' : 'Elevator'} depth`} type="number" min={0.2} step={0.1} value={height} onChange={(event) => setHeight(Number(event.target.value))} onKeyDown={handlePropertyKeyDown}
                    style={{ width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--navi-border)', background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 11, boxSizing: 'border-box' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, color: 'var(--navi-text-secondary)', display: 'block' }}>ROTATION</label>
                  <input aria-label={`${component.type === 'stair' ? 'Stair' : 'Elevator'} rotation`} type="number" step={1} value={Number(doorRotationDegrees.toFixed(3))} onChange={(event) => setDoorRotationDegrees(Number(event.target.value))} onKeyDown={handlePropertyKeyDown}
                    style={{ width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--navi-border)', background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 11, boxSizing: 'border-box' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, color: 'var(--navi-text-secondary)', display: 'block', marginBottom: 2 }}>FROM FLOOR</label>
                <input type="number" value={rangeFrom} onChange={(e) => setRangeFrom(Number(e.target.value))} onKeyDown={handlePropertyKeyDown}
                  style={{
                    width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--navi-border)',
                    background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 11, outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10, color: 'var(--navi-text-secondary)', display: 'block', marginBottom: 2 }}>TO FLOOR</label>
                <input type="number" value={rangeTo} onChange={(e) => setRangeTo(Number(e.target.value))} onKeyDown={handlePropertyKeyDown}
                  style={{
                    width: '100%', padding: '4px 6px', borderRadius: 4, border: '1px solid var(--navi-border)',
                    background: 'var(--navi-content)', color: 'var(--navi-text)', fontSize: 11, outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
            <button onClick={handleSave}
              style={{
                flex: 1, padding: '5px 0', borderRadius: 4, border: 'none',
                background: 'var(--navi-primary)', color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}
            >Save</button>
            <button onClick={handleDelete}
              style={{
                padding: '5px 10px', borderRadius: 4, border: 'none',
                background: '#DC2625', color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}
            >{isSemanticRoom ? 'Delete Room' : 'Delete'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
