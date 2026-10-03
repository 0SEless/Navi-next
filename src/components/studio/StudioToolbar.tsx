'use client'

import { useState, useEffect } from 'react'
import { useEditor } from '@navi/editor'
import type { EditorMode } from '@navi/editor'
import { Tour360Preview } from '@navi/editor'
import { useStudioStore } from '@/store/studio-store'

const MODES: EditorMode[] = ['campus', 'building', 'floor', '360-tour']

export function StudioToolbar() {
  const { services } = useEditor()
  const editingContext = services.get('editingContext')
  const mode = editingContext?.mode ?? 'campus'
  const setEditorMode = useStudioStore((s) => s.setEditorMode)
  const [showPreview, setShowPreview] = useState(false)

  // Bridge: sync editingContext.mode → useStudioStore.editorMode
  useEffect(() => {
    if (!editingContext) return
    const unsubscribe = services.get('eventBus')?.on('editingcontext.changed', (payload: any) => {
      if (payload?.mode) {
        setEditorMode(payload.mode)
      }
    })
    // Initial sync
    setEditorMode(editingContext.mode)
    return () => unsubscribe?.()
  }, [editingContext, services, setEditorMode])

  return (
    <>
      <div style={{
        background: 'var(--navi-card)', borderBottom: '1px solid var(--navi-border)',
        padding: '4px 14px', display: 'flex', alignItems: 'center',
        gap: 2, flexShrink: 0,
      }}>
        {MODES.map((m) => (
          <button key={m} onClick={() => editingContext?.setMode(m)}
            style={{
              padding: '3px 10px', borderRadius: 4, border: 'none',
              background: mode === m ? 'var(--navi-primary)' : 'transparent',
              color: mode === m ? 'white' : 'var(--navi-text-secondary)',
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}
          >{m === 'campus' ? 'Campus' : m === 'building' ? 'Building' : m === 'floor' ? 'Floor' : '360 Tour'}</button>
        ))}
        
        {mode === '360-tour' && (
          <button
            onClick={() => setShowPreview(true)}
            style={{
              marginLeft: 8,
              padding: '3px 10px', borderRadius: 4, border: '1px solid #10b981',
              background: '#10b981', color: 'white',
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}
          >Preview Tour</button>
        )}
      </div>

      <Tour360Preview
        isOpen={showPreview}
        onClose={() => setShowPreview(false)}
      />
    </>
  )
}
