// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { EditorProvider } from '../context'
import type { EditorContext } from '../context'
import type { ValidationEngine } from '../validation/validation-engine'
import type { ValidationSnapshot } from '../validation/snapshot'
import { ProblemsPanel } from './ProblemsPanel'
import type { SelectionManager } from '../selection'

afterEach(cleanup)

function mockEngine(): ValidationEngine {
  const listeners = new Set<(snapshot: ValidationSnapshot) => void>()
  return {
    onValidationUpdated: vi.fn((cb: any) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    }),
    getLastSnapshot: vi.fn(() => undefined),
    validateFresh: vi.fn(),
    validate: vi.fn(),
  } as any
}

function mockSelection(): SelectionManager {
  return {
    select: vi.fn(),
  } as any
}

function mockFixRegistry(canFixResult = false) {
  return {
    canFix: vi.fn(() => canFixResult),
    applyFix: vi.fn(() => true),
  }
}

function createContext(overrides?: {
  issues?: any[]
  staleSnapshot?: boolean
  fixCanFix?: boolean
  liveDocumentVersion?: number
  documentVersion?: number
  snapshotDocumentVersion?: number
}): { ctx: EditorContext; engine: ReturnType<typeof mockEngine>; fixReg: ReturnType<typeof mockFixRegistry> } {
  const engine = mockEngine()
  const liveDocumentVersion = overrides?.liveDocumentVersion ?? 1
  const snapshot: ValidationSnapshot | undefined = overrides?.staleSnapshot
    ? undefined
    : {
        epoch: 1,
        documentId: 'doc-1',
        documentVersion: overrides?.snapshotDocumentVersion ?? 1,
        profile: 'draft',
        validatedAt: performance.now(),
        state: overrides?.issues && overrides.issues.length > 0 ? 'errors' : 'valid',
        issues: overrides?.issues ?? [],
        statistics: { duration: 0, totalIssues: 0, errors: 0, warnings: 0, infos: 0, rulesExecuted: 0, rulesPassed: 0, rulesFailed: 0 },
        analysisCache: {},
      }
  ;(engine.getLastSnapshot as any).mockReturnValue(snapshot)
  const sel = mockSelection()
  const fixReg = mockFixRegistry(overrides?.fixCanFix)
  return {
    ctx: {
      document: { version: overrides?.documentVersion ?? liveDocumentVersion } as any,
      services: {
        get(name: string) {
          if (name === 'validationEngine') return engine
          if (name === 'selection') return sel
          if (name === 'autoFixRegistry') return fixReg
          if (name === 'documentStore') {
            return {
              getVersion: () => liveDocumentVersion,
              subscribe: () => () => undefined,
            }
          }
        },
      } as any,
    },
    engine,
    fixReg,
  }
}

