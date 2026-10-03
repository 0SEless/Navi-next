'use client'

import { useMemo } from 'react'
import { DiagnosticEngine } from './engine'
import type { EngineOptions, EngineResult } from './diagnostic-types'

export function useDiagnostics(document: any, options?: EngineOptions): EngineResult {
  return useMemo(() => DiagnosticEngine.run(document, options), [document, options])
}
