'use client'
// 08 4.10. The only place where uploaded HTML is rendered: an iframe whose src is the /raw/[ticket] URL on CONTENT_ORIGIN (02 5.7).
// sandbox is exactly "allow-scripts"; never add allow-same-origin / allow-forms / allow-popups / allow-top-navigation / allow-downloads.
// The content of the frame is never touched (no contentWindow, no postMessage handling, no srcdoc).
import { useEffect, useState } from 'react'
import { VIEWER_TEXT } from '@/lib/messages'

export const SLOW_LOAD_MS = 15_000
export const IFRAME_SANDBOX = 'allow-scripts'

/** Status line shown in the iframe position while the Action is running (no URL yet). */
export function FrameLoading() {
  return (
    <div role="status" className="flex items-center justify-center text-sm text-muted-foreground" style={{ height: 'calc(100dvh - var(--viewer-header-height, 7rem))' }}>
      {VIEWER_TEXT.loading}
    </div>
  )
}

function Frame({ viewUrl, fileName }: { viewUrl: string; fileName: string }) {
  const [loaded, setLoaded] = useState(false)
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (loaded) return
    const t = setTimeout(() => setSlow(true), SLOW_LOAD_MS)
    return () => clearTimeout(t)
  }, [loaded])
  return (
    <div className="relative">
      {!loaded ? (
        <div role="status" className="absolute inset-x-0 top-0 z-10 bg-background px-4 py-2 text-center text-sm text-muted-foreground">
          {slow ? VIEWER_TEXT.slow : VIEWER_TEXT.loading}
        </div>
      ) : null}
      <iframe
        src={viewUrl}
        sandbox={IFRAME_SANDBOX}
        referrerPolicy="no-referrer"
        allow=""
        title={`${fileName}（アップロードされた HTML）`}
        className="block w-full border-0"
        style={{ height: 'calc(100dvh - var(--viewer-header-height, 7rem))' }}
        onLoad={() => setLoaded(true)}
      />
    </div>
  )
}

/** `key` makes a reload (new viewUrl) a new element with fresh loading state. */
export function ContentFrame({ viewUrl, fileName }: { viewUrl: string; fileName: string }) {
  return <Frame key={viewUrl} viewUrl={viewUrl} fileName={fileName} />
}
