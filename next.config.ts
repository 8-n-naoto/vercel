import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  images: { unoptimized: true },
  // Do NOT set cacheComponents (it disables route segment config such as maxDuration / dynamic).
  // Security headers are set in src/proxy.ts (CSP needs a per-request nonce), not here.
}

export default nextConfig
