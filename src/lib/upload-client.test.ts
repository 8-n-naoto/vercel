// State transitions of the upload flow (08 5.6) with a fake XHR and injected Actions. No DOM, no network.
import { describe, expect, it, vi } from 'vitest'
import type { UploadContext } from '@/lib/dto'
import type { ActionResult } from '@/lib/errors'
import {
  FINALIZE_RETRY_DELAY_MS,
  runUploadFlow,
  UploadTransferError,
  uploadWithProgress,
  validateUploadFile,
  defaultDisplayName,
  type UploadFlowDeps,
  type UploadPhase,
  type XhrLike,
} from './upload-client'

const MB = 1024 * 1024
const ctx: UploadContext = {
  folder: { id: 'f', name: 'folder' },
  maxFileSizeBytes: 50 * MB,
  userQuota: { usedBytes: 10 * MB, limitBytes: 100 * MB },
  totalQuota: { usedBytes: 20 * MB, limitBytes: 200 * MB },
}

describe('validateUploadFile (08 5.6 client checks, S06-2)', () => {
  it('accepts .html and .htm (case-insensitive)', () => {
    expect(validateUploadFile({ name: 'a.html', size: 10 }, ctx)).toBeNull()
    expect(validateUploadFile({ name: 'A.HTM', size: 10 }, ctx)).toBeNull()
  })
  it('rejects a bad extension with the upload.bad_extension text', () => {
    expect(validateUploadFile({ name: 'a.txt', size: 10 }, ctx)).toBe('.html または .htm のファイルを選択してください')
  })
  it('rejects an empty file', () => {
    expect(validateUploadFile({ name: 'a.html', size: 0 }, ctx)).toBe('ファイルが空です')
  })
  it('rejects a file above the limit, with the limit in MB', () => {
    expect(validateUploadFile({ name: 'a.html', size: 50 * MB + 1 }, ctx)).toBe('ファイルサイズが上限（50MB）を超えています')
    expect(validateUploadFile({ name: 'a.html', size: 50 * MB }, ctx)).toBeNull()
  })
  it('rejects a file above the personal and the total remaining quota', () => {
    const tight = { ...ctx, userQuota: { usedBytes: 99 * MB, limitBytes: 100 * MB } }
    expect(validateUploadFile({ name: 'a.html', size: 2 * MB }, tight)).toContain('あなたが使える容量')
    const tightTotal = { ...ctx, totalQuota: { usedBytes: 199 * MB, limitBytes: 200 * MB } }
    expect(validateUploadFile({ name: 'a.html', size: 2 * MB }, tightTotal)).toContain('全体の容量')
  })
})

describe('defaultDisplayName', () => {
  it('drops the extension and caps at 200 characters', () => {
    expect(defaultDisplayName('report.final.html')).toBe('report.final')
    expect(defaultDisplayName(`${'あ'.repeat(250)}.htm`)).toHaveLength(200)
  })
})

class FakeXhr implements XhrLike {
  method = ''
  url = ''
  headers: Record<string, string> = {}
  sent: Blob | null = null
  timeout = 0
  status = 0
  aborted = false
  upload: XhrLike['upload'] = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  ontimeout: (() => void) | null = null
  open(method: string, url: string): void {
    this.method = method
    this.url = url
  }
  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value
  }
  send(body: Blob): void {
    this.sent = body
  }
  abort(): void {
    this.aborted = true
    this.onabort?.()
  }
}

describe('uploadWithProgress', () => {
  const blob = new Blob(['<html></html>'])
  it('sends PUT with every header, reports progress and resolves on 2xx', async () => {
    const xhr = new FakeXhr()
    const progress: number[] = []
    const p = uploadWithProgress('https://u/x', { 'content-type': 'text/html', 'x-upsert': 'false' }, blob, (n) => progress.push(n), new AbortController().signal, {
      createXhr: () => xhr,
    })
    expect(xhr.method).toBe('PUT')
    expect(xhr.url).toBe('https://u/x')
    expect(xhr.headers).toEqual({ 'content-type': 'text/html', 'x-upsert': 'false' })
    expect(xhr.timeout).toBe(10 * 60 * 1000)
    expect(xhr.sent).toBe(blob)
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 200 })
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 200, total: 200 })
    xhr.status = 200
    xhr.onload?.()
    await expect(p).resolves.toBeUndefined()
    expect(progress).toEqual([25, 100, 100])
  })
  it('rejects with failed on a non-2xx status or a network error', async () => {
    const a = new FakeXhr()
    const pa = uploadWithProgress('u', {}, blob, () => undefined, new AbortController().signal, { createXhr: () => a })
    a.status = 403
    a.onload?.()
    await expect(pa).rejects.toMatchObject({ reason: 'failed' })
    const b = new FakeXhr()
    const pb = uploadWithProgress('u', {}, blob, () => undefined, new AbortController().signal, { createXhr: () => b })
    b.onerror?.()
    await expect(pb).rejects.toMatchObject({ reason: 'failed' })
  })
  it('rejects with timeout, and with aborted when the signal fires (xhr.abort is called)', async () => {
    const a = new FakeXhr()
    const pa = uploadWithProgress('u', {}, blob, () => undefined, new AbortController().signal, { createXhr: () => a, timeoutMs: 5 })
    expect(a.timeout).toBe(5)
    a.ontimeout?.()
    await expect(pa).rejects.toMatchObject({ reason: 'timeout' })
    const ac = new AbortController()
    const b = new FakeXhr()
    const pb = uploadWithProgress('u', {}, blob, () => undefined, ac.signal, { createXhr: () => b })
    ac.abort()
    expect(b.aborted).toBe(true)
    await expect(pb).rejects.toBeInstanceOf(UploadTransferError)
    await expect(pb).rejects.toMatchObject({ reason: 'aborted' })
  })
})

