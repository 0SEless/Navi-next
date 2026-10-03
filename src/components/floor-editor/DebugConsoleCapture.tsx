'use client'

import { useEffect } from 'react'

export function DebugConsoleCapture() {
  useEffect(() => {
    const orig = console.error
    const els: string[] = []
    console.error = (...args: unknown[]) => {
      const msg = args.map((a) => {
        if (typeof a === 'string') return a
        try { return JSON.stringify(a) } catch { return String(a) }
      }).join(' | ')
      els.push(msg)
      orig.apply(console, args)
    }
    const div = document.createElement('div')
    div.id = 'react-185-debug'
    div.style.cssText = 'position:fixed;bottom:0;right:0;width:500px;max-height:300px;background:#1E293B;color:#F87171;font:10px monospace;overflow:auto;z-index:9999;padding:8px;border-radius:8px 0 0 0;white-space:pre-wrap'
    document.body.appendChild(div)
    const update = () => { div.textContent = els.join('\n\n===\n\n') }
    const origSet = (window as unknown as Record<string, unknown>).__consoleErrorCapture
    ;(window as unknown as Record<string, unknown>).__consoleErrorCapture = els
    const observer = new MutationObserver(() => update())
    observer.observe(div, { childList: true })
    update()
    return () => { console.error = orig; div.remove(); observer.disconnect() }
  }, [])
  return null
}
