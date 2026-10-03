export enum ValidationLevel {
  Editing = 'editing',
  Geometry = 'geometry',
  Navigation = 'navigation',
}

export interface ValidationIssue {
  level: ValidationLevel
  passed: boolean
  message?: string
  entityId?: string
  code?: string
}

export type Validator<T = unknown> = (context: T) => ValidationIssue | ValidationIssue[] | null

export interface ValidationResult {
  level: ValidationLevel
  issues: ValidationIssue[]
  readonly passed: boolean
}

function aggregate(level: ValidationLevel, results: (ValidationIssue | ValidationIssue[] | null)[]): ValidationResult {
  const issues: ValidationIssue[] = []
  for (const r of results) {
    if (r === null) continue
    if (Array.isArray(r)) {
      issues.push(...r)
    } else {
      issues.push(r)
    }
  }
  return {
    level,
    issues,
    get passed() { return issues.every(i => i.passed) },
  }
}

export function createValidationPipeline() {
  const editingValidators: Validator[] = []
  const geometryValidators: Validator[] = []
  const navigationValidators: Validator[] = []

  function register(level: ValidationLevel.Editing, validator: Validator): void
  function register(level: ValidationLevel.Geometry, validator: Validator): void
  function register(level: ValidationLevel.Navigation, validator: Validator): void
  function register(level: ValidationLevel, validator: Validator): void {
    switch (level) {
      case ValidationLevel.Editing:
        editingValidators.push(validator)
        break
      case ValidationLevel.Geometry:
        geometryValidators.push(validator)
        break
      case ValidationLevel.Navigation:
        navigationValidators.push(validator)
        break
    }
  }

  return {
    register,

    runEditing(context: unknown): ValidationResult {
      return aggregate(ValidationLevel.Editing, editingValidators.map(v => v(context)))
    },

    runGeometry(context: unknown): ValidationResult {
      return aggregate(ValidationLevel.Geometry, geometryValidators.map(v => v(context)))
    },

    runNavigation(context: unknown): ValidationResult {
      return aggregate(ValidationLevel.Navigation, navigationValidators.map(v => v(context)))
    },

    runAll(context: unknown): ValidationResult[] {
      return [
        this.runEditing(context),
        this.runGeometry(context),
        this.runNavigation(context),
      ]
    },

    clear(): void {
      editingValidators.length = 0
      geometryValidators.length = 0
      navigationValidators.length = 0
    },
  }
}

export type ValidationPipeline = ReturnType<typeof createValidationPipeline>
