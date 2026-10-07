// GET /raw/[ticket] delivery (06 10.1 steps 4-10, 07 8.1). The data access, the storage adapter and the clock are injectable
// (DeliveryDeps) so unit tests run the procedure without a database. The raw ticket is only hashed; it is never logged, put into an
// error or stored. The body is passed through as a stream and never read into memory.
import 'server-only'
import type { AccessInput } from '@/server/authz/access-policy'
import { evaluateAccess } from '@/server/authz/access-policy'
import { zToken } from '@/lib/schemas/common'
import type { ServiceContext } from '@/server/actions/define-action'
import { getConfig } from '@/server/config'
import { getDb } from '@/server/db/client'
import { consumeTicket, loadDeliveryContext, markNotDelivered, type ConsumedTicket, type DeliveryContextRow } from '@/server/repositories/delivery'
import { downloadResponseHeaders, rawErrorHeaders, viewResponseHeaders } from '@/server/security/headers'
import { hashToken } from '@/server/security/tokens'
import { getObjects } from '@/server/storage/objects'
import type { ObjectsAdapter } from '@/server/storage/objects'

export interface DeliveryDeps {
  /** 07 8.1: one UPDATE ... RETURNING. */
  consume: (ticketHash: string) => Promise<ConsumedTicket | undefined>
  /** D-018 (h). */
  markNotDelivered: (accessLogId: number) => Promise<void>
  /** 06 10.1 step 7: one statement. */
  loadContext: (t: ConsumedTicket) => Promise<DeliveryContextRow | undefined>
  objects: Pick<ObjectsAdapter, 'openStream'>
  config: () => { appOrigin: string }
  /** Structured log line. Callers never pass the ticket, signed URLs or file names. */
  log: (event: string, fields: Record<string, unknown>) => void
}

export const defaultDeliveryDeps: DeliveryDeps = {
  consume: (hash) => consumeTicket(getDb(), hash),
  markNotDelivered: (id) => markNotDelivered(getDb(), id),
  loadContext: (t) => loadDeliveryContext(getDb(), { fileId: t.fileId, userId: t.userId, shareLinkId: t.shareLinkId }),
  objects: { openStream: (path) => getObjects().openStream(path) },
  config: () => ({ appOrigin: getConfig().APP_ORIGIN }),
  log: (event, fields) => console.warn(JSON.stringify({ ts: new Date().toISOString(), event, ...fields })),
}

const STATUS_TEXT = { 403: 'Forbidden', 404: 'Not Found', 502: 'Bad Gateway' } as const

/** 404 / 403 / 502: fixed English body that does not hint at the file's existence. */
export function rawError(status: keyof typeof STATUS_TEXT): Response {
  return new Response(STATUS_TEXT[status], { status, headers: rawErrorHeaders() })
}

/** The Sec-Fetch-Dest rule of step 6: a view ticket may only be used by an iframe. A missing header passes (old browsers). */
export function viewDestRejected(purpose: ConsumedTicket['purpose'], secFetchDest: string | null): boolean {
  if (purpose !== 'view' || secFetchDest === null) return false
  return secFetchDest.trim().toLowerCase() !== 'iframe'
}

/** Step 7 input. The viewer is built from the ticket's user (member / admin_preview); the link only for share_link. */
export function toAccessInput(t: ConsumedTicket, row: DeliveryContextRow, now: Date): AccessInput {
  const f = row.file
  return {
    now,
    stage: 'deliver',
    via: t.via,
    purpose: t.purpose,
    folder: { deletedAt: row.folderDeletedAt },
    file: {
      status: f.status,
      suspended: f.suspended,
      viewStartsAt: f.viewStartsAt,
      viewEndsAt: f.viewEndsAt,
      expiresAt: f.expiresAt,
      downloadAllowed: f.downloadAllowed,
    },
    viewer:
      t.via === 'share_link' || row.viewerId === null || row.viewerRole === null
        ? null
        : { disabledAt: row.viewerDisabledAt, role: row.viewerRole, isMember: row.isMember },
    link:
      t.via !== 'share_link' || row.link === null
        ? null
        : {
            revokedAt: row.link.revokedAt,
            expiresAt: row.link.expiresAt,
            maxViews: row.link.maxViews,
            viewCount: row.link.viewCount,
            hasPassword: row.link.passwordHash !== null,
            downloadAllowed: row.link.downloadAllowed,
          },
  }
}

/** 06 10.1 steps 4-10. Returns the Response for /raw/[ticket]. */
export async function serveTicket(
  ctx: ServiceContext,
  ticket: string,
  secFetchDest: string | null,
  deps: DeliveryDeps = defaultDeliveryDeps,
): Promise<Response> {
  // 4. format check: no database access for a malformed ticket
  if (!zToken.safeParse(ticket).success) return rawError(404)

  // 5. consume (one statement)
  const t = await deps.consume(hashToken(ticket))
  if (!t) return rawError(404)

  // From here the ticket is used. Any way out other than a delivered stream leaves bytes_sent = 0 (D-018 (h)).
  const fail = async (status: 403 | 404 | 502): Promise<Response> => {
    await deps.markNotDelivered(t.id)
    return rawError(status)
  }
  try {
    // 6. a view ticket is only for an iframe
    if (viewDestRejected(t.purpose, secFetchDest)) return await fail(403)

    // 7. re-evaluate at delivery time (membership removal, suspension, expiry after issue)
    const row = await deps.loadContext(t)
    const decision = row ? evaluateAccess(toAccessInput(t, row, ctx.now)) : ({ allow: false, reason: 'NOT_FOUND' } as const)
    if (!row || !decision.allow) {
      deps.log('delivery.denied_after_issue', { accessLogId: t.id, reason: decision.allow ? 'NOT_FOUND' : decision.reason, requestId: ctx.requestMeta.requestId })
      return await fail(404)
    }

    // 8. open the object
    let upstream: Awaited<ReturnType<DeliveryDeps['objects']['openStream']>>
    try {
      upstream = await deps.objects.openStream(row.file.storagePath)
    } catch {
      deps.log('delivery.upstream_error', { accessLogId: t.id, status: null, requestId: ctx.requestMeta.requestId })
      return await fail(502)
    }
    if (upstream.status !== 200) {
      await upstream.body.cancel().catch(() => undefined)
      deps.log('delivery.upstream_error', { accessLogId: t.id, status: upstream.status, requestId: ctx.requestMeta.requestId })
      return await fail(502)
    }

    // 9. headers (B-2 view / B-3 download). Content-Length is copied from upstream when known.
    const headers = new Headers(
      t.purpose === 'view' ? viewResponseHeaders({ APP_ORIGIN: deps.config().appOrigin }, row.file.charset) : downloadResponseHeaders(row.file.originalFilename),
    )
    if (upstream.contentLength !== null) headers.set('Content-Length', String(upstream.contentLength))

    // 10. stream through; the body is not read here
    return new Response(upstream.body, { status: 200, headers })
  } catch (e) {
    await deps.markNotDelivered(t.id).catch(() => undefined) // best effort; the original error goes to defineRoute (500)
    throw e
  }
}

export const deliveryService = { serveTicket }
