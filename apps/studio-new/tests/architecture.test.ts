/**
 * Architectural Invariant Tests — Studio Core (Milestone M1)
 *
 * These tests do NOT test functionality.
 * They test ARCHITECTURE — ensuring module boundaries stay intact.
 *
 * If one of these fails six months from now, it's a sign of
 * architectural drift, not a bug in the code.
 *
 * ── Invariants ──────────────────────────────────────────────────
 *
 * Mutation:
 *   CampusDocument cannot change except through CommandBus.
 *
 * Selection:
 *   SelectionManager never imports MapLibre.
 *
 * Renderer:
 *   EntityRenderer never imports NavigationGraph types.
 *
 * Compiler:
 *   CompilerService never imports React or components.
 *
 * Dependency chain:
 *   Inspector → InspectorController → CommandBus (never skip link)
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { describe, it, expect } from 'vitest'

const ROOT = resolve(__dirname, '..')

function read(file: string): string {
  const p = resolve(ROOT, file)
  if (!existsSync(p)) {
    throw new Error(`File not found: ${p}`)
  }
  return readFileSync(p, 'utf-8')
}

function stripComments(code: string): string {
  return code
    .replace(/\/\/.*$/gm, '')       // single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // multi-line comments
}

// ── Selection invariant ─────────────────────────────────────────

describe('SelectionManager', () => {
  const source = stripComments(read('lib/selection/selection-manager.ts'))

  it('never imports maplibre-gl', () => {
    expect(source).not.toMatch(/from\s+['"]maplibre-gl['"]/)
  })

  it('never imports MapLibre types', () => {
    expect(source).not.toMatch(/maplibregl/)
  })

  it('never imports from commands/', () => {
    expect(source).not.toMatch(/from\s+['"]\.\.\/commands/)
  })

  it('never imports from components/', () => {
    expect(source).not.toMatch(/components\//)
  })

  it('never imports CampusDocument', () => {
    // SelectionManager should only know about EntityRef, not the full document
    expect(source).not.toMatch(/CampusDocument/)
  })
})

// ── Renderer invariant ──────────────────────────────────────────

describe('EntityRenderer', () => {
  const source = stripComments(read('lib/entity-renderer.ts'))

  it('never imports @navi/compiler', () => {
    expect(source).not.toMatch(/@navi\/compiler/)
  })

  it('never imports NavigationGraph', () => {
    expect(source).not.toMatch(/NavigationGraph/)
  })

  it('never imports NavNode or NavEdge', () => {
    expect(source).not.toMatch(/\bNavNode\b/)
    expect(source).not.toMatch(/\bNavEdge\b/)
  })

  it('never imports from selection/', () => {
    expect(source).not.toMatch(/selection\//)
  })

  it('never imports from commands/', () => {
    expect(source).not.toMatch(/commands\//)
  })
})

// ── Compiler invariant ──────────────────────────────────────────

describe('CompilerService', () => {
  const source = stripComments(read('lib/compiler-service.ts'))

  it('never imports React', () => {
    expect(source).not.toMatch(/['"]react['"]/)
  })

  it('never imports from components/', () => {
    expect(source).not.toMatch(/components\//)
  })

  it('never imports from selection/', () => {
    expect(source).not.toMatch(/selection\//)
  })

  it('never imports from commands/', () => {
    expect(source).not.toMatch(/commands\//)
  })

  it('never imports maplibre-gl', () => {
    expect(source).not.toMatch(/maplibre-gl/)
  })
})

// ── NavigationGraphRenderer invariant ───────────────────────────

describe('NavigationGraphRenderer', () => {
  const source = stripComments(read('lib/navigation-graph-renderer.ts'))

  it('never imports CampusDocument', () => {
    expect(source).not.toMatch(/CampusDocument/)
  })

  it('never imports @navi/core', () => {
    expect(source).not.toMatch(/@navi\/core/)
  })

  it('never imports from selection/', () => {
    expect(source).not.toMatch(/selection\//)
  })

  it('never imports from commands/', () => {
    expect(source).not.toMatch(/commands\//)
  })

  it('only uses navg-* layer namespace', () => {
    // Verify it never references navi- layers (which belong to EntityRenderer)
    const lines = source.split('\n').filter(l => l.includes('navi-'))
    // Exception: checking for "navg-" in the string is fine
    const naviRefs = lines.filter(l => !l.includes('navg-') && !l.includes('//'))
    expect(naviRefs.length).toBe(0)
  })
})

// ── HighlightOverlay invariant ──────────────────────────────────

describe('HighlightOverlay', () => {
  const source = stripComments(read('lib/selection/highlight-overlay.ts'))

  it('never imports from commands/', () => {
    expect(source).not.toMatch(/commands\//)
  })

  it('never modifies SelectionManager', () => {
    // Should never call .select or .clear on the manager
    // (reads via .onChange and .selected only)
    const mutationCalls = source.match(/\.(select|clear|selectBy)\(/g)
    const allowedReads = source.match(/\.(selected|onChange)\(/g)
    // The only calls to the manager should be reads + onChange subscribe
    // The init() method reads .selected (allowed)
    expect(mutationCalls || []).toHaveLength(0)
  })
})

// ── Inspector dependency chain invariant ────────────────────────

describe('Inspector (components/Inspector.tsx)', () => {
  const source = stripComments(read('components/Inspector.tsx'))

  it('never imports CommandBus directly', () => {
    expect(source).not.toMatch(/command-bus/)
  })

  it('never imports entity handlers directly', () => {
    expect(source).not.toMatch(/entity-handlers/)
  })

  it('never imports maplibre-gl', () => {
    expect(source).not.toMatch(/maplibre-gl/)
  })

  it('imports from inspector-controller, not command-bus', () => {
    // Must go through controller
    expect(source).toMatch(/inspector-controller/)
  })
})

// ── InspectorController dependency chain invariant ──────────────

describe('InspectorController (lib/commands/inspector-controller.ts)', () => {
  const source = stripComments(read('lib/commands/inspector-controller.ts'))

  it('imports CommandBus but not its handlers', () => {
    expect(source).toMatch(/command-bus/)
    expect(source).not.toMatch(/entity-handlers/)
  })

  it('never imports maplibre-gl', () => {
    expect(source).not.toMatch(/maplibre-gl/)
  })

  it('never imports React', () => {
    expect(source).not.toMatch(/['"]react['"]/)
  })
})

// ── Mutation invariant ──────────────────────────────────────────

describe('Mutation path', () => {
  it('entity handlers are the ONLY module that mutates document buildings', () => {
    // Check each module to ensure they don't mutate buildings/roads directly
    const modules: Array<[string, string]> = [
      ['lib/entity-renderer.ts', 'EntityRenderer'],
      ['lib/compiler-service.ts', 'CompilerService'],
      ['lib/navigation-graph-renderer.ts', 'NavGraphRenderer'],
      ['lib/selection/selection-manager.ts', 'SelectionManager'],
      ['lib/selection/highlight-overlay.ts', 'HighlightOverlay'],
      ['components/Inspector.tsx', 'Inspector'],
    ]

    for (const [file, name] of modules) {
      const source = read(file)
      // These modules should call sync() or read, but never push/splice/assign to document arrays
      // Checking for document-level mutation patterns only (not local array .push())
      const mutationLines = source
        .split('\n')
        .filter(l =>
          l.includes('.buildings =') ||
          l.includes('.roads =') ||
          l.includes('.buildings.push') ||
          l.includes('.roads.push') ||
          l.includes('.buildings.splice') ||
          l.includes('.roads.splice') ||
          l.includes('doc.version++') ||
          l.includes('document.version++') ||
          l.includes('ctx.document')
        )
        // Allow sync/setData patterns which are MapLibre mutations, not document mutations
        .filter(l => !l.includes('setData'))
        .filter(l => !l.includes('.sync('))

      expect(mutationLines, `${name} (${file}) should not mutate document directly`).toHaveLength(0)
    }
  })
})

// ── Import boundary summary ─────────────────────────────────────

describe('Architecture summary', () => {
  it('all critical modules exist', () => {
    const files = [
      'lib/persistence.ts',
      'lib/entity-renderer.ts',
      'lib/compiler-service.ts',
      'lib/navigation-graph-renderer.ts',
      'lib/selection/selection-manager.ts',
      'lib/selection/hit-test.ts',
      'lib/selection/highlight-overlay.ts',
      'lib/commands/command-bus.ts',
      'lib/commands/entity-handlers.ts',
      'lib/commands/inspector-controller.ts',
      'components/Inspector.tsx',
      'components/MapCanvas.tsx',
    ]
    for (const f of files) {
      expect(existsSync(resolve(ROOT, f)), `Missing module: ${f}`).toBe(true)
    }
  })
})
