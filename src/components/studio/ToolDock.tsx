'use client'

import { Undo2, Redo2 } from 'lucide-react'
import { useEditor, useDocumentVersion, ToolDock as EditorToolDock, CAMPUS_TOOL_GROUPS, TOUR_360_TOOL_GROUPS } from '@navi/editor'
import { useCurrentTool } from './useCurrentTool'
import { useStudioStore } from '@/store/studio-store'

export function ToolDock() {
  const { services } = useEditor()
  // HistoryStack is an imperative service. Subscribe to document commits so
  // Undo/Redo disabled state reflects the stack after toolbar clicks.
  useDocumentVersion()
  const toolRegistry = services.get('toolRegistry')
  const history = services.get('history')
  const activeToolId = useCurrentTool()
  const editorMode = useStudioStore((s) => s.editorMode)
  const showNavigationOnlyRoutes = useStudioStore((s) => s.layers.navigation_only_routes ?? false)
  const showHiddenPois = useStudioStore((s) => s.layers.hidden_pois ?? false)
  const toggleLayer = useStudioStore((s) => s.toggleLayer)

  const toolGroups = editorMode === '360-tour' ? TOUR_360_TOOL_GROUPS : CAMPUS_TOOL_GROUPS

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2,
      padding: '6px 14px',
      background: 'var(--navi-card)',
      borderTop: '1px solid var(--navi-border)',
      flexShrink: 0,
    }}>
      <EditorToolDock groups={toolGroups} activeTool={activeToolId ?? ''} onActivateTool={(id) => toolRegistry?.activate(id)} />

      <label title="Reveal routes marked navigation-only for Studio inspection" style={{
        display: 'flex', alignItems: 'center', gap: 5, marginLeft: 8,
        color: 'var(--navi-text-secondary)', fontSize: 11, whiteSpace: 'nowrap', cursor: 'pointer',
      }}>
        <input
          type="checkbox"
          checked={showNavigationOnlyRoutes}
          onChange={() => toggleLayer('navigation_only_routes')}
          aria-label="Show navigation-only routes"
          style={{ accentColor: 'var(--navi-primary)', cursor: 'pointer' }}
        />
        Show hidden routes
      </label>

      <label title="Reveal POIs authored with 'Show on map' off for Studio editing" style={{
        display: 'flex', alignItems: 'center', gap: 5, marginLeft: 8,
        color: 'var(--navi-text-secondary)', fontSize: 11, whiteSpace: 'nowrap', cursor: 'pointer',
      }}>
        <input
          type="checkbox"
          checked={showHiddenPois}
          onChange={() => toggleLayer('hidden_pois')}
          aria-label="Show hidden POIs"
          style={{ accentColor: 'var(--navi-primary)', cursor: 'pointer' }}
        />
        Show hidden POIs
      </label>

      <div style={{ width: 1, height: 20, background: 'var(--navi-border)', margin: '0 6px' }} />

      <button onClick={() => history?.undo()} disabled={!history?.canUndo} title="Undo"
        style={{
          padding: '5px 8px', borderRadius: 6, border: 'none',
          background: 'transparent', color: history?.canUndo ? 'var(--navi-text-secondary)' : 'var(--navi-border)',
          cursor: history?.canUndo ? 'pointer' : 'not-allowed', fontSize: 11,
        }}
      ><Undo2 size={14} /></button>
      <button onClick={() => history?.redo()} disabled={!history?.canRedo} title="Redo"
        style={{
          padding: '5px 8px', borderRadius: 6, border: 'none',
          background: 'transparent', color: history?.canRedo ? 'var(--navi-text-secondary)' : 'var(--navi-border)',
          cursor: history?.canRedo ? 'pointer' : 'not-allowed', fontSize: 11,
        }}
      ><Redo2 size={14} /></button>
    </div>
  )
}
