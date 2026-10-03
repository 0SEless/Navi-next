#!/usr/bin/env node
/**
 * check-commit-consistency.mjs — pre-deploy gate for navi-next.
 *
 * Prevents the 2026-09-27 production outage class: shipping a ref whose
 * runtime code depends on files/symbols that are not part of the ref
 * (uncommitted/untracked), which `next build` cannot catch because
 * next.config.ts sets `typescript.ignoreBuildErrors: true`.
 *
 * Scan set: tracked files under src/ and packages/ excluding tests.
 * Everything else (scripts/, root __tests__/, apps/) is reported as WARN only.
 *
 * CHECK1: every relative import in the scan set resolves to a tracked file at <ref>.
 * CHECK2: every useGraphStore.getState().<m> / nextState.<m> / prevState.<m> call
 *         in scan set exists in committed src/store/graph-store.ts impl body.
 * CHECK3: workspace imports (@navi/*) resolve to tracked package file/package.json.
 * CHECK4: named VALUE imports from @navi/* are provably exported (BFS over the
 *         package entry's export graph). Type-only imports are WARN (erased at runtime).
 *
 * Usage: node scripts/check-commit-consistency.mjs [ref]   (default HEAD)
 * Exit 0 = consistent, 1 = FAIL violations, 2 = tooling error.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const REF = process.argv[2] || 'HEAD'
const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })

const SRC_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const RESOLVE_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']
const RESOLVE_INDEX = ['index.ts', 'index.tsx', 'index.js', 'index.mjs']
const TEST_RE = /(^|\/)(__tests__|__mocks__|e2e)(\/|$)|\.(test|spec)\.[tj]sx?$/

const fails = []
const warns = []

function inScanSet(p) {
  if (TEST_RE.test(p)) return false
  return p.startsWith('src/') || p.startsWith('packages/')
}

function trackedFileAt(base) {
  const candidates = [
    ...RESOLVE_EXT.map((ext) => base + ext),
    ...RESOLVE_INDEX.map((idx) => path.posix.join(base, idx)),
    base + '/package.json',
  ]
  return candidates.find((c) => tracked.has(c)) || null
}

// ---- tracked tree ------------------------------------------------------------
let tracked
try {
  tracked = new Set(
    git('ls-tree', '-r', '--name-only', REF)
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  )
} catch (e) {
  console.error(`FATAL: cannot list tree for ${REF}: ${e.message}`)
  process.exit(2)
}

// ---- gather source content ---------------------------------------------------
function grepRows(pattern, paths) {
  let out = ''
  try {
    out = git('grep', '-nE', pattern, REF, '--', ...paths)
  } catch (e) {
    out = e.stdout || ''
  }
  const rows = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split(':')
    if (parts[0] !== REF || parts.length < 4) continue
    rows.push({ file: parts[1], line: parts[2], content: parts.slice(3).join(':') })
  }
  return rows
}

const importRows = grepRows(
  "from ['\"]|import\\(['\"]|require\\(['\"]",
  ['src', 'packages', 'scripts', 'app', 'apps', '__tests__', '*.ts', '*.tsx'],
)

// content cache for full-file parses (only files we need deeply)
const fileCache = new Map()
function fileAt(p) {
  if (fileCache.has(p)) return fileCache.get(p)
  let src = ''
  try {
    src = git('show', `${REF}:${p}`)
  } catch {
    src = null
  }
  fileCache.set(p, src)
  return src
}

// ---- CHECK1: relative imports ------------------------------------------------
const relRe = /(?:from\s+['"]|import\(\s*['"]|require\(\s*['"])(\.{1,2}\/[^'"]+)['"]/g
const workspaceImporters = new Set()
for (const { file, content } of importRows) {
  if (!SRC_EXT.test(file)) continue
  let m
  relRe.lastIndex = 0
  while ((m = relRe.exec(content)) !== null) {
    const base = path.posix.join(path.posix.dirname(file), m[1])
    if (trackedFileAt(base)) continue
    const msg = `${file}: unresolved relative import '${m[1]}' — target not in ${REF}`
    if (inScanSet(file)) fails.push(`CHECK1 ${msg}`)
    else warns.push(`CHECK1(warn) ${msg}`)
  }
  if (/from\s+['"]@navi\//.test(content)) workspaceImporters.add(file)
}
// multiline imports can hide workspace deps: re-scan full scan-set files for @navi
for (const p of tracked) {
  if (!inScanSet(p) || !SRC_EXT.test(p)) continue
  const src = fileAt(p)
  if (src && /from\s+['"]@navi\//.test(src)) workspaceImporters.add(p)
}

// ---- CHECK2: graph-store API -------------------------------------------------
const defs = new Set()
let storeSrc = fileAt('src/store/graph-store.ts')
if (!storeSrc) {
  fails.push(`CHECK2 src/store/graph-store.ts missing at ${REF}`)
} else {
  const anchor = storeSrc.indexOf('useGraphStore = create')
  if (anchor === -1) {
    fails.push(`CHECK2 cannot find create() impl body in graph-store.ts at ${REF}`)
  } else {
    for (const line of storeSrc.slice(anchor).split('\n')) {
      const k = line.match(/^ {2}([A-Za-z0-9_]+)\s*[:(]/)
      if (k) defs.add(k[1])
    }
  }
}
const callerRows = grepRows(
  'useGraphStore\\.getState\\(\\)\\.[A-Za-z0-9_]+|\\b(nextState|prevState)\\.[A-Za-z0-9_]+',
  ['src'],
)
const callerRe = /(?:useGraphStore\.getState\(\)\.|(?:nextState|prevState)\.)([A-Za-z0-9_]+)/g
const called = new Map()
for (const { file, line, content } of callerRows) {
  if (!inScanSet(file)) continue
  let m
  callerRe.lastIndex = 0
  while ((m = callerRe.exec(content)) !== null) {
    if (!called.has(m[1])) called.set(m[1], `${file}:${line}`)
  }
}
for (const [method, loc] of called) {
  if (!defs.has(method)) {
    fails.push(
      `CHECK2 ${loc}: calls useGraphStore.${method}() — NOT defined in committed graph-store.ts at ${REF} (outage class)`,
    )
  }
}

// ---- CHECK3 + CHECK4: workspace imports --------------------------------------
// Resolve a workspace specifier like '@navi/core', '@navi/runtime/engine',
// or '@navi/editor/src/geometry/room-derivation' the way Node/webpack would:
// package.json "exports" map first (if present), else package-root file resolution.
function pkgEntry(spec) {
  const parts = spec.split('/')
  const pkgName = parts.slice(0, 2).join('/') // @navi/<pkg>
  const rest = parts.slice(2).join('/') // subpath ('' for bare)
  const dir = 'packages/' + pkgName.replace('@navi/', '')
  const pjPath = `${dir}/package.json`
  if (!tracked.has(pjPath)) return { dir, error: `${pjPath} not tracked at ${REF}` }
  let pj
  try {
    pj = JSON.parse(git('show', `${REF}:${pjPath}`))
  } catch {
    return { dir, error: `${pjPath} unreadable` }
  }
  const resolveTarget = (target) => {
    if (typeof target !== 'string') return null
    const base = path.posix.join(dir, target.replace(/^\.\//, ''))
    return trackedFileAt(base.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, '')) || (tracked.has(base) ? base : null)
  }
  if (pj.exports) {
    const key = rest ? `./${rest}` : '.'
    let target = typeof pj.exports === 'object' && !Array.isArray(pj.exports) ? pj.exports[key] : undefined
    if (target === undefined && pj.exports && typeof pj.exports === 'object') {
      // wildcard patterns: "./*": "./src/*" etc.
      for (const [pat, val] of Object.entries(pj.exports)) {
        if (!pat.includes('*')) continue
        const rx = new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '(.*)') + '$')
        const mm = key.match(rx)
        if (mm && typeof val === 'string') {
          target = val.replace(/\*/g, mm[1])
          break
        }
      }
    }
    if (target && typeof target === 'object') target = target.import || target.default || target.require
    if (!target) return { dir, error: `${spec} not mapped in ${pjPath} exports at ${REF}` }
    const resolved = resolveTarget(target)
    if (!resolved) return { dir, error: `exports target for ${spec} not tracked at ${REF}` }
    return { dir, entry: resolved }
  }
  if (rest === '') {
    const entry = resolveTarget(pj.main || pj.module || './src/index.ts')
    if (!entry) return { dir, error: `no resolvable entry for ${pkgName} in ${pjPath}` }
    return { dir, entry }
  }
  const resolved = trackedFileAt(path.posix.join(dir, rest))
  if (resolved) return { dir, entry: resolved }
  if (tracked.has(path.posix.join(dir, rest, 'package.json')))
    return { dir, entry: path.posix.join(dir, rest, 'package.json') }
  return { dir, error: `${spec} does not resolve to a tracked file under ${dir} at ${REF}` }
}

