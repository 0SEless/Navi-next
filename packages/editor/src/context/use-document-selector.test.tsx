import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { CampusDocument } from '@navi/core'
import { DocumentStore } from './document-store'
import { EditorProvider } from './editor-context'
import { ServiceRegistry } from './service-registry'
import { useDocumentSelector } from './use-document-selector'

function createDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [{
      id: 'bld-1', name: 'Before', code: 'B', category: 'academic', description: '',
      footprint: { points: [] }, baseElevation: 0, height: 10, color: '#000', aliases: [],
      floors: [], verticalConnectors: [], metadata: {},
    }],
    roads: [], panoramas: [], qrCheckpoints: [],
  }
}

const selectBuildingName = (doc: CampusDocument) => doc.buildings[0]?.name ?? ''

describe('useDocumentSelector', () => {
  it('recomputes after an in-place DocumentStore commit', () => {
    const document = createDoc()
    const documentStore = new DocumentStore(document)
    const services = new ServiceRegistry()
    services.register('documentStore', documentStore)
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <EditorProvider context={{ document, services }}>{children}</EditorProvider>
    )

    const { result } = renderHook(() => useDocumentSelector(selectBuildingName), { wrapper })
    expect(result.current).toBe('Before')

    act(() => {
      document.buildings[0].name = 'After'
      documentStore.commit()
    })

    expect(result.current).toBe('After')
  })
})
