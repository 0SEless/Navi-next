import type { Metadata } from 'next'
import 'maplibre-gl/dist/maplibre-gl.css'

export const metadata: Metadata = {
  title: 'NAVI Studio',
  description: 'Multi-campus navigation wayfinding system',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, width: '100vw', height: '100vh', overflow: 'hidden' }}>
        {children}
      </body>
    </html>
  )
}
