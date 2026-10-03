import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as publishRoute } from '../../../../src/app/api/publish/route'
import { GraphAdapter } from '@navi/editor'
import { Graph } from '@/engine/graph'
import type { CampusDocument, Building } from '@navi/core'


function createSampleDocWithParametricFeature(): CampusDocument {
  const building: Building = {
    id: 'bld-science',
    name: 'Science Center',
    code: 'SC',
    category: 'academic',
    description: '',
    footprint: {
      points: [
        { lat: 33.42, lng: -111.93 },
        { lat: 33.421, lng: -111.93 },
        { lat: 33.421, lng: -111.929 },
        { lat: 33.42, lng: -111.929 },
        { lat: 33.42, lng: -111.93 },
      ],
    },
    baseElevation: 0,
    height: 20,
    floors: [
      {
        id: 'flr-0',
        level: 0,
        label: 'Ground',
        elevation: 0,
        rooms: [],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [],
        connectorStops: [],
        metadata: {},
      },
      {
        id: 'flr-1',
        level: 1,
        label: 'First Floor',
        elevation: 4,
        rooms: [],
        hallways: [],
        staircases: [],
        elevators: [],
        entrances: [],
        connectorStops: [],
        metadata: {},
      },
    ],
    staircases: [
      {
        id: 'stair-physical-1',
        buildingId: 'bld-science',
        name: 'Main Stairs',
        type: 'standard',
        accessible: false,
        fromLevel: 0,
        toLevel: 1,
        levels: {
          0: {
            position: { x: 10, y: 10 },
            rotation: 0,
            drawing: {
              definitionId: 'stair',
              properties: {
                stepCount: 14,
                stepWidth: 1.5,
                stepDepth: 0.3,
                direction: 'up',
                preset: 'straight',
              },
            },
            polygon: {
              points: [
                { x: 10, y: 10 },
                { x: 11.5, y: 10 },
                { x: 11.5, y: 14.2 },
                { x: 10, y: 14.2 },
                { x: 10, y: 10 },
              ],
            },
            landing: {
              position: { x: 10.75, y: 9.5 },
            },
          },
          1: {
            position: { x: 10, y: 10 },
            rotation: 0,
            polygon: {
              points: [
                { x: 10, y: 10 },
                { x: 11.5, y: 10 },
                { x: 11.5, y: 14.2 },
                { x: 10, y: 14.2 },
                { x: 10, y: 10 },
              ],
            },
          },
        },
      },
    ],
    verticalConnectors: [],
    aliases: [],
    color: '#00aa00',
    metadata: {},
  }

  return {
    schemaVersion: 2,
    version: 1,
    metadata: {
      campusId: 'test-campus',
      name: 'Test Campus',
      description: '',
      lastModified: new Date().toISOString(),
      editorVersion: '1.0.0',
    },
    buildings: [building],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

describe('P3 Publish Blocking Gate & Runtime Contract', () => {
  it('rejects publish request with HTTP 422 when blocking validation errors exist', async () => {
    const blockingDiagnostic = {
      issueId: 'feature-connectivity:stair-1:no-hallways',
      ruleId: 'feature-connectivity',
      severity: 'error',
      message: 'Staircase "stair-1" on floor 0 has no usable hallway on that floor',
      targets: [{ entityId: 'stair-1', entityType: 'staircase' }],
    }

    const payload = {
      campusId: 'test-campus',
      revision: 1,
      artifacts: {
        navigationGraph: {
          version: '1.0.0',
          nodes: [],
          edges: [],
        },
      },
      validationIssues: [blockingDiagnostic],
    }

    const req = new NextRequest('http://localhost:3000/api/publish', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json', cookie: 'sb-test-auth-token=test' },
    })

    const res = await publishRoute(req)
    expect(res.status).toBe(422)

    const json = await res.json()
    expect(json.success).toBe(false)
    expect(json.message).toContain('Publish blocked')
    expect(json.diagnostics).toHaveLength(1)
    expect(json.diagnostics[0].ruleId).toBe('feature-connectivity')
  })

  it('allows publish when only warnings or zero errors exist', async () => {
    const warningDiagnostic = {
      issueId: 'feature-extent:stair-1:missing-endpoint',
      ruleId: 'feature-extent',
      severity: 'warning',
      message: 'Feature endpoint warning',
      targets: [{ entityId: 'stair-1', entityType: 'staircase' }],
    }

    const payload = {
      campusId: 'test-campus-ok',
      revision: 1,
      artifacts: {
        navigationGraph: {
          version: '1.0.0',
          campusId: 'test-campus-ok',
          createdAt: '2026-09-06T00:00:00.000Z',
          nodes: [{ id: 'n1', name: 'N1', type: 'outdoor', position: { lat: 33.42, lng: -111.93 } }],
          edges: [],
        },
        metadata: {
          campusId: 'test-campus-ok',
          compilerVersion: '1.0.0',
          revision: '1',
          sourceDocumentVersion: '1',
          compiledAt: '2026-09-06T00:00:00.000Z',
        },
      },
      validationIssues: [warningDiagnostic],
    }

    const req = new NextRequest('http://localhost:3000/api/publish', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json', cookie: 'sb-test-auth-token=test' },
    })

    const res = await publishRoute(req)
    expect(res.status).toBe(200)

    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.manifest).toBeDefined()
  })

  it('enforces runtime contract: parametric authoring state does not leak to published Component', () => {
    const doc = createSampleDocWithParametricFeature()
    const graph = new Graph()
    const adapter = new GraphAdapter(graph)
    adapter.sync(doc)


    expect(graph.components.length).toBeGreaterThan(0)
    const stairComp0 = graph.components.find((c) => c.id === 'stair-physical-1-0')
    expect(stairComp0).toBeDefined()

    // 1. Required Runtime Fields
    expect(stairComp0!.id).toBe('stair-physical-1-0')
    expect(stairComp0!.featureId).toBe('stair-physical-1')
    expect(stairComp0!.type).toBe('stair')
    expect(stairComp0!.floor).toBe(0)
    expect(stairComp0!.position).toBeDefined()
    expect(stairComp0!.position.lat).toBeGreaterThan(0)
    expect(stairComp0!.polygon).toBeDefined()
    expect(stairComp0!.polygon!.length).toBeGreaterThanOrEqual(3)
    expect(stairComp0!.range).toEqual({ from: 0, to: 1 })
    expect(stairComp0!.metadata?.landing).toBeDefined()
    expect(stairComp0!.metadata?.type).toBe('standard')

    // 2. Strict Prohibitions: Parametric authoring fields MUST NOT leak
    const rawComp = stairComp0 as any
    expect(rawComp.drawing).toBeUndefined()
    expect(rawComp.stepCount).toBeUndefined()
    expect(rawComp.stepWidth).toBeUndefined()
    expect(rawComp.stepDepth).toBeUndefined()
    expect(rawComp.preset).toBeUndefined()
    expect(rawComp.direction).toBeUndefined()
  })
})
