import type { TourPanorama } from './types'

// Mock panorama data for testing the 360 viewer
// Uses reliable test images (placeholder services)
export const mockPanoramas: TourPanorama[] = [
  {
    id: 'pano-1',
    label: 'Campus Main Entrance',
    imageUrl: 'https://picsum.photos/seed/pano1/2048/1024',
    heading: 90,
    hotspots: [
      {
        id: 'nav-1-2',
        type: 'navigation',
        yaw: 120,
        pitch: 0,
        label: 'Go to Library',
        targetPanoramaId: 'pano-2',
      },
      {
        id: 'nav-1-3',
        type: 'navigation',
        yaw: 240,
        pitch: 0,
        label: 'Go to Student Center',
        targetPanoramaId: 'pano-3',
      },
      {
        id: 'info-1-1',
        type: 'information',
        yaw: 0,
        pitch: -10,
        label: 'About Main Entrance',
        content: {
          title: 'Campus Main Entrance',
          description: 'The main entrance to the university campus. This historic gate has welcomed students since 1925.',
          imageUrl: 'https://picsum.photos/seed/info1/400/300',
        },
      },
    ],
  },
  {
    id: 'pano-2',
    label: 'University Library',
    imageUrl: 'https://picsum.photos/seed/pano2/2048/1024',
    heading: 180,
    hotspots: [
      {
        id: 'nav-2-1',
        type: 'navigation',
        yaw: 60,
        pitch: 0,
        label: 'Back to Main Entrance',
        targetPanoramaId: 'pano-1',
      },
      {
        id: 'nav-2-3',
        type: 'navigation',
        yaw: 300,
        pitch: 0,
        label: 'Go to Student Center',
        targetPanoramaId: 'pano-3',
      },
      {
        id: 'info-2-1',
        type: 'information',
        yaw: 180,
        pitch: -15,
        label: 'About Library',
        content: {
          title: 'University Library',
          description: 'The main university library houses over 500,000 volumes and provides study spaces for 2,000 students.',
          linkUrl: 'https://example.com/library',
          linkLabel: 'Visit Library Website',
        },
      },
    ],
  },
  {
    id: 'pano-3',
    label: 'Student Center',
    imageUrl: 'https://picsum.photos/seed/pano3/2048/1024',
    heading: 270,
    hotspots: [
      {
        id: 'nav-3-1',
        type: 'navigation',
        yaw: 90,
        pitch: 0,
        label: 'Back to Main Entrance',
        targetPanoramaId: 'pano-1',
      },
      {
        id: 'nav-3-2',
        type: 'navigation',
        yaw: 210,
        pitch: 0,
        label: 'Go to Library',
        targetPanoramaId: 'pano-2',
      },
      {
        id: 'info-3-1',
        type: 'information',
        yaw: 0,
        pitch: 0,
        label: 'About Student Center',
        content: {
          title: 'Student Center',
          description: 'The student center features dining facilities, meeting rooms, and student organization offices.',
          imageUrl: 'https://picsum.photos/seed/info3/400/300',
          linkUrl: 'https://example.com/student-center',
          linkLabel: 'Learn More',
        },
      },
    ],
  },
]

// Helper function to get panorama by ID
export function getPanoramaById(id: string): TourPanorama | undefined {
  return mockPanoramas.find(p => p.id === id)
}

// Helper function to get panorama index by ID
export function getPanoramaIndexById(id: string): number {
  return mockPanoramas.findIndex(p => p.id === id)
}
