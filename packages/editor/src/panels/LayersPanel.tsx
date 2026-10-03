import type { CampusDocument } from '@navi/core'

interface LayersPanelProps {
  document: CampusDocument
  activeBuildingId: string | null
  activeFloorId: string | null
  onSelectBuilding?: (id: string | null) => void
  onSelectFloor?: (id: string | null) => void
  onSelectRoom?: (id: string | null) => void
}

export function LayersPanel({
  document,
  activeBuildingId,
  activeFloorId,
  onSelectBuilding,
  onSelectFloor,
  onSelectRoom,
}: LayersPanelProps) {
  return (
    <div style={{ padding: 8, fontSize: 13, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ fontWeight: 600, marginBottom: 8, color: '#fff', textTransform: 'uppercase', fontSize: 11, letterSpacing: 1 }}>Layers</div>
      {document.buildings.length === 0 && (
        <div style={{ color: '#666', fontStyle: 'italic' }}>No buildings</div>
      )}
      {document.buildings.map((bld) => (
        <div key={bld.id} style={{ marginBottom: 4 }}>
          <div
            onClick={() => onSelectBuilding?.(bld.id === activeBuildingId ? null : bld.id)}
            style={{
              cursor: 'pointer',
              padding: '3px 6px',
              borderRadius: 3,
              background: bld.id === activeBuildingId ? '#094771' : 'transparent',
              color: bld.id === activeBuildingId ? '#fff' : '#ccc',
            }}
          >
            {bld.name || bld.id}
          </div>
          {bld.id === activeBuildingId && bld.floors.map((flr) => (
            <div key={flr.id} style={{ paddingLeft: 16, marginTop: 2 }}>
              <div
                onClick={() => onSelectFloor?.(flr.id === activeFloorId ? null : flr.id)}
                style={{
                  cursor: 'pointer',
                  padding: '2px 6px',
                  borderRadius: 3,
                  background: flr.id === activeFloorId ? '#094771' : 'transparent',
                  color: flr.id === activeFloorId ? '#fff' : '#999',
                }}
              >
                {flr.label || `Floor ${flr.level}`}
              </div>
              {flr.id === activeFloorId && flr.rooms.map((rm) => (
                <div
                  key={rm.id}
                  onClick={() => onSelectRoom?.(rm.id)}
                  style={{
                    cursor: 'pointer',
                    padding: '2px 6px',
                    paddingLeft: 32,
                    borderRadius: 3,
                    color: '#888',
                    fontSize: 12,
                  }}
                >
                  {rm.name || rm.number || rm.id}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
