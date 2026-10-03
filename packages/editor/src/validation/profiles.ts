import type { ValidationProfile, ValidationProfileId, ProfileConfig } from './rules/types'

const draftProfile: ValidationProfile = {
  id: 'draft',
  label: 'Draft',
  description: 'Fast — core errors only, no expensive checks',
  tolerances: {
    'geometry.overlapTolerance': 2.0,
    'geometry.zeroAreaThreshold': 0.5,
  },
  severityOverrides: {
    'zero-area-polygon': 'warning',
    'missing-name': 'info',
  },
}

const publishProfile: ValidationProfile = {
  id: 'publish',
  label: 'Publish',
  description: 'Complete — all standard rules before shipping',
  tolerances: {
    'geometry.overlapTolerance': 1.0,
    'geometry.zeroAreaThreshold': 0.1,
  },
}

const strictProfile: ValidationProfile = {
  id: 'strict',
  label: 'Strict',
  description: 'Complete + expensive — QA exhaustive',
  tolerances: {
    'geometry.overlapTolerance': 0.1,
    'geometry.zeroAreaThreshold': 0.01,
  },
  severityOverrides: {
    'missing-name': 'warning',
    'zero-area-polygon': 'error',
  },
}

const PROFILES: ReadonlyArray<ValidationProfile> = [draftProfile, publishProfile, strictProfile]

const PROFILE_MAP: ReadonlyMap<ValidationProfileId, ValidationProfile> = new Map(
  PROFILES.map(p => [p.id, p]),
)

export function getProfile(id: ValidationProfileId): ValidationProfile {
  const profile = PROFILE_MAP.get(id)
  if (!profile) {
    throw new Error(`Unknown validation profile: "${id}"`)
  }
  return profile
}

export function getProfiles(): ReadonlyArray<ValidationProfile> {
  return PROFILES
}

export function getDefaultProfile(): ValidationProfileId {
  return 'draft'
}

export function resolveConfig(
  profile: ValidationProfile,
  ruleDefaults?: Readonly<Record<string, number>>,
): ProfileConfig {
  const tolerances: Record<string, number> = { ...ruleDefaults }

  for (const [key, value] of Object.entries(profile.tolerances)) {
    tolerances[key] = value
  }

  return {
    tolerances: Object.freeze(tolerances),
    severityOverrides: Object.freeze({ ...profile.severityOverrides }),
  }
}
