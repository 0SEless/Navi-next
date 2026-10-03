import { describe, it, expect } from 'vitest'
import type { LoadedPackage, LoadResult, LoadReport, LoadFailure, LoadErrorCode } from '../types'
import { load } from '../loader'

describe('Loader types', () => {
  it('loaded package has required fields', () => {
    const pkg: LoadedPackage = {
      manifest: null as unknown as LoadedPackage['manifest'],
      graph: null as unknown as LoadedPackage['graph'],
      reports: [],
      warnings: [],
    }
    expect(pkg.reports).toEqual([])
  })

  it('load result discriminates correctly', () => {
    const success: LoadReport = {
      success: true,
      package: null as unknown as LoadedPackage,
      durationMs: 100,
    }
    const failure: LoadFailure = {
      success: false,
      code: 'PACKAGE_NOT_FOUND',
      message: 'not found',
      durationMs: 50,
    }
    function handle(r: LoadResult): string {
      if (r.success) return `loaded in ${r.durationMs}ms`
      return `error: ${r.code}`
    }
    expect(handle(success)).toBe('loaded in 100ms')
    expect(handle(failure)).toBe('error: PACKAGE_NOT_FOUND')
    // success is not enumerable in discriminated union
    const failures: LoadFailure[] = [failure]
    expect(failures).toHaveLength(1)
  })

  it('load error code contains only approved values', () => {
    const codes: LoadErrorCode[] = [
      'PACKAGE_NOT_FOUND',
      'MISSING_MANIFEST',
      'INVALID_MANIFEST',
      'CHECKSUM_MISMATCH',
      'INVALID_SCHEMA',
      'INVALID_REFERENCE',
      'IO_ERROR',
      // P1-T11 (R11.2): unsupported major schemaVersion rejection
      'UNSUPPORTED_SCHEMA_VERSION',
    ]
    expect(codes).toHaveLength(8)
  })

  it('exported load() returns LoadFailure for nonexistent path', async () => {
    const result = await load('/packages/test-campus')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.code).toBe('MISSING_MANIFEST')
    }
  })
})
