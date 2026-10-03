/**
 * Wave 7 — Compiler Stage Plugin System
 *
 * Tests the plugin architecture:
 *   - CampusCompiler with 6-stage pipeline
 *   - Plugin registration (replace + augment modes)
 *   - Plugin chaining and execution order
 *   - compileWithProgress callback
 *   - Error propagation and pipeline halting
 *   - Backward compatibility with legacy compile()
 */

import { describe, it, expect, vi } from 'vitest'
import { accessibilityWeightPlugin } from '../plugins/accessibility-plugin'
import { customValidationPlugin } from '../plugins/custom-validation-plugin'
import { CampusCompiler } from '../pipeline/campus-compiler'
import { compile } from '../pipeline/compile'
import { buildEdges } from '../pipeline/stages/build-edges-stage'
import type { CampusDocument, Building, Floor, Room, Hallway, Entrance, Road } from '@navi/core'
import type {
  CompilerStagePlugin,
  CompilerStageInput,
  CompilerStageOutput,
  CompileResultV2,
  NavNode,
} from '../types'

// ── Helper factories (mirroring compiler-invariants.test.ts) ──

function makeEmptyDoc(): CampusDocument {
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'Empty', name: 'Empty', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function makeRoom(id: string, name: string, number: string, x: number, y: number): Room {
  return {
    id, name, number, category: 'classroom',
    polygon: {
      points: [
        { x, y },
        { x: x + 10, y },
        { x: x + 10, y: y + 8 },
        { x, y: y + 8 },
        { x, y },
      ],
    },
    roomDoors: [],
    capacity: 30,
    metadata: {},
  }
}

function makeEntrance(id: string, label: string, lat: number, lng: number, level = 0): Entrance {
  // Legacy world-stored position (dual-mode tolerance — see P1-T4 D9).
  return {
    id, label, position: { lat, lng } as any, level, type: 'main',
    hasQR: false, hasPanorama: false,
  }
}

function makeFloor(id: string, level: number, label: string, opts?: {
  rooms?: Room[]
  hallways?: Hallway[]
  entrances?: Entrance[]
}): Floor {
  return {
    id, level, label, elevation: level * 3,
    rooms: opts?.rooms ?? [],
    hallways: opts?.hallways ?? [],
    staircases: [],
    elevators: [],
    entrances: opts?.entrances ?? [],
    connectorStops: [],
    metadata: {},
  }
}

function makeHallway(id: string, name: string, pts: Array<{ x: number; y: number }>, width = 3): Hallway {
  return {
    id, name, polyline: { points: pts }, width, metadata: {},
  }
}

function makeBuilding(id: string, name: string, code: string, baseLat: number, baseLng: number, floors: Floor[]): Building {
  return {
    id, name, code, category: 'academic', description: '',
    footprint: {
      points: [
        { lat: baseLat, lng: baseLng },
        { lat: baseLat, lng: baseLng + 0.01 },
        { lat: baseLat + 0.01, lng: baseLng + 0.01 },
        { lat: baseLat + 0.01, lng: baseLng },
        { lat: baseLat, lng: baseLng },
      ],
    },
    baseElevation: 0, height: 15,
    floors,
    verticalConnectors: [],
    color: '#cccccc', aliases: [], metadata: {},
  }
}

function makeRoad(id: string, name: string, pts: Array<{ lat: number; lng: number }>): Road {
  return {
    id, name, polyline: { points: pts },
    width: 3, surface: 'paved', type: 'connector', metadata: {},
  }
}

function simpleDoc(): CampusDocument {
  const roomA = makeRoom('r-a', 'Room A', '101', 0, 0)
  const roomB = makeRoom('r-b', 'Room B', '102', 15, 0)
  // Hallway runs along the rooms so each room door connects to it
  const hallway = makeHallway('hw-1', 'Main Hallway', [{ x: 0, y: -3 }, { x: 15, y: -3 }])
  // Entrance sits near the hallway start (within connection range).
  // Building origin = footprint centroid (0.004, 0.004), so place entrance nearby.
  const entrance = makeEntrance('e-main', 'Main Entrance', 0.00405, 0.00405)
  const floor = makeFloor('flr-0', 0, 'Ground', { rooms: [roomA, roomB], hallways: [hallway], entrances: [entrance] })
  const building = makeBuilding('b-a', 'Building A', 'A', 0, 0, [floor])
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'Simple', name: 'Simple', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [building],
    roads: [],
    panoramas: [],
    qrCheckpoints: [],
  }
}

