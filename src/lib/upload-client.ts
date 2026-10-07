// Browser-side upload helpers (08 5.6). Pure or dependency-injected so that the state transitions can be tested without a DOM.
// Shared code: no 'server-only'. The only network call made here is the PUT to the signed upload URL (CLAUDE.md exception).
import type { UploadContext } from '@/lib/dto'
import type { ActionResult, AppErrorShape } from '@/lib/errors'
import { message, type MessageKey } from '@/lib/messages'

export const UPLOAD_TIMEOUT_MS = 10 * 60 * 1000
export const FINALIZE_RETRY_DELAY_MS = 3000
const MB = 1024 * 1024

export function bytesToMb(n: number): number {
  return Math.round(n / MB)
}

/** Client-side check at selection time (08 5.6). The server checks again. Returns the message text or null when the file is acceptable. */
export function validateUploadFile(file: { name: string; size: number }, ctx: UploadContext): string | null {
  const key = ((): MessageKey | null => {
    if (!/\.html?$/i.test(file.name)) return 'upload.bad_extension'
    if (file.size === 0) return 'upload.verify_empty'
    if (file.size > ctx.maxFileSizeBytes) return 'upload.too_large'
    if (file.size > ctx.userQuota.limitBytes - ctx.userQuota.usedBytes) return 'upload.quota_user'
    if (file.size > ctx.totalQuota.limitBytes - ctx.totalQuota.usedBytes) return 'upload.quota_total'
    return null
  })()
  return key === null ? null : message(key, { maxMb: bytesToMb(ctx.maxFileSizeBytes) })
}

/** Default display name: the file name without its extension, at most 200 characters (08 5.6). */
export function defaultDisplayName(filename: string): string {
  return filename.replace(/\.html?$/i, '').slice(0, 200)
}

// ---------- PUT with progress ----------

export type TransferFailure = 'failed' | 'aborted' | 'timeout'

export class UploadTransferError extends Error {
  constructor(public readonly reason: TransferFailure) {
    super(`upload transfer ${reason}`)
    this.name = 'UploadTransferError'
  }
}

/** The part of XMLHttpRequest that is used here. Lets tests supply a fake. */
export interface XhrLike {
  open(method: string, url: string): void
  setRequestHeader(name: string, value: string): void
  send(body: Blob): void
  abort(): void
  timeout: number
  status: number
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null }
  onload: (() => void) | null
  onerror: (() => void) | null
  onabort: (() => void) | null
  ontimeout: (() => void) | null
}

export interface PutOptions {
  timeoutMs?: number
  createXhr?: () => XhrLike
}

/** Adapts the real XMLHttpRequest to XhrLike without casts (the progress event type is wider there). */
function realXhr(): XhrLike {
  const x = new XMLHttpRequest()
  const view: XhrLike = {
    open: (m, u) => x.open(m, u),
    setRequestHeader: (n, v) => x.setRequestHeader(n, v),
    send: (b) => x.send(b),
    abort: () => x.abort(),
    get timeout() {
      return x.timeout
    },
    set timeout(v: number) {
      x.timeout = v
    },
    get status() {
      return x.status
    },
    upload: { onprogress: null },
    onload: null,
    onerror: null,
    onabort: null,
    ontimeout: null,
  }
  x.upload.onprogress = (e) => view.upload.onprogress?.(e)
  x.onload = () => view.onload?.()
  x.onerror = () => view.onerror?.()
  x.onabort = () => view.onabort?.()
  x.ontimeout = () => view.ontimeout?.()
  return view
}

/**
 * PUT `file` to the signed URL with every header in `headers`. fetch is not used because it cannot report upload progress.
 * Resolves on 2xx. Rejects with UploadTransferError (non-2xx / network error -> 'failed', abort -> 'aborted', timeout -> 'timeout').
 */
export function uploadWithProgress(
  url: string,
  headers: Record<string, string>,
  file: Blob,
  onProgress: (percent: number) => void,
  signal: AbortSignal,
  opts: PutOptions = {},
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new UploadTransferError('aborted'))
      return
    }
    const xhr: XhrLike = opts.createXhr ? opts.createXhr() : realXhr()
    const onAbort = (): void => xhr.abort()
    const done = (fn: () => void): void => {
      signal.removeEventListener('abort', onAbort)
      fn()
    }
    xhr.open('PUT', url)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    xhr.timeout = opts.timeoutMs ?? UPLOAD_TIMEOUT_MS
    xhr.upload.onprogress = (e): void => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.min(100, Math.floor((e.loaded / e.total) * 100)))
    }
    xhr.onload = (): void => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100)
        done(resolve)
      } else done(() => reject(new UploadTransferError('failed')))
    }
    xhr.onerror = (): void => done(() => reject(new UploadTransferError('failed')))
    xhr.onabort = (): void => done(() => reject(new UploadTransferError('aborted')))
    xhr.ontimeout = (): void => done(() => reject(new UploadTransferError('timeout')))
    signal.addEventListener('abort', onAbort, { once: true })
    xhr.send(file)
  })
}

