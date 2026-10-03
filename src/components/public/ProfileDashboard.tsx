'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Accessibility,
  Bell,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock,
  Heart,
  Info,
  LogOut,
  Mail,
  Map,
  MapPin,
  Moon,
  Navigation,
  Palette,
  Search,
  Shield,
  Sun,
  Trash2,
  User,
  Volume2,
} from 'lucide-react'
import { usePublicStore } from '@/store/public-store'
import {
  type NavigationMapView,
  type ThemePreference,
} from '@/lib/public-preferences'
import { useAuth } from '@/hooks/useAuth'
import { useHydrated } from '@/hooks/useHydrated'
import { useNodeLabelResolver } from '@/hooks/useNodeLabel'

const FAVORITES_KEY = 'navi-favorites'

type PanelId = 'appearance' | 'navigation' | 'accessibility'

function loadFavorites(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function roleLabel(role: string): string {
  switch (role) {
    case 'super_admin': return 'Super Admin'
    case 'campus_admin': return 'Campus Admin'
    case 'mapping_staff': return 'Mapping Staff'
    case 'viewer': return 'Viewer'
    default: return role
  }
}

function roleClass(role: string): string {
  if (role === 'viewer') return 'bg-[var(--navi-primary-light)] text-[var(--navi-primary)]'
  return 'bg-[var(--navi-tint-blue)] text-[var(--navi-info)]'
}

export function ProfileDashboard() {
  const router = useRouter()
  const hydrated = useHydrated()
  const { user, isAuthenticated, logout } = useAuth()

  const recentSearches = usePublicStore((state) => state.recentSearches)
  const recentDestinations = usePublicStore((state) => state.recentDestinations)
  const currentCampusId = usePublicStore((state) => state.currentCampusId ?? state.campusData?.campusId)
  const defaultCampusId = usePublicStore((state) => state.defaultCampusId)
  const preferences = usePublicStore((state) => state.preferences)
  const setTheme = usePublicStore((state) => state.setTheme)
  const setMapAppearance = usePublicStore((state) => state.setMapAppearance)
  const setNotifications = usePublicStore((state) => state.setNotifications)
  const setNavigationPreferences = usePublicStore((state) => state.setNavigationPreferences)
  const setAccessibilityPreferences = usePublicStore((state) => state.setAccessibilityPreferences)
  const clearRecentDestinationsForCampus = usePublicStore((state) => state.clearRecentDestinations)
  const resolveNodeLabel = useNodeLabelResolver()

  const [favorites] = useState<string[]>(loadFavorites)
  const [openPanel, setOpenPanel] = useState<PanelId | null>(null)

  const isSignedIn = isAuthenticated && user !== null
  const displayName = user?.name ?? 'Guest account'
  const displayEmail = user?.email ?? 'Preferences stay on this device'
  const userRole = user?.role ?? 'viewer'

  const clearRecentSearches = () => {
    usePublicStore.setState({ recentSearches: [] })
    localStorage.removeItem('navi-recent-searches')
  }

  const clearRecentDestinations = () => {
    clearRecentDestinationsForCampus()
  }

  const handleLogout = async () => {
    try {
      await logout()
      router.push('/map/home')
    } catch {
      // Keep the public shell usable if the session service is unavailable.
    }
  }

  const togglePanel = (panel: PanelId) => {
    setOpenPanel((current) => current === panel ? null : panel)
  }

  if (!hydrated) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
        <div className="h-24 w-full animate-pulse rounded-3xl bg-[var(--navi-border)]/60" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-56 rounded-3xl bg-[var(--navi-border)]/40" />
          <div className="h-56 rounded-3xl bg-[var(--navi-border)]/40" />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-full w-full min-w-0 max-w-5xl flex-col px-4 pb-10 pt-5 sm:px-6 sm:pt-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--navi-primary)]">
            Student space
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--navi-text)]">Profile</h1>
          <p className="mt-1 max-w-xl text-sm leading-6 text-[var(--navi-text-secondary)]">
            Personalize NAVI for the way you move around campus.
          </p>
        </div>
        <div className="hidden shrink-0 items-center gap-2 rounded-full border border-[var(--navi-border)] bg-[var(--navi-card)] px-3 py-2 text-xs font-semibold text-[var(--navi-primary)] shadow-[var(--navi-shadow-sm)] sm:flex">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--navi-primary)] text-[10px] font-bold text-white">N</span>
          NAVI
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.08fr_.92fr] lg:items-start">
        <div className="space-y-4">
          <section className="overflow-hidden rounded-3xl border border-[var(--navi-border)] bg-[var(--navi-card)] shadow-[var(--navi-shadow-sm)]">
            <div className="flex items-start gap-4 p-5 sm:p-6">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--navi-primary)] text-lg font-bold text-white shadow-sm">
                {isSignedIn ? getInitials(displayName) : <User className="h-6 w-6" aria-hidden="true" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-lg font-semibold text-[var(--navi-text)]">{displayName}</h2>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${roleClass(userRole)}`}>
                    <Shield className="h-3 w-3" aria-hidden="true" />
                    {isSignedIn ? roleLabel(userRole) : 'Guest'}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-sm text-[var(--navi-text-secondary)]">
                  <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{displayEmail}</span>
                </div>
                {!isSignedIn && (
                  <p className="mt-3 max-w-md text-xs leading-5 text-[var(--navi-text-secondary)]">
                    Explore campus maps as a guest. Sign in only when you want to sync your preferences.
                  </p>
                )}
              </div>
            </div>
            {!isSignedIn && (
              <div className="border-t border-[var(--navi-border)] bg-[var(--navi-primary-light)]/60 px-5 py-4 sm:px-6">
                <button
                  type="button"
                  onClick={() => router.push('/login')}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--navi-primary)] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none sm:w-auto"
                >
                  <User className="h-4 w-4" aria-hidden="true" />
                  Sign In
                </button>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-[var(--navi-border)] bg-[var(--navi-card)] p-5 shadow-[var(--navi-shadow-sm)] sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--navi-text-secondary)]">Campus context</p>
                <h2 className="mt-1 text-lg font-semibold text-[var(--navi-text)]">Where NAVI is set up</h2>
              </div>
              <Map className="h-5 w-5 shrink-0 text-[var(--navi-primary)]" aria-hidden="true" />
            </div>
            <dl className="divide-y divide-[var(--navi-border)] rounded-2xl border border-[var(--navi-border)]">
              <CampusValueRow label="Current campus" value={currentCampusId ?? 'No campus selected'} hint="The campus you are viewing now" current />
              <CampusValueRow label="Default campus" value={defaultCampusId ?? 'Not set'} hint="Used when NAVI opens a campus map" />
            </dl>
            <button
              type="button"
              onClick={() => router.push('/map/maps')}
              className="mt-4 flex min-h-11 w-full items-center justify-between rounded-xl border border-[var(--navi-primary)]/25 px-4 py-2.5 text-left text-sm font-semibold text-[var(--navi-primary)] transition-colors hover:bg-[var(--navi-primary-light)]"
            >
              <span>Change campus</span>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <p className="mt-2 text-[11px] leading-5 text-[var(--navi-text-secondary)]">
              Changing the current campus does not change your saved default.
            </p>
          </section>

          <ActivityCard
            recentSearches={recentSearches}
            recentDestinations={recentDestinations}
            favorites={favorites}
            resolveNodeLabel={resolveNodeLabel}
            clearRecentSearches={clearRecentSearches}
            clearRecentDestinations={clearRecentDestinations}
          />
        </div>

        <div className="space-y-4">
          <section>
            <div className="mb-3 flex items-center justify-between gap-3 px-1">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--navi-text-secondary)]">Preferences</p>
                <h2 className="mt-1 text-lg font-semibold text-[var(--navi-text)]">Make it yours</h2>
              </div>
              <Palette className="h-5 w-5 text-[var(--navi-primary)]" aria-hidden="true" />
            </div>

            <div className="space-y-3">
              <Disclosure
                title="Appearance"
                description={`${themeLabel(preferences.theme)} · ${mapAppearanceLabel(preferences.mapAppearance)}`}
                icon={preferences.theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                open={openPanel === 'appearance'}
                onToggle={() => togglePanel('appearance')}
              >
                <div className="space-y-5">
                  <ChoiceGroup<ThemePreference>
                    legend="Theme"
                    value={preferences.theme}
                    options={[
                      { value: 'system', label: 'System', description: 'Follow your device' },
                      { value: 'light', label: 'Light', description: 'Bright and clear' },
                      { value: 'dark', label: 'Dark', description: 'Lower light' },
                    ]}
                    onChange={setTheme}
                  />
                  <div>
                    <p className="text-sm font-semibold text-[var(--navi-text)]">Map Appearance</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--navi-text-secondary)]">Building Colors</p>
                    <ChoiceGroup
                      legend="Building Colors"
                      value={preferences.mapAppearance}
                      options={[
                        { value: 'department' as const, label: 'Department Colors', description: 'Keep authored colors' },
                        { value: 'navi' as const, label: 'NAVI Theme', description: 'Use NAVI green' },
                        { value: 'uniform' as const, label: 'Uniform', description: 'Use one neutral tone' },
                      ]}
                      onChange={setMapAppearance}
                    />
                  </div>
                </div>
              </Disclosure>

              <PreferenceRow
                icon={<Bell className="h-4 w-4" />}
                title="Notifications"
                description="Campus announcements and updates"
                control={<Toggle checked={preferences.notifications} label="Notifications" onChange={() => setNotifications(!preferences.notifications)} />}
              />

              <Disclosure
                title="Navigation Preferences"
                description={`${mapViewLabel(preferences.navigation.defaultMapView)} map view · ${preferences.navigation.voiceGuidance ? 'Voice on' : 'Voice off'}`}
                icon={<Navigation className="h-4 w-4" />}
                open={openPanel === 'navigation'}
                onToggle={() => togglePanel('navigation')}
              >
                <div className="space-y-5">
                  <ChoiceGroup<NavigationMapView>
                    legend="Default map view"
                    value={preferences.navigation.defaultMapView}
                    options={[
                      { value: 'top', label: 'Top', description: 'A clear overhead view' },
                      { value: 'follow', label: 'Follow', description: 'Keep your direction centered' },
                      { value: 'pov', label: 'POV', description: 'A forward-looking view' },
                    ]}
                    onChange={(defaultMapView) => setNavigationPreferences({ defaultMapView })}
                  />
                  <div className="space-y-1">
                    <ToggleRow
                      icon={<Volume2 className="h-4 w-4" />}
                      title="Voice guidance"
                      description="Read navigation prompts aloud"
                      checked={preferences.navigation.voiceGuidance}
                      label="Voice guidance"
                      onChange={() => setNavigationPreferences({ voiceGuidance: !preferences.navigation.voiceGuidance })}
                    />
                    <ToggleRow
                      icon={<Building2 className="h-4 w-4" />}
                      title="Automatic floor switching"
                      description="Follow floor changes during a route"
                      checked={preferences.navigation.autoFloorSwitching}
                      label="Automatic floor switching"
                      onChange={() => setNavigationPreferences({ autoFloorSwitching: !preferences.navigation.autoFloorSwitching })}
                    />
                    <ToggleRow
                      icon={<Navigation className="h-4 w-4" />}
                      title="Heading follow"
                      description="Allow direction-aware map emphasis"
                      checked={preferences.navigation.headingFollow}
                      label="Heading follow"
                      onChange={() => setNavigationPreferences({ headingFollow: !preferences.navigation.headingFollow })}
                    />
                  </div>
                </div>
              </Disclosure>

              <Disclosure
                title="Accessibility"
                description={preferences.accessibility.reducedMotion ? 'Reduced motion on' : 'Motion defaults'}
                icon={<Accessibility className="h-4 w-4" />}
                open={openPanel === 'accessibility'}
                onToggle={() => togglePanel('accessibility')}
              >
                <ToggleRow
                  icon={<Accessibility className="h-4 w-4" />}
                  title="Reduced Motion"
                  description="Limit animation and transition movement"
                  checked={preferences.accessibility.reducedMotion}
                  label="Reduced Motion"
                  onChange={() => setAccessibilityPreferences({ reducedMotion: !preferences.accessibility.reducedMotion })}
                />
              </Disclosure>
            </div>
          </section>

          <section className="rounded-3xl border border-[var(--navi-border)] bg-[var(--navi-card)] p-5 shadow-[var(--navi-shadow-sm)] sm:p-6">
            <div className="mb-3 flex items-center gap-2">
              <CircleHelp className="h-4 w-4 text-[var(--navi-primary)]" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-[var(--navi-text)]">Support</h2>
            </div>
            <div className="divide-y divide-[var(--navi-border)] rounded-2xl border border-[var(--navi-border)]">
              <InfoRow icon={<CircleHelp className="h-4 w-4" />} title="Help & Feedback" description="Support links will appear here when available" />
              <InfoRow icon={<Info className="h-4 w-4" />} title="About NAVI" description="Campus navigation for clearer, calmer wayfinding" />
            </div>
          </section>

          <section className="rounded-3xl border border-[var(--navi-border)] bg-[var(--navi-card)] p-5 shadow-[var(--navi-shadow-sm)] sm:p-6">
            {isSignedIn ? (
              <button
                type="button"
                onClick={handleLogout}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--navi-error)]/30 bg-[var(--navi-error)]/5 px-4 py-2.5 text-sm font-semibold text-[var(--navi-error)] transition-colors hover:bg-[var(--navi-error)]/10"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sign Out
              </button>
            ) : (
              <p className="text-center text-xs leading-5 text-[var(--navi-text-secondary)]">
                Guest preferences are saved locally on this device.
              </p>
            )}
          </section>

          <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-2 text-[11px] text-[var(--navi-text-secondary)]">
            <span>NAVI Campus Navigation · v1.0</span>
            <span>Guest settings stay on this device</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function themeLabel(theme: ThemePreference): string {
  return theme.charAt(0).toUpperCase() + theme.slice(1)
}

