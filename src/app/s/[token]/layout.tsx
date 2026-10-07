import type { Metadata } from 'next'

// 08 3.3 / 3.4 public viewer layout (S09): no navigation, no user info, fixed title (the file name is never put in the title),
// no Open Graph / Twitter metadata. noindex comes from the root layout.
export const metadata: Metadata = { title: { absolute: '共有ファイル' } }

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col">{children}</div>
}