// ---------- the whole flow ----------

export type UploadPhase =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'uploading'; percent: number }
  | { kind: 'finalizing' }
  | { kind: 'done'; fileId: string }

export type UploadOutcome = { status: 'done'; fileId: string } | { status: 'failed'; error: AppErrorShape } | { status: 'cancelled' }

export interface StartResult {
  fileId: string
  uploadUrl: string
  uploadHeaders: Record<string, string>
}

export interface UploadFlowDeps {
  start: (input: {
    folderId: string
    originalFilename: string
    displayName: string | null
    sizeBytes: number
    contentType: string
  }) => Promise<ActionResult<StartResult>>
  finalize: (fileId: string) => Promise<ActionResult<unknown>>
  cancel: (fileId: string) => Promise<unknown>
  put: (url: string, headers: Record<string, string>, file: Blob, onProgress: (percent: number) => void, signal: AbortSignal) => Promise<void>
  sleep: (ms: number) => Promise<void>
}

export interface UploadFlowInput {
  folderId: string
  file: { name: string; size: number; type: string } & Blob
  /** An empty (after trimming) value is sent as null. */
  displayName: string
}

const transferFailed = (): AppErrorShape => ({ code: 'INTERNAL', message: message('upload.transfer_failed') })

async function safeCancel(deps: UploadFlowDeps, fileId: string): Promise<void> {
  try {
    await deps.cancel(fileId) // the result is ignored (08 5.6 step 3)
  } catch {
    // The daily cleanup removes an abandoned pending row.
  }
}

async function finalizeOnce(deps: UploadFlowDeps, fileId: string): Promise<ActionResult<unknown>> {
  try {
    return await deps.finalize(fileId)
  } catch {
    return { ok: false, error: transferFailed() }
  }
}

/** 08 5.6 steps 1-5. Never throws: every failure becomes an outcome. `signal.abort()` is the [cancel] button. */
export async function runUploadFlow(
  deps: UploadFlowDeps,
  input: UploadFlowInput,
  onPhase: (p: UploadPhase) => void,
  signal: AbortSignal,
): Promise<UploadOutcome> {
  onPhase({ kind: 'starting' })
  let started: ActionResult<StartResult>
  try {
    started = await deps.start({
      folderId: input.folderId,
      originalFilename: input.file.name,
      displayName: input.displayName.trim() === '' ? null : input.displayName.trim(),
      sizeBytes: input.file.size,
      contentType: input.file.type,
    })
  } catch {
    onPhase({ kind: 'idle' })
    return { status: 'failed', error: transferFailed() }
  }
  if (!started.ok) {
    onPhase({ kind: 'idle' })
    return { status: 'failed', error: started.error }
  }
  const { fileId, uploadUrl, uploadHeaders } = started.data

  onPhase({ kind: 'uploading', percent: 0 })
  try {
    await deps.put(uploadUrl, uploadHeaders, input.file, (percent) => onPhase({ kind: 'uploading', percent }), signal)
  } catch (e) {
    await safeCancel(deps, fileId)
    onPhase({ kind: 'idle' })
    if (e instanceof UploadTransferError && e.reason === 'aborted') return { status: 'cancelled' }
    return { status: 'failed', error: transferFailed() }
  }

  onPhase({ kind: 'finalizing' })
  let result = await finalizeOnce(deps, fileId)
  if (!result.ok && result.error.code === 'UPLOAD_NOT_FOUND') {
    await deps.sleep(FINALIZE_RETRY_DELAY_MS)
    result = await finalizeOnce(deps, fileId)
    if (!result.ok && result.error.code === 'UPLOAD_NOT_FOUND') await safeCancel(deps, fileId)
  }
  if (!result.ok) {
    onPhase({ kind: 'idle' })
    return { status: 'failed', error: result.error }
  }
  onPhase({ kind: 'done', fileId })
  return { status: 'done', fileId }
}
