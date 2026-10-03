import { useEditor, useDocumentVersion, useSelection } from '../../context'
import { BuildingProperties } from './building-props'
import { FloorProperties } from './floor-props'
import { RoomProperties } from './room-props'
import { HallwayProperties } from './hallway-props'
import { RoadProperties } from './road-props'
import { EntranceProperties } from './entrance-props'
import { StaircaseProperties } from './staircase-props'
import { ElevatorProperties } from './elevator-props'
import { PanoramaProperties } from './panorama-props'
import { QRProperties } from './qr-props'
import { AreaProperties } from './area-props'
import { POIProperties } from './poi-props'
import { findEntityById } from './property-utils'
import { tokens, EntityBadge, Field, SectionHeader, valueTextStyle } from './field'

const ENTITY_LABELS: Record<string, string> = {
  building: 'Building', floor: 'Floor', room: 'Room',
  hallway: 'Hallway', road: 'Road', entrance: 'Entrance',
  staircase: 'Staircase', elevator: 'Elevator',
  'route-node': 'Route Node', 'route-edge': 'Route Edge',
  panorama: 'Panorama', qr: 'QR Checkpoint', area: 'Area', poi: 'POI',
}

function RouteGraphProperties({ entity, path }: { entity: Record<string, any>; path: 'route-node' | 'route-edge' }) {
  const isNode = path === 'route-node'
  return (
    <div style={{ padding: '0 12px 12px' }}>
      <SectionHeader>Route Network</SectionHeader>
      <Field label={isNode ? 'Node Type' : 'Edge Type'}>
        <div style={valueTextStyle}>{entity.type ?? '—'}</div>
      </Field>
      {isNode ? (
        <>
          <Field label="Floor"><div style={valueTextStyle}>{entity.floor ?? '—'}</div></Field>
          <Field label="Position">
            <div style={valueTextStyle}>
              {typeof entity.position?.x === 'number' && typeof entity.position?.y === 'number'
                ? `${entity.position.x.toFixed(2)}, ${entity.position.y.toFixed(2)} m`
                : '—'}
            </div>
          </Field>
        </>
      ) : (
        <>
          <Field label="From → To"><div style={valueTextStyle}>{entity.from ?? '—'} → {entity.to ?? '—'}</div></Field>
          <Field label="Distance"><div style={valueTextStyle}>{typeof entity.distance === 'number' ? `${entity.distance.toFixed(2)} m` : '—'}</div></Field>
        </>
      )}
    </div>
  )
}

export function PropertiesPanel() {
  const { document } = useEditor()
  const selection = useSelection()
  useDocumentVersion()
  const selectedId = selection.lastSelected?.id ?? null

  if (!selectedId) {
    return null
  }

  const found = findEntityById(document, selectedId)
  if (!found) {
    return (
      <div style={{
        padding: 16, fontSize: 13, fontFamily: 'system-ui, sans-serif',
        color: tokens.danger, background: tokens.bg,
      }}>
        Entity not found: {selectedId}
      </div>
    )
  }

  const entityLabel = ENTITY_LABELS[found.path] ?? found.path

  const panelStyle: React.CSSProperties = {
    background: tokens.bg,
    fontFamily: 'system-ui, sans-serif',
    fontSize: tokens.fontSize.md,
    color: tokens.textPrimary,
  }

  const renderContent = () => {
    switch (found.path) {
      case 'building': return <BuildingProperties building={found.entity as any} />
      case 'floor': return <FloorProperties floor={found.entity as any} />
      case 'room': return <RoomProperties room={found.entity as any} />
      case 'hallway': return <HallwayProperties hallway={found.entity as any} />
      case 'road': return <RoadProperties road={found.entity as any} />
      case 'entrance': return <EntranceProperties entrance={found.entity as any} />
      case 'staircase': return <StaircaseProperties staircase={found.entity as any} />
      case 'elevator': return <ElevatorProperties elevator={found.entity as any} />
      case 'route-node': return <RouteGraphProperties entity={found.entity} path="route-node" />
      case 'route-edge': return <RouteGraphProperties entity={found.entity} path="route-edge" />
      case 'panorama': return <PanoramaProperties panorama={found.entity as any} />
      case 'qr': return <QRProperties qr={found.entity as any} />
      case 'area': return <AreaProperties area={found.entity as any} />
      case 'poi': return <POIProperties poi={found.entity as any} />
      default: return (
        <div style={{ padding: 12, color: tokens.textMuted, fontSize: tokens.fontSize.base }}>
          Unknown entity type
        </div>
      )
    }
  }

  return (
    <div style={panelStyle}>
      <div style={{ padding: '10px 12px 0' }}>
        <EntityBadge label={entityLabel} entityId={selectedId} />
      </div>
      {renderContent()}
    </div>
  )
}
