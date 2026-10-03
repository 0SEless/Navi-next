'use client'

import * as Dialog from '@radix-ui/react-dialog'
import { Phone, X, ShieldAlert } from 'lucide-react'

const emergencyContacts = [
  { label: 'Campus Security', number: '(123) 456-7890' },
  { label: 'Emergency Hotline', number: '911' },
  { label: 'Health Services', number: '(123) 456-7891' },
  { label: 'IT Support', number: '(123) 456-7892' },
]

interface EmergencyOverlayProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function EmergencyOverlay({ open, onOpenChange }: EmergencyOverlayProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-[200] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[201] w-[calc(100%-2rem)] max-w-sm rounded-xl bg-[var(--navi-card)] p-6 shadow-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in data-[state=closed]:zoom-out data-[state=open]:zoom-out">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-red-100 flex items-center justify-center">
                <ShieldAlert className="h-4 w-4 text-red-600" />
              </div>
              <Dialog.Title className="text-lg font-semibold text-[var(--navi-text)]">
                Emergency
              </Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button
                className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-[var(--navi-border)] transition-colors"
                aria-label="Close emergency overlay"
              >
                <X className="h-4 w-4 text-[var(--navi-text-secondary)]" />
              </button>
            </Dialog.Close>
          </div>

          <Dialog.Description className="text-sm text-[var(--navi-text-secondary)] mb-4">
            In case of emergency, contact campus security or dial 911 immediately.
          </Dialog.Description>

          <div className="space-y-2">
            {emergencyContacts.map((contact) => (
              <div
                key={contact.label}
                className="flex items-center justify-between p-3 rounded-lg bg-[var(--navi-tint-red)] border border-[var(--navi-border)]"
              >
                <span className="text-sm font-medium text-[var(--navi-text)]">
                  {contact.label}
                </span>
                <a
                  href={`tel:${contact.number.replace(/\D/g, '')}`}
                  className="flex items-center gap-1.5 text-sm font-semibold text-red-600 hover:text-red-700 transition-colors"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {contact.number}
                </a>
              </div>
            ))}
          </div>

          <p className="text-[10px] text-[var(--navi-text-secondary)] mt-4 text-center">
            Emergency information is pre-loaded for quick access.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
