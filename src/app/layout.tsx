import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import { connection } from 'next/server'
import './globals.css'
import { EnvBanner, envBannerLabel } from '@/components/features/layout/env-banner'
import { cn } from '@/lib/utils'
import { getConfig } from '@/server/config'

// Geist is kept (decision Q-21 / 10): next/font self-hosts it at build time, so there is no runtime request to Google (CSP font-src 'self').
// It has no Japanese glyphs; Japanese text falls back to the system font.
const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })

// 08 3.4: every screen is noindex; no openGraph. Screens set `title` and get the suffix from the template.
export const metadata: Metadata = {
  title: { default: 'ファイル共有', template: '%s | ファイル共有' },
  robots: { index: false, follow: false },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render per request: Next only puts the CSP nonce (set by src/proxy.ts) on its scripts for dynamic pages. A prerendered page
  // has no nonce, and script-src with strict-dynamic then blocks every script (found in T-010 on next start). Keep this line.
  await connection()
  // 08 3.5: the banner label is decided here (Server Component) and only the label is passed down. A bad APP_ENV / VERCEL_ENV
  // combination throws in getConfig() and ends in global-error.tsx, which is intended.
  const bannerLabel = envBannerLabel(getConfig().APP_ENV)
  return (
    <html lang="ja" className={cn('font-sans', geist.variable)}>
      <body className="flex min-h-dvh flex-col">
        <EnvBanner label={bannerLabel} />
        {children}
      </body>
    </html>
  )
}
