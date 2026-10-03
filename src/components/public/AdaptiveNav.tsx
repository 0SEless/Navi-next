'use client'

import { usePublicStore } from '@/store/public-store'
import {
  Home,
  Compass,
  MapPin,
  User,
  type LucideIcon,
} from 'lucide-react'
import { PRIMARY_NAV_ITEMS, type PrimaryNavId } from '@/lib/public-app-contracts'
import { useRouter } from 'next/navigation'

interface NavItem {
  id: PrimaryNavId
  label: string
  path: string
  icon: LucideIcon
}

const navIcons: Record<PrimaryNavId, LucideIcon> = {
  home: Home,
  explore: Compass,
  navigate: MapPin,
  profile: User,
}

const navItems: NavItem[] = PRIMARY_NAV_ITEMS.map((item) => ({
  ...item,
  icon: navIcons[item.id],
}))

function NavIcon({ item, active, onSelect }: { item: NavItem; active: boolean; onSelect: (item: NavItem) => void }) {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={`flex flex-1 flex-col items-center justify-center gap-0.5 self-stretch min-h-[44px] min-w-[44px] py-1
        ${active ? 'text-[var(--navi-primary)]' : 'text-[var(--navi-text-secondary)]'}
        transition-colors duration-150`}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
    >
      <Icon className="h-5 w-5" />
      <span className="text-[11px] font-medium leading-tight">{item.label}</span>
    </button>
  )
}

function SidebarItem({ item, active, onSelect }: { item: NavItem; active: boolean; onSelect: (item: NavItem) => void }) {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors
        ${active
          ? 'bg-[var(--navi-primary)]/10 text-[var(--navi-primary)]'
          : 'text-[var(--navi-text-secondary)] hover:bg-[var(--navi-border)]/50 hover:text-[var(--navi-text)]'
        }`}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span>{item.label}</span>
    </button>
  )
}

export function AdaptiveNav() {
  const activeTab = usePublicStore((s) => s.activeTab)
  const router = useRouter()

  const handleSelect = (item: NavItem) => {
    usePublicStore.getState().setTab(item.id)
    router.push(item.path)
  }

  return (
    <>
      {/* Bottom nav: phones & tablet portrait (<1024px) */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex min-h-16 items-stretch justify-around border-t border-[var(--navi-border)] bg-[var(--navi-card)] px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-1px_3px_rgba(0,0,0,0.05)] lg:hidden">
        {navItems.map((item) => (
          <NavIcon key={item.id} item={item} active={activeTab === item.id} onSelect={handleSelect} />
        ))}
      </nav>

      {/* Sidebar: tablet landscape & desktop (>=1024px) */}
      <aside className="hidden lg:flex lg:w-56 lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 lg:z-50 lg:border-r lg:border-[var(--navi-border)] lg:bg-[var(--navi-card)] lg:pt-4">
        <div className="flex items-center gap-2 px-4 pb-4 mb-2 border-b border-[var(--navi-border)]">
          <div className="h-8 w-8 rounded-lg bg-[var(--navi-primary)] flex items-center justify-center">
            <span className="text-white font-bold text-sm">N</span>
          </div>
          <span className="font-semibold text-[var(--navi-text)]">NAVI</span>
        </div>
        <div className="flex-1 px-2 space-y-1">
          {navItems.map((item) => (
            <SidebarItem key={item.id} item={item} active={activeTab === item.id} onSelect={handleSelect} />
          ))}
        </div>
      </aside>
    </>
  )
}
