'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { usePublicStore } from '@/store/public-store'
import { useHydrated } from '@/hooks/useHydrated'

interface PublicPreferencesSyncProps {
  children: ReactNode
}

const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)'

function readSystemDarkMode(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(SYSTEM_THEME_QUERY).matches
}

function subscribeToSystemTheme(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}

  const mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY)
  const handleChange = () => onChange()
  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener('change', handleChange)
  } else {
    mediaQuery.addListener?.(handleChange)
  }

  return () => {
    if (mediaQuery.removeEventListener) {
      mediaQuery.removeEventListener('change', handleChange)
    } else {
      mediaQuery.removeListener?.(handleChange)
    }
  }
}

function getServerSystemDarkMode(): boolean {
  return false
}

/**
 * Owns public-only theme and accessibility presentation state. Keeping the
 * attributes on the public shell prevents guest preferences from changing the
 * protected admin shell or the authored campus/runtime data.
 */
export function PublicPreferencesSync({ children }: PublicPreferencesSyncProps) {
  const theme = usePublicStore((state) => state.preferences.theme)
  const reducedMotion = usePublicStore((state) => state.preferences.accessibility.reducedMotion)
  const hydrated = useHydrated()
  const systemDarkMode = useSyncExternalStore(
    subscribeToSystemTheme,
    readSystemDarkMode,
    getServerSystemDarkMode,
  )

  const effectiveTheme = hydrated ? theme : 'system'
  const isDark = hydrated && (effectiveTheme === 'dark' || (effectiveTheme === 'system' && systemDarkMode))

  return (
    <div
      data-testid="public-shell"
      data-navi-public-shell="true"
      data-theme={isDark ? 'dark' : 'light'}
      data-theme-preference={effectiveTheme}
      data-reduced-motion={String(hydrated ? reducedMotion : false)}
      className="navi-public-shell flex min-h-dvh w-full min-w-0 flex-col overflow-x-hidden"
    >
      {children}
    </div>
  )
}
