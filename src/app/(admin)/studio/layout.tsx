import { StoreInitializer } from '@/components/studio/StoreInitializer'

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <StoreInitializer />
      {children}
    </div>
  )
}