// export graph BFS
const exportCache = new Map()
function exportsOf(file, seen = new Set()) {
  if (exportCache.has(file)) return exportCache.get(file)
  if (seen.has(file)) return new Set()
  seen.add(file)
  const src = fileAt(file)
  const names = new Set()
  if (!src) {
    exportCache.set(file, names)
    return names
  }
  const dir = path.posix.dirname(file)
  // export { a, b as c } from './x'  |  export type { ... } from './x'
  const braceRe = /export\s+(?:type\s+)?\{([^}]+)\}\s*from\s+['"]([^'"]+)['"]/g
  let m
  while ((m = braceRe.exec(src)) !== null) {
    const specs = m[1].split(',').map((s) => s.trim()).filter(Boolean)
    for (const s of specs) {
      const asMatch = s.match(/^(?:type\s+)?(?:[\w$]+\s+as\s+)?([\w$]+)$/)
      const name = asMatch ? asMatch[1] : s.split(/\s+as\s+/).pop().trim()
      if (name) names.add(name.replace(/^type\s+/, ''))
    }
    if (m[2].startsWith('.')) {
      const target = trackedFileAt(path.posix.join(dir, m[2]))
      if (target) for (const n of exportsOf(target, seen)) names.add(n)
    }
  }
  // export * from './x'
  const starRe = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g
  while ((m = starRe.exec(src)) !== null) {
    if (m[1].startsWith('.')) {
      const target = trackedFileAt(path.posix.join(dir, m[1]))
      if (target) for (const n of exportsOf(target, seen)) names.add(n)
    }
  }
  // export * as ns from './x'
  const nsRe = /export\s+\*\s+as\s+([\w$]+)\s+from\s+['"]([^'"]+)['"]/g
  while ((m = nsRe.exec(src)) !== null) names.add(m[1])
  // declarations: export const/function/class/interface/type/enum NAME
  const declRe = /export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|type|enum)\s+([\w$]+)/g
  while ((m = declRe.exec(src))) names.add(m[1])
  // export { a, b } (no from)
  const localBraceRe = /export\s+(?:type\s+)?\{([^}]+)\}(?!\s*from)/g
  while ((m = localBraceRe.exec(src)) !== null) {
    for (const s of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
      const name = s.includes(' as ') ? s.split(/\s+as\s+/).pop().trim() : s.replace(/^type\s+/, '')
      if (name) names.add(name)
    }
  }
  exportCache.set(file, names)
  return names
}