function mapAppearanceLabel(mode: 'department' | 'navi' | 'uniform'): string {
  if (mode === 'department') return 'Department Colors'
  if (mode === 'navi') return 'NAVI Theme'
  return 'Uniform'
}

function mapViewLabel(view: NavigationMapView): string {
  return view === 'pov' ? 'POV' : view.charAt(0).toUpperCase() + view.slice(1)
}

function CampusValueRow({ label, value, hint, current = false }: {
  label: string
  value: string
  hint: string
  current?: boolean
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${current ? 'bg-[var(--navi-primary-light)] text-[var(--navi-primary)]' : 'bg-[var(--navi-content)] text-[var(--navi-text-secondary)]'}`}>
        {current ? <MapPin className="h-4 w-4" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
      </div>
      <div className="min-w-0 flex-1">
        <dt className="text-xs font-semibold text-[var(--navi-text)]">{label}</dt>
        <dd className="truncate text-sm font-medium text-[var(--navi-primary)]">{value}</dd>
        <p className="text-[11px] text-[var(--navi-text-secondary)]">{hint}</p>
      </div>
    </div>
  )
}

function Disclosure({ title, description, icon, open, onToggle, children }: {
  title: string
  description: string
  icon: React.ReactNode
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-3xl border border-[var(--navi-border)] bg-[var(--navi-card)] shadow-[var(--navi-shadow-sm)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-[72px] w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--navi-content)] sm:px-5"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--navi-primary-light)] text-[var(--navi-primary)]">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[var(--navi-text)]">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-[var(--navi-text-secondary)]">{description}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--navi-text-secondary)] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && <div className="border-t border-[var(--navi-border)] px-4 py-4 sm:px-5">{children}</div>}
    </section>
  )
}

function ChoiceGroup<T extends string>({ legend, value, options, onChange }: {
  legend: string
  value: T
  options: Array<{ value: T; label: string; description: string }>
  onChange: (value: T) => void
}) {
  return (
    <fieldset>
      <legend className="text-sm font-semibold text-[var(--navi-text)]">{legend}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={legend}>
        {options.map((option) => (
          <label
            key={option.value}
            className={`flex min-h-[64px] cursor-pointer items-start gap-2.5 rounded-2xl border px-3 py-3 transition-colors ${value === option.value ? 'border-[var(--navi-primary)] bg-[var(--navi-primary-light)]' : 'border-[var(--navi-border)] hover:bg-[var(--navi-content)]'}`}
          >
            <input
              type="radio"
              name={legend}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              aria-label={option.label}
              className="mt-0.5 h-4 w-4 accent-[var(--navi-primary)]"
            />
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-[var(--navi-text)]">{option.label}</span>
              <span className="mt-0.5 block text-[10px] leading-4 text-[var(--navi-text-secondary)]">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function PreferenceRow({ icon, title, description, control }: {
  icon: React.ReactNode
  title: string
  description: string
  control: React.ReactNode
}) {
  return (
    <div className="flex min-h-[72px] items-center gap-3 rounded-3xl border border-[var(--navi-border)] bg-[var(--navi-card)] px-4 py-3.5 shadow-[var(--navi-shadow-sm)] sm:px-5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--navi-content)] text-[var(--navi-text-secondary)]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--navi-text)]">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-[var(--navi-text-secondary)]">{description}</span>
      </span>
      {control}
    </div>
  )
}

function ToggleRow({ icon, title, description, checked, label, onChange }: {
  icon: React.ReactNode
  title: string
  description: string
  checked: boolean
  label: string
  onChange: () => void
}) {
  return (
    <div className="flex min-h-[60px] items-center gap-3 rounded-2xl px-1 py-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--navi-content)] text-[var(--navi-text-secondary)]">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-[var(--navi-text)]">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-[var(--navi-text-secondary)]">{description}</span>
      </span>
      <Toggle checked={checked} label={label} onChange={onChange} />
    </div>
  )
}

function Toggle({ checked, label, onChange }: {
  checked: boolean
  label: string
  onChange: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-11 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors ${checked ? 'bg-[var(--navi-primary)]' : 'bg-[var(--navi-border)]'}`}
    >
      <span className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

function InfoRow({ icon, title, description }: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="flex min-h-[68px] items-center gap-3 px-4 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--navi-content)] text-[var(--navi-text-secondary)]">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[var(--navi-text)]">{title}</p>
        <p className="mt-0.5 text-[11px] leading-4 text-[var(--navi-text-secondary)]">{description}</p>
      </div>
    </div>
  )
}

