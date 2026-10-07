import type { Metadata } from 'next'
import { connection } from 'next/server'
import './globals.css'
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});


// Minimal root layout for WP-0.1. The real layout (banner, fonts) is WP-0.9 (08 section 3).
export const metadata: Metadata = {
  title: 'File Share',
  description: 'Internal file sharing',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Render per request: Next only puts the CSP nonce (set by src/proxy.ts) on its scripts for dynamic pages. A prerendered page
  // has no nonce, and script-src with strict-dynamic then blocks every script (found in T-010 on next start).
  await connection()
  return (
    <html lang="ja" className={cn("font-sans", geist.variable)}>
      <body>{children}</body>
    </html>
  )
}
