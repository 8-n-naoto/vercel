import { describe, expect, it, vi } from 'vitest'
import { AppError } from '@/lib/errors'
import type { ServiceContext } from '@/server/actions/define-action'
import type { AccessLogInsert } from '@/server/repositories/access-logs'
import type { FileRow } from '@/server/repositories/files'
import { hashToken } from '@/server/security/tokens'
import { viewService, type ViewContextDeps, type ViewDeps } from './view'

vi.mock('@/server/db/client', () => ({ getDb: vi.fn() }))

const FOLDER = '00000000-0000-4000-8000-000000000010'
const FILE = '00000000-0000-4000-8000-000000000020'
const ORIGIN = 'https://content.example.com'
const now = new Date('2026-10-08T03:00:00.000Z')
const TOKEN = 'T'.repeat(43)

function ctxOf(role: 'user' | 'admin', ua: string | null = 'vitest'): ServiceContext {
  return {
    actor: { userId: 'u1', email: 'u1@example.com', displayName: 'U1', role },
    requestMeta: { ip: '203.0.113.9', userAgent: ua, requestId: 'r1' },
    now,
    actionName: 'view.test',
  }
}

async function shapeOf(p: Promise<unknown>): Promise<AppError['shape'] | null> {
  try {
    await p
    return null
  } catch (e) {
    if (e instanceof AppError) return e.shape
    throw e
  }
}

function fileRow(over: Partial<FileRow> = {}): FileRow {
  return {
    id: FILE,
    folderId: FOLDER,
    uploadedBy: 'a1',
    displayName: 'doc',
    originalFilename: 'doc.html',
    storagePath: `${FOLDER}/${FILE}.html`,
    contentType: 'text/html',
    charset: 'utf-8',
    sizeBytes: 100,
    status: 'active',
    suspended: false,
    viewStartsAt: null,
    viewEndsAt: null,
    expiresAt: null,
    downloadAllowed: true,
    uploadExpiresAt: null,
    activatedAt: new Date('2026-10-01T00:00:00Z'),
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    purgedAt: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-02T00:00:00Z'),
    ...over,
  } as FileRow
}

function setup(opts: { file?: Partial<FileRow>; isMember?: boolean; folderDeletedAt?: Date | null; missing?: boolean } = {}) {
  const logs: AccessLogInsert[] = []
  const loadFile = vi.fn(async () =>
    opts.missing
      ? undefined
      : { file: fileRow(opts.file), folderId: FOLDER, folderName: 'F', folderDeletedAt: opts.folderDeletedAt ?? null, isMember: opts.isMember ?? true },
  )
  const deps: ViewDeps = {
    loadFile,
    insertLog: async (r) => void logs.push(r),
    newToken: () => TOKEN,
    config: () => ({ viewTtlSec: 60, downloadTtlSec: 600, contentOrigin: ORIGIN }),
  }
  return { deps, logs, loadFile }
}

const input = { fileId: FILE }

