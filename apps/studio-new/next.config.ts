import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  outputFileTracingRoot: path.resolve(__dirname, '../../'),
}

export default nextConfig
