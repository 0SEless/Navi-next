import { createContext, useContext } from 'react'
import type { CampusDocument, CoordinateTransformer } from '@navi/core'
import { ServiceRegistry } from './service-registry'

export interface EditorContext {
  document: CampusDocument
  services: ServiceRegistry
  transformer?: CoordinateTransformer
}

export const serviceNames = {
  dispatcher: 'dispatcher',
  history: 'history',
  selection: 'selection',
  toolRegistry: 'toolRegistry',
  validationEngine: 'validationEngine',
  eventBus: 'eventBus',
  viewport: 'viewport',
  editingContext: 'editingContext',
} as const

const EditorReactContext = createContext<EditorContext | null>(null)

export function EditorProvider({ children, context }: { children: React.ReactNode; context: EditorContext }) {
  if (typeof window !== 'undefined') {
    (window as any).__naviContext = context
    const history = context.services.get('history')
    if (history) {
      (window as any).__naviHistory = history
    }
  }
  return (
    <EditorReactContext.Provider value={context}>
      {children}
    </EditorReactContext.Provider>
  )
}

export function useEditor(): EditorContext {
  const ctx = useContext(EditorReactContext)
  if (!ctx) {
    throw new Error('useEditor must be used within an EditorProvider')
  }
  return ctx
}
