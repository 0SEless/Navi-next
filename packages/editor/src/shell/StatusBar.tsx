interface StatusBarProps {
  activeTool?: string
  selectionCount?: number
  buildingCount?: number
  problemCount?: number
  zoom?: number
}

export function StatusBar({ activeTool, selectionCount, buildingCount, problemCount, zoom }: StatusBarProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      padding: '0 12px',
      height: 24,
      background: '#0078d4',
      color: '#fff',
      fontSize: 12,
      fontFamily: 'system-ui, sans-serif',
    }}>
      {activeTool && <span>{activeTool}</span>}
      {selectionCount !== undefined && <span>{selectionCount} selected</span>}
      {buildingCount !== undefined && <span>{buildingCount} buildings</span>}
      {problemCount !== undefined && problemCount > 0 && <span>{problemCount} problems</span>}
      {zoom !== undefined && <span style={{ marginLeft: 'auto' }}>Zoom: {zoom.toFixed(1)}</span>}
    </div>
  )
}