describe('ProblemsPanel', () => {
  it('shows no problems message when empty', () => {
    const { ctx } = createContext()
    render(
      <EditorProvider context={ctx}>
        <ProblemsPanel />
      </EditorProvider>,
    )
    expect(screen.getByText('No problems')).toBeDefined()
  })

  it('renders issues grouped by severity', () => {
    const { ctx } = createContext({
      issues: [
        {
          issueId: 'err-1', ruleId: 'polygon-closure', severity: 'error',
          message: 'Footprint not closed', targets: [{ entityId: 'bld-1', entityType: 'building' }],
        },
        {
          issueId: 'warn-1', ruleId: 'missing-name', severity: 'warning',
          message: 'Room has no name', targets: [{ entityId: 'rm-1', entityType: 'room' }],
        },
      ],
    })
    render(
      <EditorProvider context={ctx}>
        <ProblemsPanel />
      </EditorProvider>,
    )
    expect(screen.getByText('Footprint not closed')).toBeDefined()
    expect(screen.getByText('Room has no name')).toBeDefined()
    expect(screen.getAllByText(/error/i).length).toBeGreaterThan(0)
  })

  it('shows issue count in header', () => {
    const { ctx } = createContext({
      issues: [
        {
          issueId: 'err-1', ruleId: 'polygon-closure', severity: 'error',
          message: 'Test error', targets: [],
        },
      ],
    })
    render(
      <EditorProvider context={ctx}>
        <ProblemsPanel />
      </EditorProvider>,
    )
    expect(screen.getByText(/Problems \(1\)/)).toBeDefined()
  })

  it('asks the administrator to run validation when no snapshot exists', () => {
    const { ctx } = createContext({ staleSnapshot: true })
    render(
      <EditorProvider context={ctx}>
        <ProblemsPanel />
      </EditorProvider>,
    )
    expect(screen.getByText('Run Validate to check this campus')).toBeDefined()
  })

  it('shows error, warning, and info counts together', () => {
    const { ctx } = createContext({
      issues: [
        { issueId: 'err-1', ruleId: 'polygon-closure', severity: 'error', message: 'Error', targets: [] },
        { issueId: 'warn-1', ruleId: 'missing-name', severity: 'warning', message: 'Warning', targets: [] },
        { issueId: 'info-1', ruleId: 'campus-note', severity: 'info', message: 'Info', targets: [] },
      ],
    })
    render(
      <EditorProvider context={ctx}>
        <ProblemsPanel />
      </EditorProvider>,
    )
    expect(screen.getByText(/1 error/i)).toBeDefined()
    expect(screen.getByText(/1 warning/i)).toBeDefined()
    expect(screen.getByText(/1 info/i)).toBeDefined()
  })

  it('shows a readable route title, scope, layer, and target identity', () => {
    const { ctx } = createContext({
      issues: [{
        issueId: 'route-1',
        ruleId: 'route-entrance-access',
        severity: 'error',
        message: 'Entrance is not connected',
        targets: [{ entityId: 'entrance-7', entityType: 'entrance' }],
        buildingId: 'building-2',
        floorId: 'floor-0',
        layer: 'navigation',
      }],
    })
    render(
      <EditorProvider context={ctx}>
        <ProblemsPanel />
      </EditorProvider>,
    )
    expect(screen.getByText('Entrance route access is invalid')).toBeDefined()
    expect(screen.getByText(/navigation/i)).toBeDefined()
    expect(screen.getByText(/building-2/i)).toBeDefined()
    expect(screen.getByText(/floor-0/i)).toBeDefined()
    expect(screen.getByText(/entrance-7/i)).toBeDefined()
  })

  it('delegates issue focus to the map-aware callback', () => {
    const onIssueFocus = vi.fn()
    const { ctx } = createContext({
      issues: [{
        issueId: 'route-1', ruleId: 'route-network-disconnected', severity: 'error',
        message: 'Disconnected', targets: [{ entityId: 'route-node-1', entityType: 'route-node' }],
      }],
    })
    render(
      <EditorProvider context={ctx}>
        <ProblemsPanel onIssueFocus={onIssueFocus} canIssueFocus={() => true} />
      </EditorProvider>,
    )
    fireEvent.click(screen.getByText('Disconnected'))
    expect(onIssueFocus).toHaveBeenCalledWith(expect.objectContaining({ issueId: 'route-1' }))
    expect(screen.getByRole('button', { name: 'Show on map' })).toBeDefined()
  })

  it('marks a report stale when the live document version has changed', () => {
    const { ctx } = createContext({
      liveDocumentVersion: 2,
      snapshotDocumentVersion: 1,
      issues: [{ issueId: 'err-1', ruleId: 'polygon-closure', severity: 'error', message: 'Stale error', targets: [] }],
    })
    render(
      <EditorProvider context={ctx}>
        <ProblemsPanel />
      </EditorProvider>,
    )
    expect(screen.getByText('● stale')).toBeDefined()
  })

  it('does not mark a matching engine snapshot stale when store revision differs', () => {
    const { ctx } = createContext({
      documentVersion: 1,
      liveDocumentVersion: 0,
      snapshotDocumentVersion: 1,
      issues: [{ issueId: 'err-1', ruleId: 'polygon-closure', severity: 'error', message: 'Current error', targets: [] }],
    })
    render(
      <EditorProvider context={ctx}>
        <ProblemsPanel />
      </EditorProvider>,
    )
    expect(screen.queryByText('● stale')).toBeNull()
  })

  it('does not render Show on map for a targetless or unresolved issue', () => {
    const onIssueFocus = vi.fn()
    const { ctx } = createContext({
      issues: [{ issueId: 'global-1', ruleId: 'route-network-disconnected', severity: 'error', message: 'Global graph issue', targets: [] }],
    })
    render(
      <EditorProvider context={ctx}>
        <ProblemsPanel onIssueFocus={onIssueFocus} canIssueFocus={() => false} />
      </EditorProvider>,
    )
    expect(screen.queryByRole('button', { name: 'Show on map' })).toBeNull()
  })

  it('calls selection.select on issue click', () => {
    const engine = mockEngine()
    const snapshot: ValidationSnapshot = {
      epoch: 1, documentId: 'doc-1', documentVersion: 1, profile: 'draft',
      validatedAt: performance.now(), state: 'errors',
      issues: [{
        issueId: 'err-1', ruleId: 'polygon-closure', severity: 'error',
        message: 'Click test', targets: [{ entityId: 'bld-1', entityType: 'building' }],
      }],
      statistics: { duration: 0, totalIssues: 1, errors: 1, warnings: 0, infos: 0, rulesExecuted: 0, rulesPassed: 0, rulesFailed: 0 },
      analysisCache: {},
    }
    ;(engine.getLastSnapshot as any).mockReturnValue(snapshot)
    const sel = mockSelection()
    const ctx: EditorContext = {
      document: {} as any,
      services: {
        get(name: string) {
          if (name === 'validationEngine') return engine
          if (name === 'selection') return sel
        },
      } as any,
    }
    render(
      <EditorProvider context={ctx}>
        <ProblemsPanel />
      </EditorProvider>,
    )
    fireEvent.click(screen.getByText('Click test'))
    expect(sel.select).toHaveBeenCalledWith('bld-1')
  })

  it('subscribes to engine updates on mount', () => {
    const engine = mockEngine()
    const ctx: EditorContext = {
      document: {} as any,
      services: {
        get(name: string) {
          if (name === 'validationEngine') return engine
          if (name === 'selection') return mockSelection()
        },
      } as any,
    }
    render(
      <EditorProvider context={ctx}>
        <ProblemsPanel />
      </EditorProvider>,
    )
    expect(engine.onValidationUpdated).toHaveBeenCalled()
  })

  it('filters by entity when entityFilter is provided', () => {
    const { ctx } = createContext({
      issues: [
        {
          issueId: 'err-1', ruleId: 'polygon-closure', severity: 'error',
          message: 'Building issue', targets: [{ entityId: 'bld-1', entityType: 'building' }],
        },
        {
          issueId: 'err-2', ruleId: 'missing-name', severity: 'warning',
          message: 'Room issue', targets: [{ entityId: 'rm-1', entityType: 'room' }],
        },
      ],
    })
    render(
      <EditorProvider context={ctx}>
        <ProblemsPanel entityFilter="bld-1" />
      </EditorProvider>,
    )
    expect(screen.getByText('Building issue')).toBeDefined()
    expect(screen.queryByText('Room issue')).toBeNull()
  })

  it('shows fix button when issue has fixId and canFix returns true', () => {
    const { ctx } = createContext({
      fixCanFix: true,
      issues: [{
        issueId: 'fix-1', ruleId: 'missing-name', severity: 'info', fixId: 'metadata.assign-name',
        message: 'Entity has no name', targets: [{ entityId: 'rm-1', entityType: 'room' }],
      }],
    })
    render(
      <EditorProvider context={ctx}>
        <ProblemsPanel />
      </EditorProvider>,
    )
    expect(screen.getByText('Fix')).toBeDefined()
  })

  it('hides fix button when canFix returns false', () => {
    const { ctx } = createContext({
      fixCanFix: false,
      issues: [{
        issueId: 'fix-1', ruleId: 'missing-name', severity: 'info', fixId: 'metadata.assign-name',
        message: 'Entity has no name', targets: [{ entityId: 'rm-1', entityType: 'room' }],
      }],
    })
    render(
      <EditorProvider context={ctx}>
        <ProblemsPanel />
      </EditorProvider>,
    )
    expect(screen.queryByText('Fix')).toBeNull()
  })

  it('hides fix button when issue has no fixId', () => {
    const { ctx } = createContext({
      fixCanFix: true,
      issues: [{
        issueId: 'err-1', ruleId: 'polygon-closure', severity: 'error',
        message: 'Footprint not closed', targets: [{ entityId: 'bld-1', entityType: 'building' }],
      }],
    })
    render(
      <EditorProvider context={ctx}>
        <ProblemsPanel />
      </EditorProvider>,
    )
    expect(screen.queryByText('Fix')).toBeNull()
  })

  it('calls applyFix and revalidates on fix button click', () => {
    const { ctx, engine, fixReg } = createContext({
      fixCanFix: true,
      issues: [{
        issueId: 'fix-1', ruleId: 'missing-name', severity: 'info', fixId: 'metadata.assign-name',
        message: 'Click fix test', targets: [{ entityId: 'rm-1', entityType: 'room' }],
      }],
    })
    render(
      <EditorProvider context={ctx}>
        <ProblemsPanel />
      </EditorProvider>,
    )
    fireEvent.click(screen.getByText('Fix'))
    expect(fixReg.applyFix).toHaveBeenCalled()
    expect(engine.validateFresh).toHaveBeenCalled()
  })

  it('renders profile selector with three options', () => {
    const { ctx } = createContext()
    render(
      <EditorProvider context={ctx}>
        <ProblemsPanel />
      </EditorProvider>,
    )
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select).toBeDefined()
    expect(select.options.length).toBe(3)
    expect(select.options[0].text).toBe('Draft')
    expect(select.options[1].text).toBe('Publish')
    expect(select.options[2].text).toBe('Strict')
  })

  it('calls engine.validate with new profile on selector change', () => {
    const { ctx, engine } = createContext()
    render(
      <EditorProvider context={ctx}>
        <ProblemsPanel />
      </EditorProvider>,
    )
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'publish' } })
    expect(engine.validate).toHaveBeenCalledWith(expect.anything(), 'publish')
  })

  it('calls engine.validateFresh with active profile on re-validate', () => {
    const { ctx, engine } = createContext()
    render(
      <EditorProvider context={ctx}>
        <ProblemsPanel />
      </EditorProvider>,
    )
    const buttons = screen.getAllByRole('button')
    const revalidate = buttons.find(b => b.textContent === '↻')
    expect(revalidate).toBeDefined()
    if (revalidate) fireEvent.click(revalidate)
    expect(engine.validateFresh).toHaveBeenCalledWith(expect.anything(), 'draft')
  })
})
