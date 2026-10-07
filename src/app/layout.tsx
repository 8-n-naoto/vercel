import type { Metadata } from 'next'
import './globals.css'
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});


// Minimal root layout for WP-0.1. The real layout (banner, fonts) is WP-0.9 (08 section 3).
export const metadata: Metadata = {
  title: 'File Share',
  description: 'Internal file sharing',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={cn("font-sans", geist.variable)}>
      <body>{children}</body>
    </html>
  )
}
