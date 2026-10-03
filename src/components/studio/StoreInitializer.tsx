'use client'

import { useEffect } from 'react'
import { useCampusMapStore } from '@/store/campus-map-store'

export function StoreInitializer() {
  useEffect(() => {
    useCampusMapStore.getState().load()
  }, [])

  return null
}
