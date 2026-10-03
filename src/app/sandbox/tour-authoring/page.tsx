'use client'

import { useState } from 'react'
import { useAuthoringStore, type TourDefinition, type AuthoringState, type AuthoringActions } from '@/components/tour/authoring/useAuthoringStore'
import { TourViewer } from '@/components/tour/TourViewer'
import type { Panorama, PanoramaHotspot, HotspotContent } from '@navi/core'

// Convert NAVI Panorama to TourViewer format
function toTourPanorama(panorama: Panorama) {
  return {
    id: panorama.id,
    label: panorama.label,
    imageUrl: `https://picsum.photos/seed/${panorama.id}/2048/1024`,
    heading: panorama.heading,
    hotspots: panorama.hotspots.map(h => ({
      id: `${panorama.id}_hotspot_${h.position.yaw}_${h.position.pitch}`,
      type: h.hotspotType || 'navigation' as const,
      yaw: h.position.yaw,
      pitch: h.position.pitch,
      label: h.label,
      targetPanoramaId: h.target.type === 'panorama' ? h.target.targetId : undefined,
      content: h.content,
    })),
  }
}

// ── Panorama List Panel ──
function PanoramaListPanel({ state, actions }: { state: AuthoringState; actions: AuthoringActions }) {
  const [newPanoramaLabel, setNewPanoramaLabel] = useState('')

  const handleAddPanorama = () => {
    if (!newPanoramaLabel.trim()) return
    const id = `pano-${Date.now()}`
    const panorama: Panorama = {
      id,
      label: newPanoramaLabel.trim(),
      position: { lat: 14.5995 + Math.random() * 0.01, lng: 120.9842 + Math.random() * 0.01 },
      heading: 0,
      imageAssetId: `img-${id}`,
      hotspots: [],
    }
    actions.addPanorama(panorama)
    setNewPanoramaLabel('')
  }

  return (
    <div className="bg-white rounded-xl shadow p-4">
      <h3 className="text-lg font-semibold mb-3">Panoramas ({state.tour.panoramas.length})</h3>
      
      {/* Add panorama form */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={newPanoramaLabel}
          onChange={e => setNewPanoramaLabel(e.target.value)}
          placeholder="Panorama label..."
          className="flex-1 px-3 py-2 border rounded-lg text-sm"
          onKeyDown={e => e.key === 'Enter' && handleAddPanorama()}
        />
        <button
          onClick={handleAddPanorama}
          className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
        >
          Add
        </button>
      </div>

      {/* Panorama list */}
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {state.tour.panoramas.map(panorama => (
          <div
            key={panorama.id}
            onClick={() => actions.selectPanorama(panorama.id)}
            className={`p-3 rounded-lg cursor-pointer transition-colors ${
              state.selectedPanoramaId === panorama.id
                ? 'bg-blue-100 border-2 border-blue-500'
                : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
            }`}
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="font-medium text-sm">{panorama.label}</p>
                <p className="text-xs text-gray-500">{panorama.hotspots.length} hotspots</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); actions.removePanorama(panorama.id) }}
                className="text-red-500 hover:text-red-700 text-xs"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        {state.tour.panoramas.length === 0 && (
          <p className="text-gray-500 text-sm text-center py-4">No panoramas yet. Add one above.</p>
        )}
      </div>
    </div>
  )
}

// ── Hotspot Editor Panel ──
function HotspotEditorPanel({ state, actions }: { state: AuthoringState; actions: AuthoringActions }) {
  const selectedPanorama = state.tour.panoramas.find(p => p.id === state.selectedPanoramaId)
  if (!selectedPanorama) {
    return (
      <div className="bg-white rounded-xl shadow p-4">
        <h3 className="text-lg font-semibold mb-3">Hotspot Editor</h3>
        <p className="text-gray-500 text-sm">Select a panorama to edit hotspots.</p>
      </div>
    )
  }

  const [newHotspotType, setNewHotspotType] = useState<'navigation' | 'information'>('navigation')
  const [newHotspotLabel, setNewHotspotLabel] = useState('')
  const [newHotspotYaw, setNewHotspotYaw] = useState(0)
  const [newHotspotPitch, setNewHotspotPitch] = useState(0)
  const [newHotspotTarget, setNewHotspotTarget] = useState('')

  const handleAddHotspot = () => {
    if (!newHotspotLabel.trim()) return
    const hotspot: PanoramaHotspot = {
      hotspotType: newHotspotType,
      target: {
        type: newHotspotType === 'navigation' ? 'panorama' : 'url',
        targetId: newHotspotType === 'navigation' ? newHotspotTarget : '',
      },
      position: { yaw: newHotspotYaw, pitch: newHotspotPitch },
      label: newHotspotLabel.trim(),
      content: newHotspotType === 'information' ? { title: newHotspotLabel.trim() } : undefined,
    }
    actions.addHotspot(selectedPanorama.id, hotspot)
    setNewHotspotLabel('')
    setNewHotspotTarget('')
  }

  return (
    <div className="bg-white rounded-xl shadow p-4">
      <h3 className="text-lg font-semibold mb-3">
        Hotspots: {selectedPanorama.label}
      </h3>

      {/* Add hotspot form */}
      <div className="space-y-3 mb-4 p-3 bg-gray-50 rounded-lg">
        <div className="flex gap-2">
          <select
            value={newHotspotType}
            onChange={e => setNewHotspotType(e.target.value as 'navigation' | 'information')}
            className="px-3 py-2 border rounded-lg text-sm"
          >
            <option value="navigation">Navigation</option>
            <option value="information">Information</option>
          </select>
          <input
            type="text"
            value={newHotspotLabel}
            onChange={e => setNewHotspotLabel(e.target.value)}
            placeholder="Label..."
            className="flex-1 px-3 py-2 border rounded-lg text-sm"
          />
        </div>
        <div className="flex gap-2">
          <label className="text-sm text-gray-600">Yaw:</label>
          <input
            type="number"
            value={newHotspotYaw}
            onChange={e => setNewHotspotYaw(Number(e.target.value))}
            min={0}
            max={360}
            className="w-20 px-2 py-1 border rounded text-sm"
          />
          <label className="text-sm text-gray-600">Pitch:</label>
          <input
            type="number"
            value={newHotspotPitch}
            onChange={e => setNewHotspotPitch(Number(e.target.value))}
            min={-90}
            max={90}
            className="w-20 px-2 py-1 border rounded text-sm"
          />
        </div>
        {newHotspotType === 'navigation' && (
          <select
            value={newHotspotTarget}
            onChange={e => setNewHotspotTarget(e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          >
            <option value="">Select target panorama...</option>
            {state.tour.panoramas
              .filter(p => p.id !== selectedPanorama.id)
              .map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
          </select>
        )}
        <button
          onClick={handleAddHotspot}
          className="w-full px-3 py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
        >
          Add Hotspot
        </button>
      </div>

      {/* Hotspot list */}
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {selectedPanorama.hotspots.map((hotspot, index) => (
          <div
            key={index}
            onClick={() => actions.selectHotspot(index)}
            className={`p-3 rounded-lg cursor-pointer transition-colors ${
              state.selectedHotspotIndex === index
                ? 'bg-blue-100 border-2 border-blue-500'
                : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
            }`}
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="font-medium text-sm">
                  {hotspot.hotspotType === 'information' ? 'ℹ️' : '→'} {hotspot.label}
                </p>
                <p className="text-xs text-gray-500">
                  Yaw: {hotspot.position.yaw}°, Pitch: {hotspot.position.pitch}°
                </p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); actions.removeHotspot(selectedPanorama.id, index) }}
                className="text-red-500 hover:text-red-700 text-xs"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        {selectedPanorama.hotspots.length === 0 && (
          <p className="text-gray-500 text-sm text-center py-2">No hotspots yet.</p>
        )}
      </div>
    </div>
  )
}

// ── Information Content Editor ──
function InformationContentEditor({ state, actions }: { state: AuthoringState; actions: AuthoringActions }) {
  const selectedPanorama = state.tour.panoramas.find(p => p.id === state.selectedPanoramaId)
  const selectedHotspot = selectedPanorama?.hotspots[state.selectedHotspotIndex ?? -1]

  if (!selectedPanorama || !selectedHotspot || selectedHotspot.hotspotType !== 'information') {
    return (
      <div className="bg-white rounded-xl shadow p-4">
        <h3 className="text-lg font-semibold mb-3">Information Content</h3>
        <p className="text-gray-500 text-sm">Select an information hotspot to edit its content.</p>
      </div>
    )
  }

  const content = selectedHotspot.content || {}

  return (
    <div className="bg-white rounded-xl shadow p-4">
      <h3 className="text-lg font-semibold mb-3">Information Content</h3>
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
          <input
            type="text"
            value={content.title || ''}
            onChange={e => actions.updateHotspotContent(
              selectedPanorama.id,
              state.selectedHotspotIndex!,
              { title: e.target.value }
            )}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            value={content.description || ''}
            onChange={e => actions.updateHotspotContent(
              selectedPanorama.id,
              state.selectedHotspotIndex!,
              { description: e.target.value }
            )}
            rows={3}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Image URL</label>
          <input
            type="text"
            value={content.imageUrl || ''}
            onChange={e => actions.updateHotspotContent(
              selectedPanorama.id,
              state.selectedHotspotIndex!,
              { imageUrl: e.target.value }
            )}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Link URL</label>
          <input
            type="text"
            value={content.linkUrl || ''}
            onChange={e => actions.updateHotspotContent(
              selectedPanorama.id,
              state.selectedHotspotIndex!,
              { linkUrl: e.target.value }
            )}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Link Label</label>
          <input
            type="text"
            value={content.linkLabel || ''}
            onChange={e => actions.updateHotspotContent(
              selectedPanorama.id,
              state.selectedHotspotIndex!,
              { linkLabel: e.target.value }
            )}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
        </div>
      </div>
    </div>
  )
}

// ── Preview Modal ──
function PreviewModal({ state, onClose }: { state: AuthoringState; onClose: () => void }) {
  const tourPanoramas = state.tour.panoramas.map(toTourPanorama)
  const currentIndex = state.selectedPanoramaId
    ? state.tour.panoramas.findIndex(p => p.id === state.selectedPanoramaId)
    : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold">Preview: {state.tour.name}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>
        <div className="h-[500px]">
          <TourViewer
            panoramas={tourPanoramas}
            initialIndex={Math.max(0, currentIndex)}
          />
        </div>
      </div>
    </div>
  )
}

// ── Export Panel ──
function ExportPanel({ state }: { state: AuthoringState }) {
  const [showExport, setShowExport] = useState(false)

  return (
    <div className="bg-white rounded-xl shadow p-4">
      <h3 className="text-lg font-semibold mb-3">Export</h3>
      <div className="space-y-2">
        <button
          onClick={() => setShowExport(!showExport)}
          className="w-full px-3 py-2 bg-purple-600 text-white rounded-lg text-sm hover:bg-purple-700"
        >
          {showExport ? 'Hide' : 'Show'} JSON
        </button>
        {showExport && (
          <pre className="bg-gray-100 p-3 rounded-lg text-xs overflow-auto max-h-48">
            {JSON.stringify(state.tour, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}

// ── Main Authoring Page ──
export default function TourAuthoringPage() {
  const [state, actions] = useAuthoringStore()
  const [showPreview, setShowPreview] = useState(false)

  const selectedPanorama = state.tour.panoramas.find(p => p.id === state.selectedPanoramaId)
  const tourPanoramas = state.tour.panoramas.map(toTourPanorama)

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">360 Tour Authoring</h1>
            <p className="text-sm text-gray-600">Standalone prototype — isolated from Studio</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const errors = actions.validate()
                if (errors.length === 0) setShowPreview(true)
              }}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              Preview
            </button>
            <button
              onClick={() => {
                const tour = actions.exportTour()
                const blob = new Blob([JSON.stringify(tour, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `${tour.name.replace(/\s+/g, '-').toLowerCase()}.json`
                a.click()
                URL.revokeObjectURL(url)
              }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Export
            </button>
          </div>
        </div>
      </div>

      {/* Errors */}
      {state.errors.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 py-2">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-red-800 text-sm font-medium">Validation Errors:</p>
            <ul className="text-red-700 text-sm mt-1">
              {state.errors.map((error, i) => (
                <li key={i}>• {error}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-12 gap-6">
          {/* Left sidebar: Panorama list */}
          <div className="col-span-3">
            <PanoramaListPanel state={state} actions={actions} />
          </div>

          {/* Center: Viewer + Hotspot editor */}
          <div className="col-span-6 space-y-6">
            {/* Viewer */}
            <div className="bg-white rounded-xl shadow overflow-hidden">
              <div className="p-4 border-b">
                <h3 className="text-lg font-semibold">
                  {selectedPanorama ? `Editing: ${selectedPanorama.label}` : '360 Viewer'}
                </h3>
              </div>
              <div className="h-[400px]">
                {selectedPanorama ? (
                  <TourViewer
                    panoramas={[toTourPanorama(selectedPanorama)]}
                    initialIndex={0}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full bg-gray-100 text-gray-500">
                    Select a panorama to preview
                  </div>
                )}
              </div>
            </div>

            {/* Hotspot editor */}
            <HotspotEditorPanel state={state} actions={actions} />
          </div>

          {/* Right sidebar: Info editor + Export */}
          <div className="col-span-3 space-y-6">
            <InformationContentEditor state={state} actions={actions} />
            <ExportPanel state={state} />
          </div>
        </div>
      </div>

      {/* Preview modal */}
      {showPreview && (
        <PreviewModal state={state} onClose={() => setShowPreview(false)} />
      )}
    </div>
  )
}
