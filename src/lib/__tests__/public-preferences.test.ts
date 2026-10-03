import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PUBLIC_PREFERENCES,
  PUBLIC_PREFERENCES_STORAGE_KEY,
  loadPublicPreferences,
  mergePublicPreferences,
  savePublicPreferences,
} from '../public-preferences'

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(seed))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
    clear: () => { values.clear() },
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() { return values.size },
  }
}

describe('public preference contract', () => {
  it('provides safe defaults and merges only supported values', () => {
    const input = {
      theme: 'dark',
      mapAppearance: 'navi',
      notifications: false,
      navigation: {
        defaultMapView: 'pov',
        voiceGuidance: false,
        autoFloorSwitching: false,
        headingFollow: true,
      },
      accessibility: { reducedMotion: true },
    }
    const snapshot = JSON.stringify(input)

    expect(mergePublicPreferences(input)).toEqual(input)
    expect(JSON.stringify(input)).toBe(snapshot)
    expect(mergePublicPreferences({
      theme: 'invalid',
      mapAppearance: 'invalid',
      navigation: { defaultMapView: 'invalid' },
      accessibility: { reducedMotion: 'yes' },
    })).toEqual(DEFAULT_PUBLIC_PREFERENCES)
  })

  it('round-trips preferences through one guest-safe storage record', () => {
    const storage = memoryStorage()
    const preferences = mergePublicPreferences({
      theme: 'light',
      mapAppearance: 'uniform',
      notifications: false,
      navigation: { defaultMapView: 'follow' },
      accessibility: { reducedMotion: true },
    })

    savePublicPreferences(preferences, storage)

    expect(storage.getItem(PUBLIC_PREFERENCES_STORAGE_KEY)).not.toBeNull()
    expect(loadPublicPreferences(storage)).toEqual(preferences)
  })

  it('falls back to defaults for malformed storage and supports legacy settings', () => {
    const malformed = memoryStorage({
      [PUBLIC_PREFERENCES_STORAGE_KEY]: '{not-json',
      'navi-dark-mode': 'true',
      'navi-notifications': 'false',
    })

    expect(loadPublicPreferences(malformed)).toEqual({
      ...DEFAULT_PUBLIC_PREFERENCES,
      theme: 'dark',
      notifications: false,
    })
  })

  it('does not reuse or mutate nested default objects', () => {
    const first = mergePublicPreferences({})
    const second = mergePublicPreferences({})

    expect(first).toEqual(DEFAULT_PUBLIC_PREFERENCES)
    expect(first).not.toBe(DEFAULT_PUBLIC_PREFERENCES)
    expect(first.navigation).not.toBe(second.navigation)
    first.navigation.defaultMapView = 'follow'
    expect(second.navigation.defaultMapView).toBe(DEFAULT_PUBLIC_PREFERENCES.navigation.defaultMapView)
  })
})
