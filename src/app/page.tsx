'use client'

import { Component, useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useGeolocation } from '@/hooks/useGeolocation'
import type { Campus } from '@/types/campus'
import type { ReactNode } from 'react'

const CampusMapPreview = dynamic(
  () => import('@/components/map/CampusMap'),
  { ssr: false }
)

class MapErrorBoundary extends Component<{ children: ReactNode }> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  render() {
    return this.state.hasError
      ? <div className="w-full h-full flex items-center justify-center bg-slate-100 rounded-xl text-slate-400 text-sm">Map unavailable</div>
      : this.props.children
  }
}

// MOCK_AUTH_CHECK

const FALLBACK_CAMPUSES: Campus[] = [
  {
    id: '1',
    name: 'ASU Main Campus',
    slug: 'asu-main',
    description: 'Located in Tempe, the largest of the ASU campuses with a vibrant academic community.',
    address: 'Tempe, AZ',
    status: 'active',
    boundary_polygon: null,
    created_at: '',
  },
  {
    id: '2',
    name: 'ASU West Campus',
    slug: 'asu-west',
    description: 'Serves the West Valley with a growing academic community.',
    address: 'Phoenix, AZ',
    status: 'active',
    boundary_polygon: null,
    created_at: '',
  },
  {
    id: '3',
    name: 'ASU Downtown Phoenix',
    slug: 'asu-downtown',
    description: 'Urban campus in the heart of downtown Phoenix.',
    address: 'Phoenix, AZ',
    status: 'active',
    boundary_polygon: null,
    created_at: '',
  },
  {
    id: '4',
    name: 'ASU Polytechnic',
    slug: 'asu-poly',
    description: 'Located in Mesa, focusing on technology and innovation.',
    address: 'Mesa, AZ',
    status: 'active',
    boundary_polygon: null,
    created_at: '',
  },
]

export default function WelcomePage() {
  const [campuses, setCampuses] = useState<Campus[]>(FALLBACK_CAMPUSES)
  const [campusesLoading, setCampusesLoading] = useState(true)
  const [mounted, setMounted] = useState(false)
  const geo = useGeolocation()
  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/campuses')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch')
        return res.json()
      })
      .then((data) => {
        if (!cancelled && Array.isArray(data) && data.length > 0) {
          setCampuses(data)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCampusesLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <header className="border-b border-slate-200 bg-[var(--navi-card)]/80 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">N</span>
            </div>
            <span className="font-semibold text-slate-900">NAVI</span>
          </div>
          <nav className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-sm text-slate-600 hover:text-slate-900 transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/map"
              className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              View Map
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pt-20 pb-16 text-center">
          <h1 className="text-5xl font-bold tracking-tight text-slate-900 sm:text-6xl">
            Navigate Your Campus
          </h1>
          <p className="mt-4 text-lg text-slate-600 max-w-2xl mx-auto">
            Find your way across multiple campuses with turn-by-turn directions,
            indoor wayfinding, and real-time location tracking.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link
              href="/map"
              className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-sm"
            >
              Start Navigating
            </Link>
            <Link
              href="/map"
              className="bg-[var(--navi-card)] text-slate-700 px-6 py-3 rounded-lg font-medium border border-slate-300 hover:border-slate-400 transition-colors"
            >
              Explore Map
            </Link>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 pb-16">
          <div className="rounded-xl overflow-hidden shadow-lg border border-slate-200 h-72 sm:h-96">
            <MapErrorBoundary><CampusMapPreview zoom={15} /></MapErrorBoundary>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-16">
          <div className="rounded-xl bg-[var(--navi-card)] border border-slate-200 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Your Location</h2>
            {!mounted ? (
              <p className="mt-2 text-slate-500 text-sm">Checking location...</p>
            ) : geo.loading ? (
              <p className="mt-2 text-slate-500 text-sm">Detecting your location...</p>
            ) : geo.error ? (
              <p className="mt-2 text-slate-500 text-sm">
                Location unavailable &mdash; {geo.error}
              </p>
            ) : geo.latitude != null && geo.longitude != null ? (
              <p className="mt-2 text-slate-700 text-sm">
                {geo.latitude.toFixed(4)}, {geo.longitude.toFixed(4)}
                {geo.accuracy != null && (
                  <span className="text-slate-400 ml-2">
                    (&plusmn;{Math.round(geo.accuracy)}m)
                  </span>
                )}
              </p>
            ) : (
              <p className="mt-2 text-slate-500 text-sm">Location permission not granted.</p>
            )}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20">
          <h2 className="text-2xl font-bold text-slate-900 mb-8">
            {campusesLoading ? 'Loading campuses...' : 'Explore Campuses'}
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {campuses.map((campus, idx) => (
              <Link
                key={campus.id ?? `campus-${idx}`}
                href={`/map?campus=${campus.slug}`}
                className="group rounded-xl bg-[var(--navi-card)] border border-slate-200 p-5 shadow-sm hover:shadow-md hover:border-blue-300 transition-all"
              >
                <div className="h-2 w-2 rounded-full bg-blue-600 mb-3" />
                <h3 className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
                  {campus.name}
                </h3>
                <p className="mt-1 text-sm text-slate-500">{campus.description}</p>
                <p className="mt-2 text-xs text-slate-400">{campus.address}</p>
              </Link>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-[var(--navi-card)]">
        <div className="mx-auto max-w-6xl px-4 py-6 text-center text-sm text-slate-400">
          NAVI &mdash; Virtual Campus Navigation
        </div>
      </footer>
    </div>
  )
}