// ---------- runUploadFlow ----------

const ok = <T,>(data: T): ActionResult<T> => ({ ok: true, data })
const fail = (code: 'UPLOAD_NOT_FOUND' | 'UPLOAD_VERIFICATION_FAILED' | 'QUOTA_EXCEEDED', msg: string): ActionResult<never> => ({
  ok: false,
  error: { code, message: msg },
})
const file = new File(['<html></html>'], 'a.html', { type: 'text/html' })
const input = { folderId: 'folder-1', file, displayName: '  my file  ' }

function makeDeps(over: Partial<UploadFlowDeps> = {}): UploadFlowDeps & {
  start: ReturnType<typeof vi.fn>
  finalize: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  sleep: ReturnType<typeof vi.fn>
} {
  return {
    start: vi.fn(() => Promise.resolve(ok({ fileId: 'file-1', uploadUrl: 'https://u', uploadHeaders: { a: 'b' } }))),
    finalize: vi.fn(() => Promise.resolve(ok({ id: 'file-1' }))),
    cancel: vi.fn(() => Promise.resolve(ok(null))),
    put: vi.fn((_u: string, _h: Record<string, string>, _f: Blob, onProgress: (n: number) => void) => {
      onProgress(40)
      onProgress(100)
      return Promise.resolve()
    }),
    sleep: vi.fn(() => Promise.resolve()),
    ...over,
  } as never
}

function phases(): { list: UploadPhase[]; push: (p: UploadPhase) => void } {
  const list: UploadPhase[] = []
  return { list, push: (p) => list.push(p) }
}

