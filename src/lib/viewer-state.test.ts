import { describe, expect, it, vi } from 'vitest'
import type { OpenAsMemberResult } from '@/lib/dto'
import type { ActionResult, AppErrorShape } from '@/lib/errors'
import { loadViewer, runDownload, toViewerState, type ViewerDeps } from './viewer-state'

const ok = (canDownload: boolean): ActionResult<OpenAsMemberResult> => ({
  ok: true,
  data: { viewUrl: 'https://content.example/raw/tok', canDownload, mode: 'member' },
})
const fail = (error: AppErrorShape): ActionResult<never> => ({ ok: false, error })

function makeDeps(over: Partial<ViewerDeps> = {}): ViewerDeps {
  return {
    open: vi.fn(() => Promise.resolve(ok(true))),
    requestDownload: vi.fn(() =>
      Promise.resolve({ ok: true as const, data: { downloadUrl: 'https://content.example/raw/dl', expiresAt: '2026-01-01T00:00:00Z' } }),
    ),
    assign: vi.fn(),
    ...over,
  }
}

describe('toViewerState', () => {
  it('success -> ready with viewUrl and canDownload', () => {
    expect(toViewerState(ok(false))).toEqual({ kind: 'ready', viewUrl: 'https://content.example/raw/tok', canDownload: false })
  })
  it('ACCESS_DENIED -> denied with the server message', () => {
    expect(toViewerState(fail({ code: 'ACCESS_DENIED', message: '現在、公開が停止されています', reason: 'SUSPENDED' }))).toEqual({
      kind: 'denied',
      message: '現在、公開が停止されています',
    })
  })
  it('NOT_FOUND -> denied', () => {
    expect(toViewerState(fail({ code: 'NOT_FOUND', message: 'このファイルは存在しないか、閲覧できません' }))).toEqual({
      kind: 'denied',
      message: 'このファイルは存在しないか、閲覧できません',
    })
  })
  it('other codes -> error', () => {
    const error: AppErrorShape = { code: 'INTERNAL', message: 'エラーが発生しました（ID: x）' }
    expect(toViewerState(fail(error))).toEqual({ kind: 'error', error })
  })
})

describe('loadViewer', () => {
  it('calls the open Action once per invocation with the file id; a second call (reload) issues another', async () => {
    const deps = makeDeps()
    await loadViewer(deps, 'f1')
    expect(deps.open).toHaveBeenCalledTimes(1)
    expect(deps.open).toHaveBeenCalledWith({ fileId: 'f1' })
    await loadViewer(deps, 'f1')
    expect(deps.open).toHaveBeenCalledTimes(2)
  })
  it('a rejected Action becomes an error state instead of staying in loading', async () => {
    const deps = makeDeps({ open: vi.fn(() => Promise.reject(new Error('network'))) })
    expect((await loadViewer(deps, 'f1')).kind).toBe('error')
  })
})

describe('runDownload', () => {
  it('success navigates to downloadUrl and returns null', async () => {
    const deps = makeDeps()
    expect(await runDownload(deps, 'f1')).toBeNull()
    expect(deps.requestDownload).toHaveBeenCalledWith({ fileId: 'f1' })
    expect(deps.assign).toHaveBeenCalledWith('https://content.example/raw/dl')
  })
  it('failure returns the error and does not navigate', async () => {
    const error: AppErrorShape = { code: 'ACCESS_DENIED', message: 'このファイルはダウンロードできません', reason: 'DOWNLOAD_NOT_ALLOWED' }
    const deps = makeDeps({ requestDownload: vi.fn(() => Promise.resolve(fail(error))) })
    expect(await runDownload(deps, 'f1')).toEqual(error)
    expect(deps.assign).not.toHaveBeenCalled()
  })
  it('a rejected Action returns an error and does not navigate', async () => {
    const deps = makeDeps({ requestDownload: vi.fn(() => Promise.reject(new Error('network'))) })
    expect((await runDownload(deps, 'f1'))?.code).toBe('INTERNAL')
    expect(deps.assign).not.toHaveBeenCalled()
  })
})
