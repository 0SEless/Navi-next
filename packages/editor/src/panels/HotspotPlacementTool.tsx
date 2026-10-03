import { useState, useCallback, useRef, useEffect } from 'react'
import { useEditor } from '@navi/editor'
import { TourViewer } from '@/components/tour/TourViewer'
import type { TourPanorama } from '@/components/tour/types'
import type { Panorama } from '@navi/core'
import { useStudioStore } from '@/store/studio-store'

interface HotspotPlacementToolProps {
  isOpen: boolean
  onClose: () => void
  panoramaId: string
  hotspotType: 'navigation' | 'information'
}

// Convert NAVI Panorama to TourViewer format
function toTourPanorama(panorama: Panorama): TourPanorama {
  return {
    id: panorama.id,
    label: panorama.label || panorama.id,
    imageUrl: panorama.imageAssetId || `https://picsum.photos/seed/${panorama.id}/2048/1024`,
    heading: panorama.heading,
    hotspots: [], // Don't show existing hotspots during placement
  }
}

export function HotspotPlacementTool({
  isOpen,
  onClose,
  panoramaId,
  hotspotType,
}: HotspotPlacementToolProps) {
  const { services, document } = useEditor()
  const dispatcher = services.get<any>('dispatcher')
  const [yaw, setYaw] = useState(0)
  const [pitch, setPitch] = useState(0)
  const [isPlacing, setIsPlacing] = useState(false)
  const [targetPanoramaId, setTargetPanoramaId] = useState('')
  const [content, setContent] = useState({
    title: '',
    description: '',
    imageUrl: '',
    linkUrl: '',
    linkLabel: '',
  })

  // Get the panorama being edited
  const panorama = document.panoramas?.find((p: Panorama) => p.id === panoramaId)
  
  // Get all panoramas for target selection
  const allPanoramas = document.panoramas || []
  
  // Convert to TourViewer format
  const tourPanoramas = panorama ? [toTourPanorama(panorama)] : []

  // Handle click in the 360 viewer to capture yaw/pitch
  const handleViewerClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!isPlacing) return
    
    // Calculate yaw/pitch from click position
    // This is a simplified calculation - in production, you'd use Pannellum's API
    const rect = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    
    // Map to yaw (0-360) and pitch (-90 to 90)
    const newYaw = Math.round(x * 360)
    const newPitch = Math.round((y - 0.5) * 180)
    
    setYaw(newYaw)
    setPitch(newPitch)
    setIsPlacing(false)
  }, [isPlacing])

  // Create the hotspot
  const handleCreate = useCallback(() => {
    if (!panoramaId) return

    const payload: Record<string, unknown> = {
      panoramaId,
      hotspotType,
      label: hotspotType === 'navigation' ? 'Navigation' : 'Information',
      yaw,
      pitch,
      targetId: hotspotType === 'navigation' ? targetPanoramaId : '',
      content: hotspotType === 'information' ? content : undefined,
    }

    dispatcher.execute({
      id: 'hotspot.create',
      label: `Create ${hotspotType} hotspot`,
      payload,
    })

    onClose()
  }, [panoramaId, hotspotType, yaw, pitch, targetPanoramaId, content, dispatcher, onClose])

  if (!isOpen || !panorama) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 className="text-lg font-semibold">
              Place {hotspotType === 'navigation' ? 'Navigation' : 'Information'} Hotspot
            </h3>
            <p className="text-sm text-gray-500">
              {isPlacing ? 'Click on the panorama to place the hotspot' : 'Adjust position and configure'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Viewer with click handler */}
        <div
          className="flex-1 min-h-[300px] relative cursor-crosshair"
          onClick={handleViewerClick}
        >
          {tourPanoramas.length > 0 && (
            <TourViewer
              panoramas={tourPanoramas}
              initialIndex={0}
            />
          )}
          
          {/* Placement indicator */}
          {isPlacing && (
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg">
              Click to place hotspot
            </div>
          )}
        </div>

        {/* Configuration panel */}
        <div className="p-4 border-t bg-gray-50">
          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* Yaw/Pitch display */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Position</label>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500">Yaw (°)</label>
                  <input
                    type="number"
                    value={yaw}
                    onChange={e => setYaw(parseInt(e.target.value) || 0)}
                    min={0}
                    max={360}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500">Pitch (°)</label>
                  <input
                    type="number"
                    value={pitch}
                    onChange={e => setPitch(parseInt(e.target.value) || 0)}
                    min={-90}
                    max={90}
                    className="w-full px-3 py-2 border rounded-lg text-sm"
                  />
                </div>
              </div>
              <button
                onClick={() => setIsPlacing(true)}
                className="mt-2 w-full px-3 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm hover:bg-blue-200"
              >
                {isPlacing ? 'Placing...' : 'Click to Place'}
              </button>
            </div>

            {/* Target selection (navigation only) */}
            {hotspotType === 'navigation' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target Panorama</label>
                <select
                  value={targetPanoramaId}
                  onChange={e => setTargetPanoramaId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="">Select target...</option>
                  {allPanoramas
                    .filter((p: Panorama) => p.id !== panoramaId)
                    .map((p: Panorama) => (
                      <option key={p.id} value={p.id}>{p.label || p.id}</option>
                    ))}
                </select>
              </div>
            )}

            {/* Content configuration (information only) */}
            {hotspotType === 'information' && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Content</label>
                <input
                  type="text"
                  placeholder="Title"
                  value={content.title}
                  onChange={e => setContent(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
                <input
                  type="text"
                  placeholder="Description"
                  value={content.description}
                  onChange={e => setContent(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Create Hotspot
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
