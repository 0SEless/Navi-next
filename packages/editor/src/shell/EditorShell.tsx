import type { ReactNode } from 'react'
import { MenuBar } from './MenuBar'
import { StatusBar } from './StatusBar'

interface EditorShellProps {
  menuBar?: ReactNode
  statusBar?: ReactNode
  canvas: ReactNode
  leftPanel?: ReactNode
  rightPanel?: ReactNode
  bottomPanel?: ReactNode
}

export function EditorShell({
  canvas,
  leftPanel,
  rightPanel,
  bottomPanel,
  menuBar,
  statusBar,
}: EditorShellProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      background: '#252526',
      color: '#ccc',
    }}>
      {menuBar ?? <MenuBar />}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {leftPanel && (
          <div style={{
            width: 240,
            borderRight: '1px solid #333',
            overflow: 'auto',
            background: '#1e1e1e',
          }}>
            {leftPanel}
          </div>
        )}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {canvas}
        </div>
        {rightPanel && (
          <div style={{
            width: 280,
            borderLeft: '1px solid #333',
            overflow: 'auto',
            background: '#1e1e1e',
          }}>
            {rightPanel}
          </div>
        )}
      </div>
      {bottomPanel && (
        <div style={{
          height: 200,
          borderTop: '1px solid #333',
          overflow: 'auto',
          background: '#1e1e1e',
        }}>
          {bottomPanel}
        </div>
      )}
      {statusBar ?? <StatusBar />}
    </div>
  )
}
