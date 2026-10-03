'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { createIndexedDbCaptureSyncStateRepository } from './local-state'
import { createCaptureSyncService } from './service'
import { createSupabaseCaptureRepository } from './supabase-repository'
import { CaptureSyncProvider } from './context'
import type { CaptureSyncAvailability } from './types'
import { indexedDbCaptureRepository } from '../capture/db'
import { createClient } from '@/lib/supabase-client'

export function SupabaseCaptureSyncProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => {
    try {
      return createClient()
    } catch {
      return null
    }
  }, [])
  const cloudRepository = useMemo(() => {
    if (!client) return null
    return createSupabaseCaptureRepository(client)
  }, [client])
  const service = useMemo(() => {
    if (!cloudRepository) return null
    return createCaptureSyncService({
      localRepository: indexedDbCaptureRepository,
      stateRepository: createIndexedDbCaptureSyncStateRepository(),
      cloudRepository,
    })
  }, [cloudRepository])
  const [available, setAvailable] = useState(false)
  const [availability, setAvailability] = useState<CaptureSyncAvailability>(
    client ? 'checking' : 'unavailable',
  )

  useEffect(() => {
    let active = true
    if (!client) return undefined

    void client.auth
      .getUser()
      .then(({ data, error }) => {
        if (!active) return
        const authenticated = !error && Boolean(data.user?.id)
        setAvailable(authenticated)
        setAvailability(authenticated ? 'available' : 'unavailable')
      })
      .catch(() => {
        if (!active) return
        setAvailable(false)
        setAvailability('unavailable')
      })

    return () => {
      active = false
    }
  }, [client])

  return (
    <CaptureSyncProvider
      service={service}
      available={available}
      availability={availability}
      cloudRepository={cloudRepository}
    >
      {children}
    </CaptureSyncProvider>
  )
}
