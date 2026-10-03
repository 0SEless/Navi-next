import { X } from 'lucide-react';
import type { ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-50 w-full max-w-lg rounded-xl bg-[var(--navi-card)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--navi-border)] px-6 py-4">
          <h2 className="text-lg font-semibold text-[var(--navi-text)]">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-[var(--navi-text-secondary)] hover:bg-[var(--navi-content)] hover:text-[var(--navi-text)] cursor-pointer">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  );
}
