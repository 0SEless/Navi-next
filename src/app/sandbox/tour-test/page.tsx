'use client'

import { useState } from 'react'
import { TourViewer } from '@/components/tour/TourViewer'
import { mockPanoramas } from '@/components/tour/mock-data'

export default function TourTestPage() {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showInfo, setShowInfo] = useState(false)

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-gray-900">
            360 Virtual Tour - Test Page
          </h1>
          <p className="mt-2 text-gray-600">
            This is a standalone test page for the 360 virtual tour viewer.
            It uses mock data and is completely isolated from NAVI.
          </p>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Viewer */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow overflow-hidden">
              <div className="p-4 border-b">
                <h2 className="text-lg font-semibold text-gray-900">
                  360 Viewer
                </h2>
              </div>
              <div className="h-[500px]">
                <TourViewer
                  panoramas={mockPanoramas}
                  initialIndex={currentIndex}
                  onPanoramaChange={setCurrentIndex}
                />
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Tour Controls
              </h2>

              {/* Current panorama info */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 mb-2">
                  Current Panorama
                </h3>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="font-medium text-gray-900">
                    {mockPanoramas[currentIndex]?.label || 'Unknown'}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    {mockPanoramas[currentIndex]?.hotspots.length || 0} hotspots
                  </p>
                </div>
              </div>

              {/* Panorama list */}
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 mb-2">
                  All Panoramas
                </h3>
                <div className="space-y-2">
                  {mockPanoramas.map((panorama, index) => (
                    <button
                      key={panorama.id}
                      onClick={() => setCurrentIndex(index)}
                      className={`w-full text-left p-3 rounded-lg transition-colors ${
                        index === currentIndex
                          ? 'bg-blue-100 border-2 border-blue-500'
                          : 'bg-gray-50 hover:bg-gray-100 border-2 border-transparent'
                      }`}
                    >
                      <p className="font-medium text-gray-900">
                        {panorama.label}
                      </p>
                      <p className="text-sm text-gray-600">
                        {panorama.hotspots.length} hotspots
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Instructions */}
              <div className="bg-blue-50 rounded-lg p-4">
                <h3 className="text-sm font-medium text-blue-800 mb-2">
                  How to Use
                </h3>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>• Drag to rotate the view</li>
                  <li>• Scroll to zoom in/out</li>
                  <li>• Click navigation hotspots to move between panoramas</li>
                  <li>• Click information hotspots to view content</li>
                  <li>• Use arrow keys to navigate between panoramas</li>
                  <li>• Press ESC to exit fullscreen or close info cards</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