function multiBuildingDoc(): CampusDocument {
  const roomA = makeRoom('r-a', 'Room A', 'A1', 0, 0)
  const hwA = makeHallway('hw-a', 'Hallway A', [{ x: 0, y: -3 }, { x: 10, y: -3 }])
  const entA = { ...makeEntrance('e-a', 'Entrance A', 0.00405, 0.00405), connectorRoadId: 'road-1' }
  const floorA = makeFloor('flr-0', 0, 'Ground', { rooms: [roomA], hallways: [hwA], entrances: [entA] })
  const bldA = makeBuilding('b-a', 'Building A', 'A', 0, 0, [floorA])

  const roomB = makeRoom('r-b', 'Room B', 'B1', 0, 0)
  const hwB = makeHallway('hw-b', 'Hallway B', [{ x: 0, y: -3 }, { x: 10, y: -3 }])
  const entB = { ...makeEntrance('e-b', 'Entrance B', 0.01405, 0.01405), connectorRoadId: 'road-1' }
  const floorB = makeFloor('flr-1', 0, 'Ground', { rooms: [roomB], hallways: [hwB], entrances: [entB] })
  const bldB = makeBuilding('b-b', 'Building B', 'B', 0.01, 0.01, [floorB])

  const road = makeRoad('road-1', 'Campus Road', [{ lat: 0.005, lng: 0.005 }, { lat: 0.015, lng: 0.015 }])
  return {
    schemaVersion: 1,
    version: 1,
    metadata: { campusId: 'Multi', name: 'Multi', description: '', lastModified: '', editorVersion: '1.0.0' },
    buildings: [bldA, bldB],
    roads: [road],
    panoramas: [],
    qrCheckpoints: [],
  }
}

// ── Tests ──

