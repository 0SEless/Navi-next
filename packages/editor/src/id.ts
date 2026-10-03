let _counter = 0

export function genId(prefix = ''): string {
  const n = ++_counter
  const r = Math.random().toString(36).slice(2, 6)
  return prefix ? `${prefix}-${n}-${r}` : `${n}-${r}`
}