describe('openAsMember (06 8.4)', () => {
  it('AZ-04: a member of a public file gets a ticket; only the hash is stored', async () => {
    const { deps, logs } = setup()
    const r = await viewService.openAsMember(ctxOf('user'), input, deps)
    expect(r).toEqual({ viewUrl: `${ORIGIN}/raw/${TOKEN}`, canDownload: true, mode: 'member' })
    expect(r.viewUrl.slice(`${ORIGIN}/raw/`.length)).toHaveLength(43)
    expect(logs).toHaveLength(1)
    const row = logs[0]!
    expect(row).toMatchObject({ result: 'granted', via: 'member', purpose: 'view', userId: 'u1', fileId: FILE, folderId: FOLDER, shareLinkId: null, ip: '203.0.113.9', userAgent: 'vitest' })
    expect(row.ticketHash).toBe(hashToken(TOKEN))
    expect(row.ticketExpiresAt).toEqual(new Date(now.getTime() + 60_000))
    expect(JSON.stringify(row)).not.toContain(TOKEN)
  })

  it('canDownload is false when downloads are off, and no extra log is written', async () => {
    const { deps, logs } = setup({ file: { downloadAllowed: false } })
    const r = await viewService.openAsMember(ctxOf('user'), input, deps)
    expect(r.canDownload).toBe(false)
    expect(logs).toHaveLength(1)
  })

  it('AZ-03: a non-member gets NOT_FOUND view.not_found and a denied NOT_MEMBER row', async () => {
    const { deps, logs } = setup({ isMember: false })
    const e = await shapeOf(viewService.openAsMember(ctxOf('user'), input, deps))
    expect(e).toMatchObject({ code: 'NOT_FOUND', message: 'このファイルは存在しないか、閲覧できません' })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ result: 'denied', denyReason: 'NOT_MEMBER', userId: 'u1' })
    expect(logs[0]!.ticketHash).toBeUndefined()
    expect(logs[0]!.ticketExpiresAt).toBeUndefined()
  })

  it('a missing file is NOT_FOUND without a log; an invalid id does not query', async () => {
    const m = setup({ missing: true })
    expect((await shapeOf(viewService.openAsMember(ctxOf('user'), input, m.deps)))?.code).toBe('NOT_FOUND')
    expect(m.logs).toHaveLength(0)
    const bad = setup()
    expect((await shapeOf(viewService.openAsMember(ctxOf('user'), { fileId: 'x' }, bad.deps)))?.code).toBe('NOT_FOUND')
    expect(bad.loadFile).not.toHaveBeenCalled()
  })

  it.each([
    ['deleted file', { status: 'deleted' as const }, null, 'NOT_FOUND'],
    ['pending file', { status: 'pending' as const }, null, 'NOT_FOUND'],
  ])('%s is NOT_FOUND and logged as NOT_FOUND', async (_n, file, _f, deny) => {
    const { deps, logs } = setup({ file })
    expect((await shapeOf(viewService.openAsMember(ctxOf('user'), input, deps)))?.code).toBe('NOT_FOUND')
    expect(logs[0]).toMatchObject({ result: 'denied', denyReason: deny })
  })

  it('a deleted folder is NOT_FOUND', async () => {
    const { deps, logs } = setup({ folderDeletedAt: new Date('2026-10-07T00:00:00Z') })
    expect((await shapeOf(viewService.openAsMember(ctxOf('user'), input, deps)))?.code).toBe('NOT_FOUND')
    expect(logs[0]).toMatchObject({ denyReason: 'NOT_FOUND' })
  })

  it.each([
    ['SUSPENDED', { suspended: true }],
    ['FILE_EXPIRED', { expiresAt: new Date('2026-10-08T02:00:00Z') }],
    ['ENDED', { viewEndsAt: new Date('2026-10-08T02:00:00Z') }],
  ] as const)('%s is ACCESS_DENIED with reason and a denied row', async (reason, file) => {
    const { deps, logs } = setup({ file })
    const e = await shapeOf(viewService.openAsMember(ctxOf('user'), input, deps))
    expect(e).toMatchObject({ code: 'ACCESS_DENIED', reason })
    expect(e?.startsAt).toBeUndefined()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ result: 'denied', denyReason: reason, via: 'member', purpose: 'view' })
  })

  it('NOT_STARTED carries startsAt', async () => {
    const startsAt = new Date('2026-10-09T00:00:00Z')
    const { deps } = setup({ file: { viewStartsAt: startsAt } })
    const e = await shapeOf(viewService.openAsMember(ctxOf('user'), input, deps))
    expect(e).toMatchObject({ code: 'ACCESS_DENIED', reason: 'NOT_STARTED', startsAt: startsAt.toISOString() })
  })

  it('an admin previews as admin_preview and ignores restrictions (even for a non-member)', async () => {
    const { deps, logs } = setup({ file: { suspended: true, downloadAllowed: false }, isMember: false })
    const r = await viewService.openAsMember(ctxOf('admin'), input, deps)
    expect(r.mode).toBe('admin_preview')
    expect(r.canDownload).toBe(true)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ via: 'admin_preview', result: 'granted' })
  })

  it('truncates a long user agent to 256 chars', async () => {
    const { deps, logs } = setup()
    await viewService.openAsMember(ctxOf('user', 'x'.repeat(400)), input, deps)
    expect(logs[0]!.userAgent).toHaveLength(256)
  })
})