const pkgExportCache = new Map()
function pkgExports(pkgName) {
  if (pkgExportCache.has(pkgName)) return pkgExportCache.get(pkgName)
  const { entry, error } = pkgEntry(pkgName)
  if (error) {
    pkgExportCache.set(pkgName, { names: null, error })
    return pkgExportCache.get(pkgName)
  }
  const names = exportsOf(entry)
  pkgExportCache.set(pkgName, { names, error: null })
  return pkgExportCache.get(pkgName)
}

// import statement parser over full file content (multiline-safe)
const stmtRe = /import\s+(type\s+)?([^'";]+?)\s+from\s+['"](@navi\/[^'"]+)['"]/gs
for (const file of workspaceImporters) {
  if (!inScanSet(file)) continue
  const src = fileAt(file)
  if (!src) continue
  let m
  stmtRe.lastIndex = 0
  while ((m = stmtRe.exec(src)) !== null) {
    const typeOnly = Boolean(m[1])
    const clause = m[2].trim()
    const pkg = m[3]
    // namespace or default import: resolve module only
    if (/^\*\s+as\s+/.test(clause) || (!clause.startsWith('{') && !clause.startsWith('type'))) {
      // fall through to CHECK3 only
    }
    const braceMatch = clause.match(/^\{([^}]+)\}$/s) || clause.match(/\{([^}]+)\}/s)
    if (!braceMatch) continue
    const specs = braceMatch[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const isType = /^type\s+/.test(s)
        const cleaned = s.replace(/^type\s+/, '')
        const name = cleaned.includes(' as ') ? cleaned.split(/\s+as\s+/)[0].trim() : cleaned
        return { name, isType }
      })
      .filter((s) => /^[\w$]+$/.test(s.name))
    if (specs.length === 0) continue
    // CHECK3: package resolvable
    const { error } = pkgEntry(pkg)
    if (error) {
      const msg = `${file}: workspace import '${pkg}' — ${error}`
      if (inScanSet(file)) fails.push(`CHECK3 ${msg}`)
      else warns.push(`CHECK3(warn) ${msg}`)
      continue
    }
    // CHECK4: symbol exported
    const ex = pkgExports(pkg)
    if (ex.error) {
      fails.push(`CHECK4 ${file}: ${ex.error}`)
      continue
    }
    for (const s of specs) {
      if (ex.names.has(s.name)) continue
      const level = typeOnly || s.isType ? warns : fails
      level.push(
        `CHECK4 ${file}: imports ${s.isType || typeOnly ? 'type ' : ''}'${s.name}' from '${pkg}' — NOT exported at ${REF} (runtime ${s.isType || typeOnly ? 'safe (erased)' : 'undefined -> crash class'})`,
      )
    }
  }
}
// also resolve bare workspace module imports without named symbols (side-effect)
for (const file of workspaceImporters) {
  if (!inScanSet(file)) continue
  const src = fileAt(file)
  if (!src) continue
  const sideRe = /import\s+['"](@navi\/[^'"]+)['"]/g
  let m
  while ((m = sideRe.exec(src)) !== null) {
    const pkgParts = m[1].split('/')
    if (pkgParts.length === 2) {
      const { error } = pkgEntry(m[1])
      if (error) fails.push(`CHECK3 ${file}: side-effect import '${m[1]}' — ${error}`)
    }
  }
}

// ---- verdict -----------------------------------------------------------------
if (warns.length > 0) {
  console.log(`WARN: ${warns.length} non-blocking note(s):`)
  for (const w of warns) console.log('  ' + w)
  console.log('')
}
if (fails.length > 0) {
  console.error(`FAIL: ${fails.length} blocking consistency violation(s) at ${REF}\n`)
  for (const f of fails) console.error('  ' + f)
  process.exit(1)
}
console.log(
  `PASS: ${REF} deploy-consistent — ${tracked.size} tracked files, ${called.size} store methods, ${workspaceImporters.size} workspace importers checked`,
)
process.exit(0)
