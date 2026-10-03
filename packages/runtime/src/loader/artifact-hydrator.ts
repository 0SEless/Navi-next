export type HydrateResult<T> = HydrateSuccess<T> | HydrateFailure

export interface HydrateSuccess<T> {
  readonly success: true
  readonly artifact: T
}

export interface HydrateFailure {
  readonly success: false
  readonly code: HydrateErrorCode
  readonly message: string
}

export type HydrateErrorCode = 'INVALID_JSON' | 'INVALID_SCHEMA' | 'UNSUPPORTED_VERSION'

export interface ArtifactValidator<T> {
  readonly artifactType: string
  readonly supportedSchemaVersion: string
  validate(data: unknown): data is T
}

export class ArtifactHydrator {
  async hydrate<T>(content: string, validator: ArtifactValidator<T>): Promise<HydrateResult<T>> {
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      return { success: false, code: 'INVALID_JSON', message: 'Failed to parse JSON' }
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return { success: false, code: 'INVALID_SCHEMA', message: 'Expected a JSON object' }
    }

    const obj = parsed as Record<string, unknown>

    if (typeof obj.schemaVersion !== 'string') {
      return { success: false, code: 'INVALID_SCHEMA', message: 'Missing or invalid schemaVersion' }
    }

    if (obj.schemaVersion !== validator.supportedSchemaVersion) {
      return { success: false, code: 'UNSUPPORTED_VERSION', message: `Expected schema version ${validator.supportedSchemaVersion}, got ${obj.schemaVersion}` }
    }

    if (!validator.validate(parsed)) {
      return { success: false, code: 'INVALID_SCHEMA', message: `${validator.artifactType} artifact failed schema validation` }
    }

    return { success: true, artifact: parsed as T }
  }
}
