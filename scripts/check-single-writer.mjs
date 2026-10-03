// Rendering Single-Writer Gate (ADR 006).
// Invariant: DrawingOverlay is the ONLY production component that writes to
// SRC.DRAWING. Any setData() targeting SRC.DRAWING outside DrawingOverlay
// (excluding dead *.legacy.* code) is a violation.
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const root = 'src'

function* walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) yield p
  }
}

const violations = []
for (const f of walk(root)) {
  if (f.includes('DrawingOverlay')) continue
  if (f.includes('.legacy.')) continue
  const src = readFileSync(f, 'utf8')
  if (/SRC\.DRAWING/.test(src) && /setData\s*\(/.test(src)) {
    violations.push(f)
  }
}

if (violations.length) {
  console.error('Rendering Single-Writer Gate FAILED — SRC.DRAWING.setData outside DrawingOverlay:')
  violations.forEach((v) => console.error('  ' + v))
  process.exit(1)
}
console.log('Rendering Single-Writer Gate PASSED — only DrawingOverlay writes SRC.DRAWING')
