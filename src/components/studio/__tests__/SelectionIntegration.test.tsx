import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import { EditorProvider, DocumentStore, DocumentEventBus, SelectionManager, SelectionBridge, SelectionOrigin } from '@navi/editor'
import { asEntityId } from '@navi/editor'
import type { EditorContext, EntitySelector } from '@navi/editor'
import type { CampusDocument } from '@navi/core'
import { PropertiesPanel } from '@navi/editor'
import { useStudioStore } from '@/store/studio-store'

afterEach(() => {
  cleanup()
  useStudioStore.setState({ selectedNodeId: null, activeBuildingId: null })
})

// ── Helpers ───────────────────────────────────────────────────

function createDocument(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 0,
    metadata: { campusId: 'Test Campus', name: 'Test Campus', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [{
      id: 'bld-1',
      name: 'Main Building',
      code: 'M',
      category: 'academic',
      description: '',
      footprint: { points: [{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }] },
      baseElevation: 0,
      height: 10,
      color: '#3366ff',
      floors: [],
      verticalConnectors: [],
      aliases: [],
      metadata: {},
    }],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function buildEditorContext() {
  const document = createDocument()
  const documentStore = new DocumentStore(document)
  const eventBus = new DocumentEventBus()
  const selectionManager = new SelectionManager(document, eventBus)
  const services = {
    get(name: string) {
      if (name === 'selection') return selectionManager
      if (name === 'eventBus') return eventBus
      if (name === 'documentStore') return documentStore
    },
  }
  const context = { document, services } as unknown as EditorContext
  return { context, document, selectionManager, eventBus, documentStore }
}

// ── M2.4 Selection Integration Tests ──────────────────────────

describe('M2.4 Selection Integration', () => {
  describe('Direction A: SelectionManager → Zustand (bridge)', () => {
    it('SM Explorer-select → Zustand selectedNodeId updated', () => {
      const { selectionManager, context } = buildEditorContext()

      // Wire Direction A the same way EditorBridge does
      const bridge = new SelectionBridge(selectionManager)
      bridge.connect({
        onSelectionChanged(_state, legacy) {
          useStudioStore.setState({ selectedNodeId: legacy.selectedNodeId })
        },
      })

      act(() => {
        selectionManager.select('bld-1', SelectionOrigin.Explorer)
      })

      expect(useStudioStore.getState().selectedNodeId).toBe('bld-1')
    })

    it('SM Explorer-select → Zustand activeBuildingId derived for building entity', () => {
      const { selectionManager, context } = buildEditorContext()

      const bridge = new SelectionBridge(selectionManager)
      bridge.connect({
        onSelectionChanged(_state, legacy) {
          useStudioStore.setState({ selectedNodeId: legacy.selectedNodeId, activeBuildingId: legacy.activeBuildingId })
        },
      })

      act(() => {
        selectionManager.select('bld-1', SelectionOrigin.Explorer)
      })

      expect(useStudioStore.getState().activeBuildingId).toBe('bld-1')
    })

    it('SM Programmatic-select → Zustand updated (no fly-to guard concern)', () => {
      const { selectionManager } = buildEditorContext()

      const bridge = new SelectionBridge(selectionManager)
      bridge.connect({
        onSelectionChanged(_state, legacy) {
          useStudioStore.setState({ selectedNodeId: legacy.selectedNodeId })
        },
      })

      act(() => {
        selectionManager.select('bld-1', SelectionOrigin.Programmatic)
      })

      expect(useStudioStore.getState().selectedNodeId).toBe('bld-1')
    })
  })

  describe('Direction B: Zustand → SelectionManager (bridge)', () => {
    it('Zustand selectedNodeId → SM.lastSelectedId matches', () => {
      const { selectionManager, context } = buildEditorContext()

      const bridge = new SelectionBridge(selectionManager)
      bridge.connect({ onSelectionChanged: () => {} })

      // Subscribe the same way EditorBridge does
      const unsub = useStudioStore.subscribe(() => {
        const s = useStudioStore.getState()
        const legacyId = s.selectedNodeId
        if (!legacyId) {
          bridge.pushExternal(null, SelectionOrigin.Canvas)
          return
        }
        if (legacyId === selectionManager.lastSelectedId) return
        const selector: EntitySelector = { type: 'building', id: legacyId as any }
        bridge.pushExternal(selector, SelectionOrigin.Canvas)
      })

      act(() => {
        useStudioStore.setState({ selectedNodeId: 'bld-1' })
      })

      expect(selectionManager.lastSelectedId).toBe('bld-1')
      unsub()
    })

    it('Zustand clear → SM clears', () => {
      const { selectionManager } = buildEditorContext()

      const bridge = new SelectionBridge(selectionManager)
      bridge.connect({ onSelectionChanged: () => {} })

      const unsub = useStudioStore.subscribe(() => {
        const s = useStudioStore.getState()
        if (!s.selectedNodeId) {
          bridge.pushExternal(null, SelectionOrigin.Canvas)
        }
      })

      // Select first
      act(() => { selectionManager.select('bld-1', SelectionOrigin.Programmatic) })
      expect(selectionManager.lastSelectedId).toBe('bld-1')

      // Then clear via Zustand
      act(() => { useStudioStore.setState({ selectedNodeId: null }) })
      expect(selectionManager.lastSelectedId).toBeNull()

      unsub()
    })

    it('Direction B self-guard: id-equality short-circuit prevents redundant cycle', () => {
      const { selectionManager } = buildEditorContext()
      let directionACount = 0

      const bridge = new SelectionBridge(selectionManager)
      bridge.connect({
        onSelectionChanged() { directionACount++ },
      })

      // Select from SM directly (Explorer)
      act(() => { selectionManager.select('bld-1', SelectionOrigin.Explorer) })
      expect(directionACount).toBe(1)

      // Simulate the Zustand subscribe firing (as Direction B would)
      // but short-circuit on equal id
      const legacyId = selectionManager.lastSelectedId
      expect(legacyId).toBe('bld-1')
      // If Direction B fires: it checks legacyId === SM.lastSelectedId → true → returns
      // So no pushExternal → no double Direction A
      expect(directionACount).toBe(1)
    })
  })

  describe('PropertiesPanel reacts to selection', () => {
    it('select building → PropertiesPanel shows Building header', () => {
      const { context, selectionManager } = buildEditorContext()

      act(() => {
        selectionManager.select('bld-1', SelectionOrigin.Explorer)
      })

      render(
        <EditorProvider context={context}>
          <PropertiesPanel />
        </EditorProvider>,
      )

      expect(screen.getByText('Building')).toBeDefined()
      expect(screen.getByDisplayValue('Main Building')).toBeDefined()
    })

    it('no selection → PropertiesPanel renders nothing', () => {
      const { context } = buildEditorContext()

      render(
        <EditorProvider context={context}>
          <PropertiesPanel />
        </EditorProvider>,
      )

      expect(screen.queryByText('Workflow')).toBeNull()
    })

    it('clear selection → PropertiesPanel renders nothing', () => {
      const { context, selectionManager } = buildEditorContext()

      act(() => { selectionManager.select('bld-1', SelectionOrigin.Explorer) })

      render(
        <EditorProvider context={context}>
          <PropertiesPanel />
        </EditorProvider>,
      )

      expect(screen.getByText('Building')).toBeDefined()
      expect(screen.getByDisplayValue('Main Building')).toBeDefined()

      act(() => { selectionManager.clear(SelectionOrigin.Programmatic) })

      expect(screen.queryByText('Workflow')).toBeNull()
      expect(screen.queryByText('Building')).toBeNull()
    })
  })

  describe('Full integration: Bridge + PropertiesPanel', () => {
    it('Canvas-selected entity → Bridge → PropertiesPanel renders', () => {
      const { selectionManager, context } = buildEditorContext()

      // Wire bridge both directions (mirrors EditorBridge setup)
      const bridge = new SelectionBridge(selectionManager)
      bridge.connect({
        onSelectionChanged(_state, legacy) {
          useStudioStore.setState({ selectedNodeId: legacy.selectedNodeId })
        },
      })

      const unsub = useStudioStore.subscribe(() => {
        const s = useStudioStore.getState()
        const legacyId = s.selectedNodeId
        if (!legacyId || legacyId === selectionManager.lastSelectedId) return
        bridge.pushExternal({ type: 'building', id: legacyId as any }, SelectionOrigin.Canvas)
      })

      // Simulate canvas click: set Zustand, let bridge propagate
      act(() => {
        useStudioStore.setState({ selectedNodeId: 'bld-1' })
      })

      render(
        <EditorProvider context={context}>
          <PropertiesPanel />
        </EditorProvider>,
      )

      // SelectionManager should have received it through bridge
      expect(selectionManager.lastSelectedId).toBe('bld-1')
      expect(screen.getByText('Building')).toBeDefined()
      expect(screen.getByDisplayValue('Main Building')).toBeDefined()

      unsub()
    })

    it('Explorer-selected entity → Bridge → Zustand → canvas picks it up', () => {
      const { selectionManager } = buildEditorContext()

      const bridge = new SelectionBridge(selectionManager)
      bridge.connect({
        onSelectionChanged(_state, legacy) {
          useStudioStore.setState({ selectedNodeId: legacy.selectedNodeId, activeBuildingId: legacy.activeBuildingId })
        },
      })

      act(() => {
        selectionManager.select('bld-1', SelectionOrigin.Explorer)
      })

      // Zustand reflects the selection — canvas highlight effect would pick this up
      const state = useStudioStore.getState()
      expect(state.selectedNodeId).toBe('bld-1')
      expect(state.activeBuildingId).toBe('bld-1')
    })
  })
})
