'use client'

import { type ReactNode, useEffect, useRef } from 'react'
import { AdaptiveNav } from './AdaptiveNav'
import { SplashOnboarding } from './SplashOnboarding'
import { PublicPreferencesSync } from './PublicPreferencesSync'
import { usePublicStore, type TabId } from '@/store/public-store'
import { isSecondaryPublicPath, PRIMARY_NAV_ITEMS, PRIMARY_NAV_PATHS } from '@/lib/public-app-contracts'
import { usePathname, useRouter } from 'next/navigation'
import { NavigationMapHost, NavigationMapProvider } from '@/components/map/NavigationMap'
import PersistentCampusScene from '@/components/map/PersistentCampusScene'

const pathToTab: Record<string, TabId> = Object.fromEntries(
  PRIMARY_NAV_ITEMS.map((item) => [item.path, item.id]),
) as Record<string, TabId>

const tabToPath: Record<TabId, string> = PRIMARY_NAV_PATHS

interface AdaptiveShellProps {
  children: ReactNode
}

export function AdaptiveShell({ children }: AdaptiveShellProps) {
  const pathname = usePathname()
  const mapSurfaceActive = pathname === '/map/explore'
    || pathname.startsWith('/map/explore/')
    || pathname === '/map/navigate'
    || pathname.startsWith('/map/navigate/')
  const router = useRouter()
  const activeTab = usePublicStore((s) => s.activeTab)
  const setTab = usePublicStore((s) => s.setTab)
  const lastTabRef = useRef<TabId | null>(null)

  useEffect(() => {
    const matchedTab = Object.entries(pathToTab).find(([path]) =>
      pathname.startsWith(path)
    )
    if (matchedTab) {
      setTab(matchedTab[1])
    }
  }, [pathname, setTab])

  // Bootstrap campus data once so node-label resolution (recent destinations,
  // profile) works on every tab, not just search/explore/navigate.
  const fetchCampusData = usePublicStore((s) => s.fetchCampusData)
  useEffect(() => {
    void fetchCampusData()
  }, [fetchCampusData])

  // Redirect on nav clicks (tab changes), but never bounce nested pages
  // like /map/search which intentionally have no tab entry.
  useEffect(() => {
    const expectedPath = tabToPath[activeTab]
    if (!expectedPath) return
    const tabChanged = lastTabRef.current !== null && lastTabRef.current !== activeTab
    lastTabRef.current = activeTab
    if (!tabChanged) return
    if (isSecondaryPublicPath(pathname)) return
    if (pathname !== expectedPath && !pathname.startsWith(expectedPath)) {
      router.push(expectedPath)
    }
  }, [activeTab, pathname, router])

  return (
    <NavigationMapProvider active={mapSurfaceActive} surfaceKey={mapSurfaceActive ? pathname : null}>
      <PublicPreferencesSync>
        <SplashOnboarding />
        <div className="flex h-dvh w-full min-w-0 flex-col bg-[var(--navi-content)] lg:pl-56 pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
          <main className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto">
            <NavigationMapHost />
            <PersistentCampusScene />
            <div className="relative z-10 flex min-h-0 w-full min-w-0 flex-1 flex-col">
              {children}
            </div>
          </main>
        </div>
        <AdaptiveNav />
      </PublicPreferencesSync>
    </NavigationMapProvider>
  )
}