describe('runUploadFlow', () => {
  it('success: idle -> starting -> uploading(0..100) -> finalizing -> done; the display name is trimmed', async () => {
    const deps = makeDeps()
    const ph = phases()
    const out = await runUploadFlow(deps, input, ph.push, new AbortController().signal)
    expect(out).toEqual({ status: 'done', fileId: 'file-1' })
    expect(ph.list.map((p) => p.kind)).toEqual(['starting', 'uploading', 'uploading', 'uploading', 'finalizing', 'done'])
    expect(ph.list.filter((p) => p.kind === 'uploading').map((p) => (p.kind === 'uploading' ? p.percent : -1))).toEqual([0, 40, 100])
    expect(deps.start).toHaveBeenCalledWith({ folderId: 'folder-1', originalFilename: 'a.html', displayName: 'my file', sizeBytes: file.size, contentType: 'text/html' })
    expect(deps.put).toHaveBeenCalledWith('https://u', { a: 'b' }, file, expect.any(Function), expect.any(AbortSignal))
    expect(deps.cancel).not.toHaveBeenCalled()
  })
  it('an empty display name is sent as null', async () => {
    const deps = makeDeps()
    await runUploadFlow(deps, { ...input, displayName: '   ' }, () => undefined, new AbortController().signal)
    expect(deps.start).toHaveBeenCalledWith(expect.objectContaining({ displayName: null }))
  })
  it('startUpload failure: shows the error and returns to idle without PUT or cancel', async () => {
    const deps = makeDeps({ start: vi.fn(() => Promise.resolve(fail('QUOTA_EXCEEDED', 'quota'))) })
    const ph = phases()
    const out = await runUploadFlow(deps, input, ph.push, new AbortController().signal)
    expect(out).toMatchObject({ status: 'failed', error: { code: 'QUOTA_EXCEEDED', message: 'quota' } })
    expect(ph.list.at(-1)).toEqual({ kind: 'idle' })
    expect(deps.put).not.toHaveBeenCalled()
    expect(deps.cancel).not.toHaveBeenCalled()
  })
  it('PUT failure: calls cancelUpload and shows upload.transfer_failed', async () => {
    const deps = makeDeps({ put: vi.fn(() => Promise.reject(new UploadTransferError('failed'))) })
    const ph = phases()
    const out = await runUploadFlow(deps, input, ph.push, new AbortController().signal)
    expect(deps.cancel).toHaveBeenCalledWith('file-1')
    expect(out).toMatchObject({ status: 'failed', error: { message: 'アップロードに失敗しました。通信状態を確認して、もう一度お試しください' } })
    expect(ph.list.at(-1)).toEqual({ kind: 'idle' })
    expect(deps.finalize).not.toHaveBeenCalled()
  })
  it('a timeout is handled like a PUT failure', async () => {
    const deps = makeDeps({ put: vi.fn(() => Promise.reject(new UploadTransferError('timeout'))) })
    const out = await runUploadFlow(deps, input, () => undefined, new AbortController().signal)
    expect(deps.cancel).toHaveBeenCalledWith('file-1')
    expect(out.status).toBe('failed')
  })
  it('a failing cancelUpload does not hide the PUT failure', async () => {
    const deps = makeDeps({ put: vi.fn(() => Promise.reject(new UploadTransferError('failed'))), cancel: vi.fn(() => Promise.reject(new Error('x'))) })
    const out = await runUploadFlow(deps, input, () => undefined, new AbortController().signal)
    expect(out.status).toBe('failed')
  })
  it('[cancel]: abort during the PUT -> cancelUpload -> cancelled, back to idle (S06-4)', async () => {
    const ac = new AbortController()
    const deps = makeDeps({
      put: vi.fn((_u: string, _h: Record<string, string>, _f: Blob, _p: (n: number) => void, signal: AbortSignal) =>
        new Promise<void>((_res, rej) => {
          signal.addEventListener('abort', () => rej(new UploadTransferError('aborted')))
        })),
    })
    const ph = phases()
    const run = runUploadFlow(deps, input, ph.push, ac.signal)
    await Promise.resolve()
    ac.abort()
    expect(await run).toEqual({ status: 'cancelled' })
    expect(deps.cancel).toHaveBeenCalledWith('file-1')
    expect(deps.finalize).not.toHaveBeenCalled()
    expect(ph.list.at(-1)).toEqual({ kind: 'idle' })
  })
  it('finalize: UPLOAD_NOT_FOUND is retried once after 3 seconds and can succeed', async () => {
    const finalize = vi.fn().mockResolvedValueOnce(fail('UPLOAD_NOT_FOUND', 'nf')).mockResolvedValueOnce(ok({ id: 'file-1' }))
    const deps = makeDeps({ finalize })
    const out = await runUploadFlow(deps, input, () => undefined, new AbortController().signal)
    expect(out).toEqual({ status: 'done', fileId: 'file-1' })
    expect(deps.sleep).toHaveBeenCalledWith(FINALIZE_RETRY_DELAY_MS)
    expect(FINALIZE_RETRY_DELAY_MS).toBe(3000)
    expect(finalize).toHaveBeenCalledTimes(2)
    expect(deps.cancel).not.toHaveBeenCalled()
  })
  it('finalize: UPLOAD_NOT_FOUND twice -> cancelUpload and the server message', async () => {
    const finalize = vi.fn(() => Promise.resolve(fail('UPLOAD_NOT_FOUND', 'まだ確認できません')))
    const deps = makeDeps({ finalize })
    const out = await runUploadFlow(deps, input, () => undefined, new AbortController().signal)
    expect(finalize).toHaveBeenCalledTimes(2)
    expect(deps.cancel).toHaveBeenCalledWith('file-1')
    expect(out).toMatchObject({ status: 'failed', error: { code: 'UPLOAD_NOT_FOUND', message: 'まだ確認できません' } })
  })
  it('finalize: other failures are shown as they are, without retry or cancel (S06-3: the server already removed the row)', async () => {
    const finalize = vi.fn(() => Promise.resolve(fail('UPLOAD_VERIFICATION_FAILED', 'テキスト（HTML）ではないファイルです')))
    const deps = makeDeps({ finalize })
    const ph = phases()
    const out = await runUploadFlow(deps, input, ph.push, new AbortController().signal)
    expect(out).toMatchObject({ status: 'failed', error: { message: 'テキスト（HTML）ではないファイルです' } })
    expect(finalize).toHaveBeenCalledTimes(1)
    expect(deps.sleep).not.toHaveBeenCalled()
    expect(deps.cancel).not.toHaveBeenCalled()
    expect(ph.list.at(-1)).toEqual({ kind: 'idle' })
  })
})
