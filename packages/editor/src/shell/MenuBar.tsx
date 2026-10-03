interface MenuBarProps {
  dirty?: boolean
}

export function MenuBar({ dirty }: MenuBarProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '0 8px',
      height: 32,
      background: '#1e1e1e',
      borderBottom: '1px solid #333',
      color: '#ccc',
      fontSize: 13,
      fontFamily: 'system-ui, sans-serif',
    }}>
      <span style={{ fontWeight: 600, color: '#fff', marginRight: 12 }}>NAVI</span>
      {dirty && <span style={{ color: '#e8a838', fontSize: 11 }}>●</span>}
    </div>
  )
}
