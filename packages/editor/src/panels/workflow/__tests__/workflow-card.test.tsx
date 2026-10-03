import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EditorProvider } from '../../../context'
import type { EditorContext } from '../../../context'
import type { CampusDocument } from '@navi/core'
import { DocumentEventBus } from '../../../eventbus'
import { WorkflowCard } from '../workflow-card'
import { WorkflowStore } from '../../../services/workflow-store'
import { WorkflowService } from '../../../services/workflow-service'
import { NavigationCompiler } from '../../../services/navigation-compiler'
import { PersistenceService } from '../../../services/persistence-service'
import { PublishStore } from '../../../services/publish-store'
import { PublishService } from '../../../services/publish-service'
import type { CompilerAdapter } from '../../../services/navigation-compiler'
import type { PersistenceAdapter } from '../../../services/persistence-service'

function createWorkflowContext(): EditorContext {
  const eventBus = new DocumentEventBus()
  const document: CampusDocument = {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'test', name: 'test', description: '', lastModified: '', editorVersion: '0.1.0' },
    buildings: [],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }

  const compileAdapter: CompilerAdapter = {
    compile: async () => ({ status: 'success', timestamp: 0, artifacts: { navigationGraph: null, searchIndex: null, poiData: null, buildingIndex: null } }),
  }
  const persistAdapter: PersistenceAdapter = {
    save: async () => {},
    syncToSupabase: async () => {},
    publish: async () => ({ success: true }),
  }

  const navCompiler = new NavigationCompiler(compileAdapter)
  const persistence = new PersistenceService(persistAdapter)
  const workflowStore = new WorkflowStore()
  const workflow = new WorkflowService()
  const publishStore = new PublishStore()
  const publishService = new PublishService(publishStore)
  const docStore = { version: 0, document }

  // Initialise services so they can be used immediately
  const svcCtx = {
    get: (name: string) => {
      if (name === 'eventBus') return eventBus
      if (name === 'navigationCompiler') return navCompiler
      if (name === 'persistence') return persistence
      if (name === 'workflowStore') return workflowStore
      if (name === 'workflow') return workflow
      if (name === 'validation') return { validateAll: () => [] }
      if (name === 'documentStore') return docStore
      if (name === 'publishStore') return publishStore
      if (name === 'publish') return publishService
    },
    document,
  } as any

  // Sync init — call init on each service to set up status correctly
  // (PersistenceService needs valid status transitions)
  persistence.init(svcCtx)
  navCompiler.init(svcCtx)
  workflow.init(svcCtx)

  const services = {
    get(name: string) {
      if (name === 'eventBus') return eventBus
      if (name === 'navigationCompiler') return navCompiler
      if (name === 'persistence') return persistence
      if (name === 'workflowStore') return workflowStore
      if (name === 'workflow') return workflow
      if (name === 'validation') return { validateAll: () => [] }
      if (name === 'documentStore') return docStore
      if (name === 'publishStore') return publishStore
      if (name === 'publish') return publishService
    },
  }

  return { document, services }
}

describe('WorkflowCard', () => {
  it('renders header and all four steps', () => {
    render(
      <EditorProvider context={createWorkflowContext()}>
        <WorkflowCard />
      </EditorProvider>,
    )

    expect(screen.getByText('Workflow')).toBeDefined()
    expect(screen.getByText('Validate')).toBeDefined()
    expect(screen.getByText('Compile')).toBeDefined()
    expect(screen.getByText('Save')).toBeDefined()
    expect(screen.getAllByText('Publish').length).toBeGreaterThanOrEqual(1)
  })

  it('shows next action hint when no validation done', () => {
    render(
      <EditorProvider context={createWorkflowContext()}>
        <WorkflowCard />
      </EditorProvider>,
    )

    expect(screen.getAllByText(/Next:/).length).toBeGreaterThanOrEqual(1)
  })
})
