/**
 * P3-T6: Floor plan image loading hook.
 *
 * Loads a floor plan image from a URL and makes it available
 * for Canvas rendering via drawFloorPlanImage.
 */

import { useState, useEffect } from 'react'

export interface UseFloorPlanImageResult {
  image: HTMLImageElement | null
  loading: boolean
  error: string | null
}

export function useFloorPlanImage(url: string | null | undefined): UseFloorPlanImageResult {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!url) {
      setImage(null)
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    const img = new Image()
    img.crossOrigin = 'anonymous'

    const onLoad = () => {
      setImage(img)
      setLoading(false)
    }

    const onError = () => {
      setImage(null)
      setLoading(false)
      setError(`Failed to load floor plan image: ${url}`)
    }

    img.onload = onLoad
    img.onerror = onError
    img.src = url

    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [url])

  return { image, loading, error }
}
