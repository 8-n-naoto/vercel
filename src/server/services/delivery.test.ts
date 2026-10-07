import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceContext } from '@/server/actions/define-action'
import type { ConsumedTicket, DeliveryContextRow } from '@/server/repositories/delivery'
import { hashToken } from '@/server/security/tokens'
import { createFakeObjects } from '@/tests/fakes/objects'
import { serveTicket, toAccessInput, viewDestRejected, type DeliveryDeps } from './delivery'

vi.mock('@/server/db/client', () => ({ getDb: vi.fn() }))

const TICKET = 'T'.repeat(43)
const FILE = '00000000-0000-4000-8000-000000000020'
const FOLDER = '00000000-0000-4000-8000-000000000010'
const now = new Date('2026-10-08T03:00:00.000Z')
const APP = 'https://app.example.com'
const CTX: ServiceContext = { actor: null, requestMeta: { ip: '203.0.113.9', userAgent: 'vitest', requestId: 'r1' }, now, actionName: 'raw.get' }
const HTML = new TextEncoder().encode('<p>hello</p>')

const ticket = (over: Partial<ConsumedTicket> = {}): ConsumedTicket => ({
  id: 77,
  fileId: FILE,
  folderId: FOLDER,
  via: 'member',
  purpose: 'view',
  shareLinkId: null,
  userId: 'u1',
  ...over,
})

function ctxRow(over: { file?: Partial<DeliveryContextRow['file']> } & Partial<Omit<DeliveryContextRow, 'file'>> = {}): DeliveryContextRow {
  const { file, ...rest } = over
  return {
    file: {
      id: FILE,
      folderId: FOLDER,
      uploadedBy: 'a1',
      displayName: 'Doc',
      originalFilename: 'レポート.html',
      storagePath: `${FOLDER}/${FILE}.html`,
      contentType: 'text/html',
      charset: 'shift_jis',
      sizeBytes: HTML.length,
      status: 'active',
      suspended: false,
      viewStartsAt: null,
      viewEndsAt: null,
      expiresAt: null,
      downloadAllowed: true,
      uploadExpiresAt: null,
      activatedAt: now,
      deletedAt: null,
      deletedBy: null,
      deleteReason: null,
      purgedAt: null,
      createdAt: now,
      updatedAt: now,
      ...file,
    },
    folderDeletedAt: null,
    link: null,
    viewerId: 'u1',
    viewerRole: 'user',
    viewerDisabledAt: null,
    isMember: true,
    ...rest,
  }
}

function setup(over: { ticket?: ConsumedTicket | null; row?: DeliveryContextRow | undefined; objects?: DeliveryDeps['objects'] } = {}) {
  const fake = createFakeObjects()
  fake.put(`${FOLDER}/${FILE}.html`, HTML, 'text/html')
  const deps = {
    consume: vi.fn<DeliveryDeps['consume']>(async () => (over.ticket === null ? undefined : (over.ticket ?? ticket()))),
    markNotDelivered: vi.fn<DeliveryDeps['markNotDelivered']>(async () => {}),
    loadContext: vi.fn<DeliveryDeps['loadContext']>(async () => ('row' in over ? over.row : ctxRow())),
    objects: over.objects ?? fake,
    config: () => ({ appOrigin: APP }),
    log: vi.fn<DeliveryDeps['log']>(),
  } satisfies DeliveryDeps
  return { deps, fake }
}

