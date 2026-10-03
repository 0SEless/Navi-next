import {
  DEFAULT_MAP_APPEARANCE,
  type MapAppearanceMode,
} from '@/lib/public-app-contracts'

export type ThemePreference = 'system' | 'light' | 'dark'
export type NavigationMapView = 'top' | 'follow' | 'pov'

export interface NavigationPreferences {
  defaultMapView: NavigationMapView
  voiceGuidance: boolean
  autoFloorSwitching: boolean
  headingFollow: boolean
}

export interface AccessibilityPreferences {
  reducedMotion: boolean
}

export interface PublicPreferences {
  theme: ThemePreference
  mapAppearance: MapAppearanceMode
  notifications: boolean
  navigation: NavigationPreferences
  accessibility: AccessibilityPreferences
}

export const DEFAULT_PUBLIC_PREFERENCES: PublicPreferences = {
  theme: 'system',
  mapAppearance: DEFAULT_MAP_APPEARANCE,
  notifications: true,
  navigation: {
    defaultMapView: 'top',
    voiceGuidance: true,
    autoFloorSwitching: true,
    headingFollow: false,
  },
  accessibility: {
    reducedMotion: false,
  },
}

export const PUBLIC_PREFERENCES_STORAGE_KEY = 'navi-public-preferences'

const LEGACY_DARK_MODE_KEY = 'navi-dark-mode'
const LEGACY_NOTIFICATIONS_KEY = 'navi-notifications'

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getStorage(storage?: PreferenceStorage | null): PreferenceStorage | null {
  if (storage) return storage
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isTheme(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}

function isMapAppearance(value: unknown): value is MapAppearanceMode {
  return value === 'department' || value === 'navi' || value === 'uniform'
}

function isNavigationMapView(value: unknown): value is NavigationMapView {
  return value === 'top' || value === 'follow' || value === 'pov'
}

/**
 * Normalize an unknown persisted value into a fresh, supported preference
 * object. This is deliberately presentation-only and never mutates input.
 */
export function mergePublicPreferences(input: unknown): PublicPreferences {
  const raw = isRecord(input) ? input : {}
  const rawNavigation = isRecord(raw.navigation) ? raw.navigation : {}
  const rawAccessibility = isRecord(raw.accessibility) ? raw.accessibility : {}

  return {
    theme: isTheme(raw.theme) ? raw.theme : DEFAULT_PUBLIC_PREFERENCES.theme,
    mapAppearance: isMapAppearance(raw.mapAppearance)
      ? raw.mapAppearance
      : DEFAULT_PUBLIC_PREFERENCES.mapAppearance,
    notifications: typeof raw.notifications === 'boolean'
      ? raw.notifications
      : DEFAULT_PUBLIC_PREFERENCES.notifications,
    navigation: {
      defaultMapView: isNavigationMapView(rawNavigation.defaultMapView)
        ? rawNavigation.defaultMapView
        : DEFAULT_PUBLIC_PREFERENCES.navigation.defaultMapView,
      voiceGuidance: typeof rawNavigation.voiceGuidance === 'boolean'
        ? rawNavigation.voiceGuidance
        : DEFAULT_PUBLIC_PREFERENCES.navigation.voiceGuidance,
      autoFloorSwitching: typeof rawNavigation.autoFloorSwitching === 'boolean'
        ? rawNavigation.autoFloorSwitching
        : DEFAULT_PUBLIC_PREFERENCES.navigation.autoFloorSwitching,
      headingFollow: typeof rawNavigation.headingFollow === 'boolean'
        ? rawNavigation.headingFollow
        : DEFAULT_PUBLIC_PREFERENCES.navigation.headingFollow,
    },
    accessibility: {
      reducedMotion: typeof rawAccessibility.reducedMotion === 'boolean'
        ? rawAccessibility.reducedMotion
        : DEFAULT_PUBLIC_PREFERENCES.accessibility.reducedMotion,
    },
  }
}

/** Load preferences without allowing malformed guest storage to break the app. */
export function loadPublicPreferences(storage?: PreferenceStorage | null): PublicPreferences {
  const target = getStorage(storage)
  if (!target) return mergePublicPreferences(null)

  let parsed: unknown = null
  try {
    const raw = target.getItem(PUBLIC_PREFERENCES_STORAGE_KEY)
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    parsed = null
  }

  const raw = isRecord(parsed) ? parsed : {}
  const preferences = mergePublicPreferences(raw)

  // Preserve settings from older public sessions when the new record does not
  // contain the corresponding field. This migration remains local-only.
  try {
    if (raw.theme === undefined) {
      const legacyDarkMode = target.getItem(LEGACY_DARK_MODE_KEY)
      if (legacyDarkMode === 'true') preferences.theme = 'dark'
      if (legacyDarkMode === 'false') preferences.theme = 'light'
    }
    if (raw.notifications === undefined) {
      const legacyNotifications = target.getItem(LEGACY_NOTIFICATIONS_KEY)
      if (legacyNotifications === 'true') preferences.notifications = true
      if (legacyNotifications === 'false') preferences.notifications = false
    }
  } catch {
    // Local storage is optional; defaults are already safe.
  }

  return preferences
}

/** Persist only the validated primitive preference record. */
export function savePublicPreferences(
  preferences: PublicPreferences,
  storage?: PreferenceStorage | null,
): void {
  const target = getStorage(storage)
  if (!target) return
  try {
    target.setItem(
      PUBLIC_PREFERENCES_STORAGE_KEY,
      JSON.stringify(mergePublicPreferences(preferences)),
    )
  } catch {
    // Guest preferences are best effort and must never block navigation.
  }
}
