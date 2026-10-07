'use client'
// 08 5.8 MemberViewer. Calls viewOpenAsMember exactly once on mount (the ref guard survives the StrictMode effect re-run), again on [再読み込み].
// The state transitions live in src/lib/viewer-state.ts.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { viewOpenAsMember, viewRequestMemberDownload } from '@/app/_actions/view'
import { ErrorScreen } from '@/components/features/common/error-screen'
import { handleCommonError } from '@/components/features/common/handle-common-error'
import type { MemberViewContext } from '@/lib/dto'
import type { AppErrorShape } from '@/lib/errors'
import { INITIAL_VIEWER_STATE, loadViewer, runDownload, type ViewerDeps, type ViewerState } from '@/lib/viewer-state'
import { ContentFrame, FrameLoading } from './content-frame'
import { ViewerHeader } from './viewer-header'

const deps: ViewerDeps = {
  open: viewOpenAsMember,
  requestDownload: viewRequestMemberDownload,
  assign: (url) => window.location.assign(url),
}

/** Keeps --viewer-header-height on `root` equal to the height of `header` (08 4.10). */
function useHeaderHeight(root: React.RefObject<HTMLDivElement | null>, header: React.RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const h = header.current
    const r = root.current
    if (!h || !r) return
    const update = () => r.style.setProperty('--viewer-header-height', `${h.offsetHeight}px`)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(h)
    return () => ro.disconnect()
  }, [root, header])
}

export function MemberViewer({ context }: { context: MemberViewContext }) {
  const router = useRouter()
  const fileId = context.file.id
  const [state, setState] = useState<ViewerState>(INITIAL_VIEWER_STATE)
  const [downloadPending, setDownloadPending] = useState(false)
  const [downloadError, setDownloadError] = useState<AppErrorShape | null>(null)
  const started = useRef(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const headerRef = useRef<HTMLDivElement | null>(null)
  useHeaderHeight(rootRef, headerRef)

  const open = useCallback(async () => {
    setState(INITIAL_VIEWER_STATE) // the previous iframe is discarded here
    const next = await loadViewer(deps, fileId)
    if (next.kind === 'error') handleCommonError(next.error, router)
    setState(next)
  }, [fileId, router])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void open()
  }, [open])

  const download = useCallback(async () => {
    setDownloadPending(true)
    setDownloadError(null)
    const err = await runDownload(deps, fileId)
    if (err) handleCommonError(err, router)
    setDownloadError(err)
    setDownloadPending(false)
  }, [fileId, router])

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      <div ref={headerRef}>
        <ViewerHeader
          context={context}
          canDownload={state.kind === 'ready' && state.canDownload}
          reloadDisabled={state.kind === 'loading'}
          downloadPending={downloadPending}
          downloadError={downloadError}
          onReload={() => void open()}
          onDownload={() => void download()}
        />
      </div>
      {state.kind === 'loading' ? <FrameLoading /> : null}
      {state.kind === 'ready' ? <ContentFrame viewUrl={state.viewUrl} fileName={context.file.displayName} /> : null}
      {state.kind === 'denied' ? <ErrorScreen variant="access_denied" message={state.message} /> : null}
      {state.kind === 'error' ? <ErrorScreen variant="internal" message={state.error.message} showFolderLink={false} /> : null}
    </div>
  )
}