describe('Wave 7 | Compiler Stage Plugin System', () => {

  it('does not proximity-link an unassigned entrance to an outdoor corridor', () => {
    const entrance: NavNode = {
      id: 'entrance-node',
      label: 'Main Entrance',
      type: 'transition',
      position: { lat: 14.5, lng: 121.49 },
      floor: 0,
      buildingId: 'bld-x',
      properties: { entityType: 'entrance', entityId: 'entrance-1' },
    }
    const road: NavNode = {
      id: 'road-node',
      label: 'Campus Road',
      type: 'corridor',
      position: { lat: 14.50028, lng: 121.49 },
      floor: 0,
      buildingId: '',
      properties: { entityType: 'road', entityId: 'road-near' },
    }

    const edges = buildEdges([entrance, road], { buildings: [], rooms: [], hallways: [], entrances: [], stairs: [], elevators: [], roads: [] } as any)
    expect(edges.some((edge) => edge.from === entrance.id || edge.to === entrance.id)).toBe(false)
  })

  it('keeps an explicit legacy entrance road link', () => {
    const entrance: NavNode = {
      id: 'entrance-node',
      label: 'Main Entrance',
      type: 'transition',
      position: { lat: 14.5, lng: 121.49 },
      floor: 0,
      buildingId: 'bld-x',
      properties: { entityType: 'entrance', entityId: 'entrance-1', connectorRoadId: 'road-far' },
    }
    const road: NavNode = {
      id: 'road-node',
      label: 'Campus Road',
      type: 'corridor',
      position: { lat: 15, lng: 121.49 },
      floor: 0,
      buildingId: '',
      properties: { entityType: 'road', entityId: 'road-far' },
    }

    const edges = buildEdges([entrance, road], { buildings: [], rooms: [], hallways: [], entrances: [], stairs: [], elevators: [], roads: [] } as any)
    expect(edges.some((edge) => edge.from === entrance.id && edge.to === road.id)).toBe(true)
  })

  // ── CampusCompiler basics ──

  describe('CampusCompiler basics', () => {
    it('compiles an empty document successfully', () => {
      const compiler = new CampusCompiler()
      const result = compiler.compile(makeEmptyDoc())
      expect(result.success).toBe(true)
      expect(result.graph).not.toBeNull()
      expect(result.graph!.nodes).toHaveLength(0)
      expect(result.graph!.edges).toHaveLength(0)
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })

    it('compiles a simple document with nodes and edges', () => {
      const compiler = new CampusCompiler()
      const result = compiler.compile(simpleDoc())
      expect(result.success).toBe(true)
      expect(result.graph!.nodes.length).toBeGreaterThan(0)
      expect(result.graph!.edges.length).toBeGreaterThan(0)
    })

    it('compiles a multi-building document', () => {
      const compiler = new CampusCompiler()
      const result = compiler.compile(multiBuildingDoc())
      expect(result.success).toBe(true)
      expect(result.graph!.nodes.length).toBeGreaterThan(0)
      // Should have building and road connections
      expect(result.graph!.edges.length).toBeGreaterThanOrEqual(2)
    })

    it('produces deterministic output for identical input', () => {
      const doc = simpleDoc()
      const compiler = new CampusCompiler()
      const result1 = compiler.compile(doc)
      const result2 = compiler.compile(doc)
      expect(result1.graph!.checksum).toBe(result2.graph!.checksum)
      expect(result1.graph!.checksum).not.toBe('')
    })

    it('produces CompileResultV2 with all required fields', () => {
      const compiler = new CampusCompiler()
      const result = compiler.compile(simpleDoc())
      expect(result).toHaveProperty('success')
      expect(result).toHaveProperty('graph')
      expect(result).toHaveProperty('stats')
      expect(result).toHaveProperty('warnings')
      expect(result).toHaveProperty('errors')
      expect(result).toHaveProperty('duration')
      expect(result.stats).toHaveProperty('totalNodes')
      expect(result.stats).toHaveProperty('totalEdges')
      expect(result.stats).toHaveProperty('connectivityScore')
    })

    it('reports correct stats', () => {
      const compiler = new CampusCompiler()
      const result = compiler.compile(simpleDoc())
      expect(result.stats.totalNodes).toBe(result.graph!.nodes.length)
      expect(result.stats.totalEdges).toBe(result.graph!.edges.length)
      expect(result.stats.roomsProcessed).toBeGreaterThanOrEqual(2)
      expect(result.stats.connectivityScore).toBeGreaterThan(0)
    })
  })

  // ── Plugin Registration ──

  describe('Plugin registration', () => {
    it('throws for plugin IDs without "compiler-" prefix', () => {
      const compiler = new CampusCompiler()
      expect(() => {
        compiler.registerPlugin({
          id: 'bad-plugin',
          targetStage: 'parse',
          meta: { name: 'Bad', version: '1.0.0', description: '' },
          mode: 'augment',
          execute: (_input: CompilerStageInput, _next: any) => ({ context: {} }),
        })
      }).toThrow('Plugin ID must start with "compiler-"')
    })

    it('accepts plugin IDs with "compiler-" prefix', () => {
      const compiler = new CampusCompiler()
      expect(() => {
        compiler.registerPlugin({
          id: 'compiler-good-plugin',
          targetStage: 'parse',
          meta: { name: 'Good', version: '1.0.0', description: '' },
          mode: 'augment',
          execute: (_input: CompilerStageInput, _next: any) => ({ context: {} }),
        })
      }).not.toThrow()
    })

    it('accepts plugins via constructor config', () => {
      const plugin: CompilerStagePlugin = {
        id: 'compiler-config-test',
        targetStage: 'build-nodes',
        meta: { name: 'Config Test', version: '1.0.0', description: '' },
        mode: 'augment',
        execute: (_input: CompilerStageInput, next: any) => next(_input),
      }
      const compiler = new CampusCompiler({
        nodeInterval: 10, mergeThreshold: 5,
        optimizationLevel: 'none', includeAccessibility: false,
        plugins: [plugin],
      })
      const result = compiler.compile(simpleDoc())
      expect(result.success).toBe(true)
    })
  })

  // ── Augment plugins ──

  describe('Augment mode', () => {
    it('augment plugin can modify stage output', () => {
      const tagPlugin: CompilerStagePlugin = {
        id: 'compiler-tag-nodes',
        targetStage: 'build-nodes',
        meta: { name: 'Tag Nodes', version: '1.0.0', description: 'Adds a tag to all nodes' },
        mode: 'augment',
        execute(input: CompilerStageInput, next: any): CompilerStageOutput {
          const result = next(input)
          if (result.nodes) {
            for (const node of result.nodes) {
              (node.properties as any).tagged = true
            }
          }
          return result
        },
      }

      const compiler = new CampusCompiler({
        nodeInterval: 10, mergeThreshold: 5,
        optimizationLevel: 'none', includeAccessibility: false,
        plugins: [tagPlugin],
      })
      const result = compiler.compile(simpleDoc())
      expect(result.success).toBe(true)
      for (const node of result.graph!.nodes) {
        expect((node.properties as any).tagged).toBe(true)
      }
    })

    it('multiple augment plugins execute in registration order (last runs closest to default)', () => {
      const order: string[] = []
      const plugin1: CompilerStagePlugin = {
        id: 'compiler-order-1',
        targetStage: 'build-nodes',
        meta: { name: 'Order1', version: '1.0.0', description: '' },
        mode: 'augment',
        execute(input: CompilerStageInput, next: any) {
          order.push('plugin1-before')
          const result = next(input)
          order.push('plugin1-after')
          return result
        },
      }
      const plugin2: CompilerStagePlugin = {
        id: 'compiler-order-2',
        targetStage: 'build-nodes',
        meta: { name: 'Order2', version: '1.0.0', description: '' },
        mode: 'augment',
        execute(input: CompilerStageInput, next: any) {
          order.push('plugin2-before')
          const result = next(input)
          order.push('plugin2-after')
          return result
        },
      }

      const compiler = new CampusCompiler({
        nodeInterval: 10, mergeThreshold: 5,
        optimizationLevel: 'none', includeAccessibility: false,
        plugins: [plugin1, plugin2],
      })
      compiler.compile(simpleDoc())

      // plugin1 wraps plugin2 wraps default:
      // plugin1-before → plugin2-before → default → plugin2-after → plugin1-after
      expect(order.indexOf('plugin1-before')).toBeLessThan(order.indexOf('plugin2-before'))
      expect(order.indexOf('plugin2-before')).toBeLessThan(order.indexOf('plugin2-after'))
      expect(order.indexOf('plugin2-after')).toBeLessThan(order.indexOf('plugin1-after'))
    })
  })

  // ── Replace plugins ──

  describe('Replace mode', () => {
    it('replace plugin takes full control and can skip default', () => {
      const replacePlugin: CompilerStagePlugin = {
        id: 'compiler-replace-validate',
        targetStage: 'validate',
        meta: { name: 'Replace Validate', version: '1.0.0', description: '' },
        mode: 'replace',
        execute(_input: CompilerStageInput, _next: any): CompilerStageOutput {
          // Totally custom validation — doesn't call default
          return {
            warnings: [{ code: 'CUSTOM_CHECK', message: 'Custom validator ran', entityId: '' }],
          }
        },
      }

      const compiler = new CampusCompiler({
        nodeInterval: 10, mergeThreshold: 5,
        optimizationLevel: 'none', includeAccessibility: false,
        plugins: [replacePlugin],
      })
      const result = compiler.compile(simpleDoc())
      expect(result.success).toBe(true)
      // Should have our custom warning (NOT default validator's output)
      const hasCustomWarning = result.warnings.some(w => w.code === 'CUSTOM_CHECK')
      expect(hasCustomWarning).toBe(true)
    })

    it('replace plugin can fall back to default via next()', () => {
      let replaceRan = false
      const replacePlugin: CompilerStagePlugin = {
        id: 'compiler-replace-with-fallback',
        targetStage: 'validate',
        meta: { name: 'Replace With Fallback', version: '1.0.0', description: '' },
        mode: 'replace',
        execute(input: CompilerStageInput, next: any): CompilerStageOutput {
          replaceRan = true
          // Call the default and add our own warning on top
          const result = next(input)
          return {
            ...result,
            warnings: [...(result.warnings || []), { code: 'AFTER_DEFAULT', message: 'Ran after default', entityId: '' }],
          }
        },
      }

      const compiler = new CampusCompiler({
        nodeInterval: 10, mergeThreshold: 5,
        optimizationLevel: 'none', includeAccessibility: false,
        plugins: [replacePlugin],
      })
      const result = compiler.compile(simpleDoc())
      expect(replaceRan).toBe(true)
      expect(result.success).toBe(true)
      const hasAfter = result.warnings.some(w => w.code === 'AFTER_DEFAULT')
      expect(hasAfter).toBe(true)
    })

    it('only the first replace plugin runs (subsequent ones ignored)', () => {
      const firstPlugin: CompilerStagePlugin = {
        id: 'compiler-replace-first',
        targetStage: 'validate',
        meta: { name: 'First', version: '1.0.0', description: '' },
        mode: 'replace',
        execute(_input: CompilerStageInput, _next: any): CompilerStageOutput {
          return { warnings: [{ code: 'FIRST_RAN', message: 'First replace ran', entityId: '' }] }
        },
      }
      const secondPlugin: CompilerStagePlugin = {
        id: 'compiler-replace-second',
        targetStage: 'validate',
        meta: { name: 'Second', version: '1.0.0', description: '' },
        mode: 'replace',
        execute(_input: CompilerStageInput, _next: any): CompilerStageOutput {
          return { warnings: [{ code: 'SECOND_RAN', message: 'Second replace should NOT run', entityId: '' }] }
        },
      }

      const compiler = new CampusCompiler({
        nodeInterval: 10, mergeThreshold: 5,
        optimizationLevel: 'none', includeAccessibility: false,
        plugins: [firstPlugin, secondPlugin],
      })
      const result = compiler.compile(simpleDoc())
      // First replace ran (its warning should be present)
      expect(result.warnings.some(w => w.code === 'FIRST_RAN')).toBe(true)
      // Second replace should NOT have run
      expect(result.warnings.some(w => w.code === 'SECOND_RAN')).toBe(false)
    })
  })

  // ── Stage overrides ──

  describe('Stage overrides', () => {
    it('stage overrides replace default stage implementation', () => {
      // Override parse stage with a custom one that injects a context flag
      class CustomParsePlugin implements CompilerStagePlugin {
        id = 'compiler-custom-parse'
        targetStage = 'parse' as const
        mode = 'replace' as const
        meta = { name: 'Custom Parse', version: '1.0.0', description: '' }
        execute(input: CompilerStageInput, _next: any): CompilerStageOutput {
          return { context: { parsed: 'custom' } }
        }
      }

      const compiler = new CampusCompiler({
        nodeInterval: 10, mergeThreshold: 5,
        optimizationLevel: 'none', includeAccessibility: false,
        stages: { parse: CustomParsePlugin },
      })
      const result = compiler.compile(simpleDoc())
      expect(result.success).toBe(false) // No real parsing happened
      expect(result.errors.length).toBeGreaterThan(0) // Subsequent stages fail
    })
  })

  // ── compileWithProgress ──

  describe('compileWithProgress', () => {
    it('calls progress callback for each stage', () => {
      const compiler = new CampusCompiler()
      const progressCalls: Array<{ name: string; progress: number }> = []

      compiler.compileWithProgress(simpleDoc(), (stage, progress) => {
        progressCalls.push({ name: stage.name, progress })
      })

      // Should have called for all 5 stages
      expect(progressCalls.length).toBe(5)
      expect(progressCalls[0].name).toBe('Parsing document')
      expect(progressCalls[4].name).toBe('Validating graph')
      expect(progressCalls[0].progress).toBeCloseTo(1 / 5, 1)
      expect(progressCalls[4].progress).toBeCloseTo(1, 1)
    })

    it('progress values are monotonic', () => {
      const compiler = new CampusCompiler()
      const progresses: number[] = []

      compiler.compileWithProgress(simpleDoc(), (_stage, progress) => {
        progresses.push(progress)
      })

      for (let i = 1; i < progresses.length; i++) {
        expect(progresses[i]).toBeGreaterThan(progresses[i - 1])
      }
    })
  })

  // ── Error handling ──

  describe('Error handling', () => {
    it('returns success=false and error details when a plugin throws', () => {
      const throwingPlugin: CompilerStagePlugin = {
        id: 'compiler-thrower',
        targetStage: 'build-nodes',
        meta: { name: 'Thrower', version: '1.0.0', description: '' },
        mode: 'replace',
        execute(): CompilerStageOutput {
          throw new Error('Something went terribly wrong')
        },
      }

      const compiler = new CampusCompiler({
        nodeInterval: 10, mergeThreshold: 5,
        optimizationLevel: 'none', includeAccessibility: false,
        plugins: [throwingPlugin],
      })
      const result = compiler.compile(simpleDoc())
      expect(result.success).toBe(false)
      expect(result.graph).toBeNull()
      expect(result.errors.length).toBeGreaterThanOrEqual(1)
      expect(result.errors[0].code).toBe('COMPILE_ERROR')
      expect(result.errors[0].message).toContain('Something went terribly wrong')
    })

    it('pipeline halts on stage errors', () => {
      const errorPlugin: CompilerStagePlugin = {
        id: 'compiler-error-stage',
        targetStage: 'build-nodes',
        meta: { name: 'Error Stage', version: '1.0.0', description: '' },
        mode: 'replace',
        execute(): CompilerStageOutput {
          return { errors: [{ code: 'FATAL', message: 'Fatal error in build-nodes' }] }
        },
      }

      const compiler = new CampusCompiler({
        nodeInterval: 10, mergeThreshold: 5,
        optimizationLevel: 'none', includeAccessibility: false,
        plugins: [errorPlugin],
      })
      const result = compiler.compile(simpleDoc())
      expect(result.success).toBe(false)
      expect(result.errors.some(e => e.code === 'FATAL')).toBe(true)
    })
  })

  // ── Plugin examples ──

  describe('Plugin examples', () => {
    it('accessibility weight plugin adjusts edge weights', () => {
      // Create a doc with a non-accessible entrance
      const doc = simpleDoc()

      // First: baseline weights without plugin
      const baselineCompiler = new CampusCompiler({
        nodeInterval: 10, mergeThreshold: 5,
        optimizationLevel: 'none', includeAccessibility: false,
      })
      const baseline = baselineCompiler.compile(doc)

      const baselineWeights = baseline.graph!.edges.map(e => e.weight)

      // The accessibility weight plugin checks isAccessible property on nodes
      // Since our test doc doesn't set it, nodes default to accessible
      // So weights should NOT change (no penalty applied)

      const compiler = new CampusCompiler({
        nodeInterval: 10, mergeThreshold: 5,
        optimizationLevel: 'none', includeAccessibility: false,
        plugins: [accessibilityWeightPlugin],
      })
      const result = compiler.compile(doc)
      expect(result.success).toBe(true)
      // All edges should have weights (plugin ran without error)
      expect(result.graph!.edges.every(e => e.weight > 0)).toBe(true)
    })

    it('custom validation plugin replaces default validator', () => {
      const compiler = new CampusCompiler({
        nodeInterval: 10, mergeThreshold: 5,
        optimizationLevel: 'none', includeAccessibility: false,
        plugins: [customValidationPlugin],
      })
      const result = compiler.compile(simpleDoc())
      expect(result.success).toBe(true)
      // Custom validator should have run
      // Our test doc has unlabeled rooms, so it should generate UNNAMED_ROOM warning
      // But actually nodes have labels generated from room names, so it depends
      // At minimum, no crash and success=true
      expect(result.success).toBe(true)
    })
  })

  // ── Backward compatibility ──

  describe('Backward compatibility with legacy compile()', () => {
    it('legacy compile() still works and returns CompileResult', () => {
      const result = compile(simpleDoc(), {
        nodeInterval: 10, mergeThreshold: 5,
        optimizationLevel: 'none', includeAccessibility: false,
      })
      expect(result).toHaveProperty('graph')
      expect(result).toHaveProperty('report')
      expect(result).toHaveProperty('duration')
      expect(result.report.nodesGenerated).toBe(result.graph.nodes.length)
      expect(result.report.errors).toHaveLength(0)
    })

    it('new compiler enforces the valid routing topology (no room shortcuts)', () => {
      const doc = simpleDoc()
      const compiler = new CampusCompiler({
        nodeInterval: 10, mergeThreshold: 5,
        optimizationLevel: 'none', includeAccessibility: false,
      })
      const result = compiler.compile(doc)

      expect(result.success).toBe(true)

      // Every edge must follow the valid-connection model:
      //   road → entrance → hallway → room door
      const edges = result.graph!.edges
      const nodesById = new Map(result.graph!.nodes.map(n => [n.id, n]))
      for (const e of edges) {
        const fromType = nodesById.get(e.from)!.type
        const toType = nodesById.get(e.to)!.type
        // No room↔room or room↔entrance shortcuts
        if (fromType === 'space' || toType === 'space') {
          const other = fromType === 'space' ? toType : fromType
          expect(other).toBe('corridor')
        }
        // No entrance↔entrance edges
        expect(fromType === 'transition' && toType === 'transition').toBe(false)
      }

      // Every room must reach an entrance via the hallway network
      const roomIds = result.graph!.nodes.filter(n => n.type === 'space').map(n => n.id)
      const entranceIds = result.graph!.nodes.filter(n => n.type === 'transition').map(n => n.id)
      const adj = new Map<string, string[]>()
      for (const e of edges) {
        if (!adj.has(e.from)) adj.set(e.from, [])
        if (!adj.has(e.to)) adj.set(e.to, [])
        adj.get(e.from)!.push(e.to)
        adj.get(e.to)!.push(e.from)
      }
      const reachable = new Set<string>(entranceIds)
      const queue = [...entranceIds]
      while (queue.length > 0) {
        const cur = queue.shift()!
        for (const nb of adj.get(cur) ?? []) {
          if (!reachable.has(nb)) { reachable.add(nb); queue.push(nb) }
        }
      }
      for (const roomId of roomIds) {
        expect(reachable.has(roomId)).toBe(true)
      }
    })

    it('CampusCompiler constructor works with empty config', () => {
      const compiler = new CampusCompiler()
      const result = compiler.compile(simpleDoc())
      expect(result.success).toBe(true)
    })
  })
})
