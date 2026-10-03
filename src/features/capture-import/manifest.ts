export const CAPTURE_IMPORT_MANIFEST_SCHEMA_VERSION = 1 as const
export const CAPTURE_IMPORT_MANIFEST_STORAGE_KEY = 'navi-capture-import-manifest-v1'

export interface CaptureImportManifestEntry {
  captureSessionId: string
  captureRouteId: string
  captureSegmentId: string
  importBatchId: string
  canonicalRoadId: string
  campusId: string
  importedAt: string
}

export interface CaptureImportManifest {
  schemaVersion: typeof CAPTURE_IMPORT_MANIFEST_SCHEMA_VERSION
  imports: CaptureImportManifestEntry[]
}

export interface CaptureImportManifestStore {
  readonly key: string
  read(): CaptureImportManifest
  write(manifest: CaptureImportManifest): void
}

export interface CaptureImportStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid CaptureImportManifest: ${message}`)
}

function assertEntry(value: unknown, index: number): asserts value is CaptureImportManifestEntry {
  const field = `imports[${index}]`
  assert(isRecord(value), `${field} must be an object`)
  for (const name of [
    'captureSessionId',
    'captureRouteId',
    'captureSegmentId',
    'importBatchId',
    'canonicalRoadId',
    'campusId',
    'importedAt',
  ]) {
    assert(typeof value[name] === 'string' && value[name].length > 0, `${field}.${name} must be a non-empty string`)
  }
}

function assertManifest(value: unknown): asserts value is CaptureImportManifest {
  assert(isRecord(value), 'root must be an object')
  assert(value.schemaVersion === CAPTURE_IMPORT_MANIFEST_SCHEMA_VERSION, 'schemaVersion is unsupported')
  assert(Array.isArray(value.imports), 'imports must be an array')
  value.imports.forEach(assertEntry)
}

export function createEmptyCaptureImportManifest(): CaptureImportManifest {
  return { schemaVersion: CAPTURE_IMPORT_MANIFEST_SCHEMA_VERSION, imports: [] }
}

export function appendCaptureImportEntries(
  manifest: CaptureImportManifest,
  entries: CaptureImportManifestEntry[],
): CaptureImportManifest {
  assertManifest(manifest)
  entries.forEach((entry, index) => assertEntry(entry, manifest.imports.length + index))
  return clone({
    schemaVersion: CAPTURE_IMPORT_MANIFEST_SCHEMA_VERSION,
    imports: [...manifest.imports, ...entries],
  })
}

export function serializeCaptureImportManifest(manifest: CaptureImportManifest): string {
  assertManifest(manifest)
  return JSON.stringify(clone(manifest), null, 2)
}

export function parseCaptureImportManifest(text: string): CaptureImportManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Invalid CaptureImportManifest: JSON could not be parsed')
  }
  assertManifest(parsed)
  return clone(parsed)
}

function browserStorage(): CaptureImportStorage | undefined {
  if (typeof window === 'undefined' || !window.localStorage) return undefined
  return window.localStorage
}

export function createCaptureImportManifestStore(
  storage: CaptureImportStorage | undefined = browserStorage(),
): CaptureImportManifestStore {
  return {
    key: CAPTURE_IMPORT_MANIFEST_STORAGE_KEY,
    read() {
      if (!storage) return createEmptyCaptureImportManifest()
      try {
        const raw = storage.getItem(CAPTURE_IMPORT_MANIFEST_STORAGE_KEY)
        return raw ? parseCaptureImportManifest(raw) : createEmptyCaptureImportManifest()
      } catch {
        return createEmptyCaptureImportManifest()
      }
    },
    write(manifest) {
      if (!storage) return
      storage.setItem(CAPTURE_IMPORT_MANIFEST_STORAGE_KEY, serializeCaptureImportManifest(manifest))
    },
  }
}

export function createMemoryCaptureImportManifestStore(): CaptureImportManifestStore {
  let manifest = createEmptyCaptureImportManifest()
  return {
    key: CAPTURE_IMPORT_MANIFEST_STORAGE_KEY,
    read: () => clone(manifest),
    write(next) {
      assertManifest(next)
      manifest = clone(next)
    },
  }
}

export function hasImportedCaptureSegment(
  manifest: CaptureImportManifest,
  source: Pick<CaptureImportManifestEntry, 'captureSessionId' | 'captureRouteId' | 'captureSegmentId'>,
): boolean {
  return manifest.imports.some((entry) => (
    entry.captureSessionId === source.captureSessionId
    && entry.captureRouteId === source.captureRouteId
    && entry.captureSegmentId === source.captureSegmentId
  ))
}