describe('requestMemberDownload (06 8.5)', () => {
  it('issues a download ticket with the download TTL', async () => {
    const { deps, logs } = setup()
    const r = await viewService.requestMemberDownload(ctxOf('user'), input, deps)
    expect(r).toEqual({ downloadUrl: `${ORIGIN}/raw/${TOKEN}`, expiresAt: new Date(now.getTime() + 600_000).toISOString() })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ purpose: 'download', result: 'granted', ticketHash: hashToken(TOKEN) })
  })

  it('downloads off: ACCESS_DENIED DOWNLOAD_NOT_ALLOWED, a denied row, and no ticket', async () => {
    const { deps, logs } = setup({ file: { downloadAllowed: false } })
    const e = await shapeOf(viewService.requestMemberDownload(ctxOf('user'), input, deps))
    expect(e).toMatchObject({ code: 'ACCESS_DENIED', reason: 'DOWNLOAD_NOT_ALLOWED' })
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ purpose: 'download', result: 'denied', denyReason: 'DOWNLOAD_NOT_ALLOWED' })
    expect(logs[0]!.ticketHash).toBeUndefined()
  })

  it('a non-member is NOT_FOUND with a denied row', async () => {
    const { deps, logs } = setup({ isMember: false })
    expect((await shapeOf(viewService.requestMemberDownload(ctxOf('user'), input, deps)))?.code).toBe('NOT_FOUND')
    expect(logs[0]).toMatchObject({ purpose: 'download', denyReason: 'NOT_MEMBER' })
  })

  it('an admin may download even when downloads are off', async () => {
    const { deps } = setup({ file: { downloadAllowed: false } })
    const r = await viewService.requestMemberDownload(ctxOf('admin'), input, deps)
    expect(r.downloadUrl).toBe(`${ORIGIN}/raw/${TOKEN}`)
  })
})

describe('getMemberViewContext (06 9.11)', () => {
  function ctxDeps(file: Partial<FileRow> = {}, calls: { n: number } = { n: 0 }): ViewContextDeps {
    return {
      load: async () => {
        calls.n++
        return { file: fileRow(file), folderName: 'F' }
      },
    }
  }

  it('returns the member context with no notice and writes no log', async () => {
    const r = await viewService.getMemberViewContext(ctxOf('user'), FILE, ctxDeps())
    expect(r).toEqual({ file: { id: FILE, displayName: 'doc', folderId: FOLDER, folderName: 'F' }, mode: 'member', previewNotice: null })
  })

  it('does not hide a non-public file from a member (D-018 (j))', async () => {
    const r = await viewService.getMemberViewContext(ctxOf('user'), FILE, ctxDeps({ suspended: true }))
    expect(r.mode).toBe('member')
    expect(r.previewNotice).toBeNull()
  })

  it('an admin gets previewNotice for a non-public file and null for a public one', async () => {
    expect((await viewService.getMemberViewContext(ctxOf('admin'), FILE, ctxDeps({ suspended: true }))).previewNotice).toBe('suspended')
    expect((await viewService.getMemberViewContext(ctxOf('admin'), FILE, ctxDeps({ expiresAt: new Date('2026-10-08T02:00:00Z') }))).previewNotice).toBe('expired')
    const pub = await viewService.getMemberViewContext(ctxOf('admin'), FILE, ctxDeps())
    expect(pub).toMatchObject({ mode: 'admin_preview', previewNotice: null })
  })

  it('a non-active file and an invalid id are NOT_FOUND', async () => {
    expect((await shapeOf(viewService.getMemberViewContext(ctxOf('user'), FILE, ctxDeps({ status: 'pending' }))))?.code).toBe('NOT_FOUND')
    const calls = { n: 0 }
    expect((await shapeOf(viewService.getMemberViewContext(ctxOf('user'), 'x', ctxDeps({}, calls))))?.code).toBe('NOT_FOUND')
    expect(calls.n).toBe(0)
  })
})
