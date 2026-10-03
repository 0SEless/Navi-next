import { readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { createHash } from 'crypto'

const EXPECTED_SCHEMA = '1.0'
const EXPECTED_COMPILER = '0.1.0'

interface Validation {
  check: string
  status: 'PASS' | 'FAIL' | 'WARN'
  detail?: string
}

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

function validateDirectory(dir: string): Validation[] {
  const results: Validation[] = []

  if (!existsSync(dir)) {
    results.push({ check: 'Directory exists', status: 'FAIL', detail: `${dir} not found` })
    return results
  }

  results.push({ check: 'Directory exists', status: 'PASS' })

  // manifest.json
  const manifestPath = join(dir, 'manifest.json')
  if (!existsSync(manifestPath)) {
    results.push({ check: 'manifest.json exists', status: 'FAIL' })
    return results
  }
  results.push({ check: 'manifest.json exists', status: 'PASS' })

  let manifest: any
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    results.push({ check: 'manifest.json is valid JSON', status: 'PASS' })
  } catch {
    results.push({ check: 'manifest.json is valid JSON', status: 'FAIL', detail: 'Parse error' })
    return results
  }

  // Schema version
  if (String(manifest.schemaVersion) === EXPECTED_SCHEMA) {
    results.push({ check: `Schema version = ${EXPECTED_SCHEMA}`, status: 'PASS' })
  } else {
    results.push({ check: `Schema version = ${EXPECTED_SCHEMA}`, status: 'FAIL', detail: `Got ${manifest.schemaVersion}` })
  }

  // Compiler version
  if (manifest.compilerVersion === EXPECTED_COMPILER) {
    results.push({ check: `Compiler version = ${EXPECTED_COMPILER}`, status: 'PASS' })
  } else {
    results.push({ check: `Compiler version = ${EXPECTED_COMPILER}`, status: 'WARN', detail: `Got ${manifest.compilerVersion}` })
  }

  // Required fields
  const required = ['campusId', 'campusName', 'publishedAt', 'revision', 'compilerVersion']
  for (const field of required) {
    if (manifest[field]) {
      results.push({ check: `manifest.${field} present`, status: 'PASS' })
    } else {
      results.push({ check: `manifest.${field} present`, status: 'FAIL' })
    }
  }

  // Artifact files
  const artifactKeys = ['graph', 'search', 'buildings', 'poi']
  for (const key of artifactKeys) {
    const artifact = manifest.artifacts?.[key]
    if (!artifact) {
      results.push({ check: `${key} in manifest`, status: 'FAIL' })
      continue
    }
    results.push({ check: `${key} in manifest`, status: 'PASS' })

    const filePath = join(dir, artifact.path)
    if (!existsSync(filePath)) {
      results.push({ check: `  ${artifact.path} exists`, status: 'FAIL' })
      continue
    }
    results.push({ check: `  ${artifact.path} exists`, status: 'PASS' })

    // Checksum
    const content = readFileSync(filePath, 'utf-8')
    const actualChecksum = sha256(content)
    if (actualChecksum === artifact.checksum) {
      results.push({ check: `  ${artifact.path} checksum`, status: 'PASS' })
    } else {
      results.push({ check: `  ${artifact.path} checksum`, status: 'FAIL', detail: `Expected ${artifact.checksum}, got ${actualChecksum}` })
    }

    // Size
    const actualSize = Buffer.byteLength(content, 'utf-8')
    if (actualSize === artifact.size) {
      results.push({ check: `  ${artifact.path} size`, status: 'PASS' })
    } else {
      results.push({ check: `  ${artifact.path} size`, status: 'WARN', detail: `Expected ${artifact.size}, got ${actualSize}` })
    }

    // Validate file content is parseable JSON
    try {
      JSON.parse(content)
      results.push({ check: `  ${artifact.path} valid JSON`, status: 'PASS' })
    } catch {
      results.push({ check: `  ${artifact.path} valid JSON`, status: 'FAIL' })
    }
  }

  return results
}

function main() {
  const dir = resolve(process.argv[2] || 'deploy/prod')

  console.log()
  console.log('='.repeat(60))
  console.log('  Release Validation')
  console.log('='.repeat(60))
  console.log(`  Target: ${dir}`)

  const results = validateDirectory(dir)

  console.log()
  console.log('─'.repeat(60))
  console.log('  Checks')
  console.log('─'.repeat(60))

  let pass = 0
  let fail = 0
  let warn = 0

  for (const r of results) {
    const icon = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : '⚠'
    if (r.status === 'PASS') pass++
    else if (r.status === 'FAIL') fail++
    else warn++
    console.log(`  ${icon} ${r.check}${r.detail ? ` — ${r.detail}` : ''}`)
  }

  console.log()
  console.log('─'.repeat(60))
  console.log(`  ${pass} passed, ${fail} failed, ${warn} warnings`)
  console.log(fail > 0 ? '  ✗ VALIDATION FAILED' : '  ✓ VALIDATION PASSED')
  console.log('='.repeat(60))
  console.log()

  process.exit(fail > 0 ? 1 : 0)
}

main()