describe('serveTicket (06 10.1 steps 4-10)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('step 4: a malformed ticket is 404 and nothing touches the database', async () => {
    for (const bad of ['', 'short', 'T'.repeat(42), 'T'.repeat(44), `${'T'.repeat(42)}=`, `${'T'.repeat(42)}.`]) {
      const { deps } = setup()
      const r = await serveTicket(CTX, bad, null, deps)
      expect(r.status).toBe(404)
      expect(await r.text()).toBe('Not Found')
      expect(deps.consume).not.toHaveBeenCalled()
    }
  })

  it('step 5: consumes with SHA-256 of the ticket; 0 rows -> 404 with no further access', async () => {
    const { deps } = setup({ ticket: null })
    const r = await serveTicket(CTX, TICKET, 'iframe', deps)
    expect(r.status).toBe(404)
    expect(deps.consume).toHaveBeenCalledWith(hashToken(TICKET))
    expect(deps.loadContext).not.toHaveBeenCalled()
    expect(deps.markNotDelivered).not.toHaveBeenCalled() // nothing was consumed
  })

  it('error responses: fixed English body, text/plain, no-store, nothing about the file', async () => {
    const { deps } = setup({ ticket: null })
    const r = await serveTicket(CTX, TICKET, null, deps)
    expect(r.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('x-robots-tag')).toContain('noindex')
    expect(r.headers.get('set-cookie')).toBeNull()
    expect(await r.text()).toBe('Not Found')
  })

  it('step 6: view + Sec-Fetch-Dest other than iframe -> 403 and bytes_sent = 0 (TC-08)', async () => {
    for (const dest of ['document', 'empty', 'script', 'frame', 'object']) {
      const { deps } = setup()
      const r = await serveTicket(CTX, TICKET, dest, deps)
      expect(r.status).toBe(403)
      expect(await r.text()).toBe('Forbidden')
      expect(deps.markNotDelivered).toHaveBeenCalledWith(77)
      expect(deps.loadContext).not.toHaveBeenCalled()
    }
  })

  it('step 6: view with Sec-Fetch-Dest iframe, or without the header, is delivered', async () => {
    for (const dest of ['iframe', 'IFRAME', null]) {
      const { deps } = setup()
      const r = await serveTicket(CTX, TICKET, dest, deps)
      expect(r.status).toBe(200)
      expect(deps.markNotDelivered).not.toHaveBeenCalled()
    }
  })

  it('step 6: download is not subject to the iframe check (TC-09)', async () => {
    const { deps } = setup({ ticket: ticket({ purpose: 'download' }) })
    const r = await serveTicket(CTX, TICKET, 'document', deps)
    expect(r.status).toBe(200)
    expect(deps.markNotDelivered).not.toHaveBeenCalled()
  })

  it('step 7: re-evaluation denial (removed from the folder) -> 404, bytes_sent = 0, structured log without the ticket (TC-07)', async () => {
    const { deps } = setup({ row: ctxRow({ isMember: false }) })
    const r = await serveTicket(CTX, TICKET, 'iframe', deps)
    expect(r.status).toBe(404)
    expect(await r.text()).toBe('Not Found')
    expect(deps.markNotDelivered).toHaveBeenCalledWith(77)
    expect(deps.log).toHaveBeenCalledWith('delivery.denied_after_issue', { accessLogId: 77, reason: 'NOT_MEMBER', requestId: 'r1' })
    expect(JSON.stringify(vi.mocked(deps.log).mock.calls)).not.toContain(TICKET)
  })

  it('step 7: other denials (suspended, expired, deleted file or folder, disabled user, file row gone)', async () => {
    const cases: [DeliveryContextRow | undefined, string][] = [
      [ctxRow({ file: { suspended: true } }), 'SUSPENDED'],
      [ctxRow({ file: { expiresAt: new Date(now.getTime() - 1) } }), 'FILE_EXPIRED'],
      [ctxRow({ file: { status: 'deleted' } }), 'NOT_FOUND'],
      [ctxRow({ folderDeletedAt: now }), 'NOT_FOUND'],
      [ctxRow({ viewerDisabledAt: now }), 'USER_DISABLED'],
      [undefined, 'NOT_FOUND'],
    ]
    for (const [row, reason] of cases) {
      const { deps } = setup({ row })
      const r = await serveTicket(CTX, TICKET, 'iframe', deps)
      expect(r.status).toBe(404)
      expect(deps.markNotDelivered).toHaveBeenCalledWith(77)
      expect(deps.log).toHaveBeenCalledWith('delivery.denied_after_issue', expect.objectContaining({ accessLogId: 77, reason }))
    }
  })

  it('step 7: download re-evaluated: download switched off after issue -> 404 DOWNLOAD_NOT_ALLOWED', async () => {
    const { deps } = setup({ ticket: ticket({ purpose: 'download' }), row: ctxRow({ file: { downloadAllowed: false } }) })
    const r = await serveTicket(CTX, TICKET, null, deps)
    expect(r.status).toBe(404)
    expect(deps.log).toHaveBeenCalledWith('delivery.denied_after_issue', expect.objectContaining({ reason: 'DOWNLOAD_NOT_ALLOWED' }))
  })

  it('step 7: admin_preview skips the file restrictions of a suspended file', async () => {
    const { deps } = setup({ ticket: ticket({ via: 'admin_preview' }), row: ctxRow({ viewerRole: 'admin', isMember: false, file: { suspended: true } }) })
    expect((await serveTicket(CTX, TICKET, 'iframe', deps)).status).toBe(200)
  })

  it('step 7: share_link ticket uses the link (live -> 200; revoked or missing link -> 404)', async () => {
    const t = ticket({ via: 'share_link', userId: null, shareLinkId: '00000000-0000-4000-8000-0000000000aa' })
    const link = { id: t.shareLinkId ?? '', revokedAt: null, expiresAt: new Date(now.getTime() + 60_000), maxViews: null, viewCount: 0, passwordHash: 'h', downloadAllowed: false }
    const noViewer = { viewerId: null, viewerRole: null, isMember: false }
    const live = setup({ ticket: t, row: ctxRow({ link, ...noViewer }) })
    expect((await serveTicket(CTX, TICKET, 'iframe', live.deps)).status).toBe(200) // the password was checked at issue; deliver does not ask again
    const revoked = setup({ ticket: t, row: ctxRow({ link: { ...link, revokedAt: now }, ...noViewer }) })
    expect((await serveTicket(CTX, TICKET, 'iframe', revoked.deps)).status).toBe(404)
    expect(revoked.deps.log).toHaveBeenCalledWith('delivery.denied_after_issue', expect.objectContaining({ reason: 'LINK_REVOKED' }))
    const missing = setup({ ticket: t, row: ctxRow({ link: null, ...noViewer }) })
    expect((await serveTicket(CTX, TICKET, 'iframe', missing.deps)).status).toBe(404)
  })

  it('step 8: upstream status other than 200 -> 502, bytes_sent = 0, delivery.upstream_error with the status (TC-10)', async () => {
    const objects: DeliveryDeps['objects'] = { openStream: async () => ({ status: 500, body: new ReadableStream<Uint8Array>(), contentLength: null }) }
    const { deps } = setup({ objects })
    const r = await serveTicket(CTX, TICKET, 'iframe', deps)
    expect(r.status).toBe(502)
    expect(await r.text()).toBe('Bad Gateway')
    expect(deps.markNotDelivered).toHaveBeenCalledWith(77)
    expect(deps.log).toHaveBeenCalledWith('delivery.upstream_error', { accessLogId: 77, status: 500, requestId: 'r1' })
  })

  it('step 8: the adapter throwing (network error) is also 502 with bytes_sent = 0', async () => {
    const { deps, fake } = setup()
    fake.failNext('openStream')
    const r = await serveTicket(CTX, TICKET, 'iframe', deps)
    expect(r.status).toBe(502)
    expect(deps.markNotDelivered).toHaveBeenCalledWith(77)
    expect(deps.log).toHaveBeenCalledWith('delivery.upstream_error', { accessLogId: 77, status: null, requestId: 'r1' })
  })

  it('steps 9-10 (view): 200 with every B-2 header, files.charset, Content-Length from upstream, no Set-Cookie, body streamed', async () => {
    const { deps } = setup()
    const r = await serveTicket(CTX, TICKET, 'iframe', deps)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('text/html; charset=shift_jis')
    expect(r.headers.get('content-security-policy')).toContain('sandbox allow-scripts;')
    expect(r.headers.get('content-security-policy')).toContain(`frame-ancestors ${APP}`)
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
    expect(r.headers.get('referrer-policy')).toBe('no-referrer')
    expect(r.headers.get('cache-control')).toBe('private, no-store, max-age=0')
    expect(r.headers.get('permissions-policy')).toContain('camera=()')
    expect(r.headers.get('strict-transport-security')).toBe('max-age=63072000; includeSubDomains')
    expect(r.headers.get('x-robots-tag')).toBe('noindex, nofollow, noarchive')
    expect(r.headers.get('content-length')).toBe(String(HTML.length))
    expect(r.headers.get('content-disposition')).toBeNull()
    expect(r.headers.get('set-cookie')).toBeNull()
    expect(await r.text()).toBe('<p>hello</p>')
  })

  it('steps 9-10 (download): B-3 headers with the Content-Disposition of the original file name', async () => {
    const { deps } = setup({ ticket: ticket({ purpose: 'download' }) })
    const r = await serveTicket(CTX, TICKET, 'document', deps)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/octet-stream')
    expect(r.headers.get('content-disposition')).toBe(`attachment; filename="____.html"; filename*=UTF-8''%E3%83%AC%E3%83%9D%E3%83%BC%E3%83%88.html`)
    expect(r.headers.get('content-security-policy')).toBe(`sandbox; default-src 'none'`)
    expect(r.headers.get('cache-control')).toBe('private, no-store, max-age=0')
    expect(r.headers.get('set-cookie')).toBeNull()
  })

  it('Content-Length is not set when upstream does not know it', async () => {
    const objects: DeliveryDeps['objects'] = { openStream: async () => ({ status: 200, body: new ReadableStream<Uint8Array>(), contentLength: null }) }
    const { deps } = setup({ objects })
    const r = await serveTicket(CTX, TICKET, 'iframe', deps)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-length')).toBeNull()
  })

  it('the service does not read the upstream stream into memory (no reader taken, stream unlocked)', async () => {
    const body = new ReadableStream<Uint8Array>()
    const getReader = vi.spyOn(body, 'getReader')
    const objects: DeliveryDeps['objects'] = { openStream: async () => ({ status: 200, body, contentLength: 3 }) }
    const { deps } = setup({ objects })
    const r = await serveTicket(CTX, TICKET, 'iframe', deps)
    expect(r.status).toBe(200)
    expect(getReader).not.toHaveBeenCalled()
    expect(body.locked).toBe(false)
  })

  it('an unexpected error after consumption resets bytes_sent (best effort) and is rethrown for defineRoute (500)', async () => {
    const { deps } = setup()
    deps.loadContext.mockRejectedValueOnce(new Error('db down'))
    await expect(serveTicket(CTX, TICKET, 'iframe', deps)).rejects.toThrow('db down')
    expect(deps.markNotDelivered).toHaveBeenCalledWith(77)
  })
})

describe('viewDestRejected / toAccessInput', () => {
  it('only view tickets with a present, non-iframe header are rejected', () => {
    expect(viewDestRejected('view', 'document')).toBe(true)
    expect(viewDestRejected('view', 'iframe')).toBe(false)
    expect(viewDestRejected('view', ' Iframe ')).toBe(false)
    expect(viewDestRejected('view', null)).toBe(false)
    expect(viewDestRejected('download', 'document')).toBe(false)
  })
  it('builds a deliver-stage input from the ticket and the joined row', () => {
    const i = toAccessInput(ticket({ purpose: 'download' }), ctxRow(), now)
    expect(i).toMatchObject({ stage: 'deliver', via: 'member', purpose: 'download', viewer: { role: 'user', isMember: true }, link: null })
  })
})
