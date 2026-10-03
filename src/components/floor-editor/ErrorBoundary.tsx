'use client'

import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error('[FloorEditor ErrorBoundary] Caught:', error.message)
    console.error('[FloorEditor ErrorBoundary] Stack:', error.stack)
    console.error('[FloorEditor ErrorBoundary] Component stack:', info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 20 }}>
          <h2>Something went wrong</h2>
          <pre style={{ fontSize: 11 }}>{this.state.error?.message}</pre>
          <pre style={{ fontSize: 10, color: '#666', marginTop: 8 }}>{this.state.error?.stack}</pre>
        </div>
      )
    }
    return this.props.children
  }
}
