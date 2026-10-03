import { useSyncExternalStore } from 'react'
import { useEditor } from './editor-context'
import type { DocumentStore } from './document-store'

export function useDocumentVersion(): number {
  const { services } = useEditor()
  const store = services.get('documentStore')
  if (!store) return 0
  return useSyncExternalStore(store.subscribe, store.getVersion)
}
