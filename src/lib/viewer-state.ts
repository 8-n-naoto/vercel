// State transitions of the S08 viewer (08 5.8), kept free of React and the DOM so that they can be tested with mocked Actions.
// Shared code: no 'server-only'.
import type { OpenAsMemberResult } from '@/lib/dto'
import type { ActionResult, AppErrorShape } from '@/lib/errors'

export type ViewerState =
  | { kind: 'loading' }
  | { kind: 'ready'; viewUrl: string; canDownload: boolean }
  | { kind: 'denied'; message: string } // ACCESS_DENIED / NOT_FOUND: shown in place of the iframe, no download button
  | { kind: 'error'; error: AppErrorShape } // everything else (08 7.3)

export const INITIAL_VIEWER_STATE: ViewerState = { kind: 'loading' }

export function toViewerState(r: ActionResult<OpenAsMemberResult>): ViewerState {
  if (r.ok) return { kind: 'ready', viewUrl: r.data.viewUrl, canDownload: r.data.canDownload }
  if (r.error.code === 'ACCESS_DENIED' || r.error.code === 'NOT_FOUND') return { kind: 'denied', message: r.error.message }
  return { kind: 'error', error: r.error }
}

/** The Action may reject (network failure); the screen must not stay in "loading". */
export function networkFailure(): AppErrorShape {
  return { code: 'INTERNAL', message: 'エラーが発生しました' }
}

export interface ViewerDeps {
  open: (input: { fileId: string }) => Promise<ActionResult<OpenAsMemberResult>>
  requestDownload: (input: { fileId: string }) => Promise<ActionResult<{ downloadUrl: string; expiresAt: string }>>
  assign: (url: string) => void // window.location.assign
}

/** Calls viewOpenAsMember once per invocation. A new call issues a new ticket (reload). */
export async function loadViewer(deps: ViewerDeps, fileId: string): Promise<ViewerState> {
  try {
    return toViewerState(await deps.open({ fileId }))
  } catch {
    return { kind: 'error', error: networkFailure() }
  }
}

/** Resolves to the error to show in the header, or null on success (the browser then saves the file; the page does not navigate). */
export async function runDownload(deps: ViewerDeps, fileId: string): Promise<AppErrorShape | null> {
  try {
    const r = await deps.requestDownload({ fileId })
    if (!r.ok) return r.error
    deps.assign(r.data.downloadUrl)
    return null
  } catch {
    return networkFailure()
  }
}