function ActivityCard({ recentSearches, recentDestinations, favorites, resolveNodeLabel, clearRecentSearches, clearRecentDestinations }: {
  recentSearches: string[]
  recentDestinations: string[]
  favorites: string[]
  resolveNodeLabel: (nodeId: string) => string
  clearRecentSearches: () => void
  clearRecentDestinations: () => void
}) {
  return (
    <section className="rounded-3xl border border-[var(--navi-border)] bg-[var(--navi-card)] p-5 shadow-[var(--navi-shadow-sm)] sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--navi-text-secondary)]">Your activity</p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--navi-text)]">A quick look back</h2>
        </div>
        <Clock className="h-5 w-5 text-[var(--navi-primary)]" aria-hidden="true" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Searches" value={recentSearches.length} icon={<Search className="h-3.5 w-3.5" />} />
        <Stat label="Routes" value={recentDestinations.length} icon={<MapPin className="h-3.5 w-3.5" />} />
        <Stat label="Favorites" value={favorites.length} icon={<Heart className="h-3.5 w-3.5" />} />
      </div>
      <div className="mt-4 rounded-2xl bg-[var(--navi-content)] p-3">
        {recentSearches.length === 0 && recentDestinations.length === 0 ? (
          <p className="py-2 text-center text-xs text-[var(--navi-text-secondary)]">No recent activity yet.</p>
        ) : (
          <div className="space-y-2">
            {recentSearches.slice(0, 2).map((query, index) => (
              <div key={`search-${index}`} className="flex min-w-0 items-center gap-2 text-xs text-[var(--navi-text)]">
                <Search className="h-3.5 w-3.5 shrink-0 text-[var(--navi-text-secondary)]" aria-hidden="true" />
                <span className="truncate">{query}</span>
              </div>
            ))}
            {recentDestinations.slice(0, 2).map((destination, index) => (
              <div key={`destination-${index}`} className="flex min-w-0 items-center gap-2 text-xs text-[var(--navi-text)]">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--navi-text-secondary)]" aria-hidden="true" />
                <span className="truncate">{resolveNodeLabel(destination)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {(recentSearches.length > 0 || recentDestinations.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {recentSearches.length > 0 && <ClearButton label="Clear searches" onClick={clearRecentSearches} />}
          {recentDestinations.length > 0 && <ClearButton label="Clear routes" onClick={clearRecentDestinations} />}
        </div>
      )}
    </section>
  )
}

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--navi-border)] bg-[var(--navi-card)] px-2 py-3 text-center">
      <span className="mx-auto flex h-6 w-6 items-center justify-center rounded-lg bg-[var(--navi-primary-light)] text-[var(--navi-primary)]">{icon}</span>
      <span className="mt-1 block text-base font-semibold text-[var(--navi-text)]">{value}</span>
      <span className="block text-[10px] text-[var(--navi-text-secondary)]">{label}</span>
    </div>
  )
}

function ClearButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--navi-border)] px-2.5 text-[11px] font-medium text-[var(--navi-text-secondary)] transition-colors hover:bg-[var(--navi-content)]"
    >
      <Trash2 className="h-3 w-3" aria-hidden="true" />
      {label}
    </button>
  )
}
