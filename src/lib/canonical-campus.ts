export const DEFAULT_CANONICAL_CAMPUS_ID = 'map-map-1-repe'

/** Resolve the campus the User App treats as canonical for its initial load. */
export function getCanonicalCampusId(): string {
  const configuredCampusId = process.env.NEXT_PUBLIC_CANONICAL_CAMPUS_ID?.trim()
  return configuredCampusId || DEFAULT_CANONICAL_CAMPUS_ID
}
