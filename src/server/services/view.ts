// Member viewing (06 8.4 openAsMember, 8.5 requestMemberDownload, 9.11 getMemberViewContext). The data access is injectable
// (ViewDeps) so unit tests run the procedures without a database. The raw ticket is only returned inside the URL; it is never
// logged, put into an error or stored (only its SHA-256 goes to access_logs.ticket_hash).
import 'server-only'
import { fileDisplayState } from '@/lib/display-state'
import { PUBLIC_DENY_REASONS, type AccessPurpose, type AccessVia, type DenyReason, type PublicDenyReason } from '@/lib/domain'
import type { MemberViewContext, OpenAsMemberResult } from '@/lib/dto'
import { AppError, appError } from '@/lib/errors'
import { accessDenied } from '@/lib/messages'
import { zUuid } from '@/lib/schemas/common'
import type { ViewOpenAsMemberInput, ViewRequestMemberDownloadInput } from '@/lib/schemas/view'
import type { ServiceContext } from '@/server/actions/define-action'
import { evaluateAccess, type AccessDecision } from '@/server/authz/access-policy'
import { assertFileRole } from '@/server/authz/folder'
import { getConfig } from '@/server/config'
import { getDb } from '@/server/db/client'
import { insertAccessLog, type AccessLogInsert } from '@/server/repositories/access-logs'
import { findFileForTicket } from '@/server/repositories/view'
import { generateToken, hashToken } from '@/server/security/tokens'

type TicketRow = NonNullable<Awaited<ReturnType<typeof findFileForTicket>>>

export interface ViewDeps {
  /** 06 8.4 step 1: one statement; undefined when the file does not exist. */
  loadFile: (fileId: string, actorId: string) => Promise<TicketRow | undefined>
  insertLog: (row: AccessLogInsert) => Promise<void>
  newToken: () => string
  config: () => { viewTtlSec: number; downloadTtlSec: number; contentOrigin: string }
}

export const defaultViewDeps: ViewDeps = {
  loadFile: (fileId, actorId) => findFileForTicket(getDb(), fileId, actorId),
  insertLog: (row) => insertAccessLog(getDb(), row),
  newToken: generateToken,
  config: () => {
    const c = getConfig()
    return { viewTtlSec: c.VIEW_TICKET_TTL_SEC, downloadTtlSec: c.DOWNLOAD_TICKET_TTL_SEC, contentOrigin: c.CONTENT_ORIGIN }
  },
}

function actorOf(ctx: ServiceContext) {
  if (!ctx.actor) throw appError('UNAUTHENTICATED', 'common.unauthenticated') // callers are authenticated actions
  return ctx.actor
}

const isPublicReason = (r: DenyReason): r is PublicDenyReason => (PUBLIC_DENY_REASONS as readonly string[]).includes(r)

/** 07 1.4: NOT_FOUND-class reasons become view.not_found; the others ACCESS_DENIED (NOT_STARTED carries startsAt). */
function denialError(reason: DenyReason, via: AccessVia, startsAt: Date | null): AppError {
  const startsAtIso = startsAt ? startsAt.toISOString() : undefined
  const m = accessDenied(reason, via, startsAtIso)
  if (m.code === 'NOT_FOUND' || !isPublicReason(reason)) return appError('NOT_FOUND', 'view.not_found')
  return new AppError({
    code: 'ACCESS_DENIED',
    message: m.message,
    reason,
    ...(reason === 'NOT_STARTED' && startsAtIso ? { startsAt: startsAtIso } : {}),
  })
}

interface Issued {
  token: string
  expiresAt: Date
  via: AccessVia
  /** only computed for purpose 'view' */
  canDownload: boolean
}

async function issue(ctx: ServiceContext, fileId: string, purpose: AccessPurpose, deps: ViewDeps): Promise<Issued> {
  const actor = actorOf(ctx)
  if (!zUuid.safeParse(fileId).success) throw appError('NOT_FOUND', 'view.not_found')
  const row = await deps.loadFile(fileId, actor.userId)
  if (!row) throw appError('NOT_FOUND', 'view.not_found') // no log: there is no file to attach it to
  const via: AccessVia = actor.role === 'admin' ? 'admin_preview' : 'member'
  const base = {
    now: ctx.now,
    stage: 'issue' as const,
    via,
    folder: { deletedAt: row.folderDeletedAt },
    file: row.file,
    viewer: { disabledAt: null, role: actor.role, isMember: row.isMember },
  }
  const decision: AccessDecision = evaluateAccess({ ...base, purpose })
  const common = {
    fileId: row.file.id,
    folderId: row.folderId,
    via,
    purpose,
    userId: actor.userId,
    shareLinkId: null,
    ip: ctx.requestMeta.ip,
    userAgent: ctx.requestMeta.userAgent === null ? null : ctx.requestMeta.userAgent.slice(0, 256),
  }
  if (!decision.allow) {
    await deps.insertLog({ ...common, result: 'denied', denyReason: decision.reason })
    throw denialError(decision.reason, via, row.file.viewStartsAt)
  }
  const cfg = deps.config()
  const token = deps.newToken()
  const expiresAt = new Date(ctx.now.getTime() + (purpose === 'view' ? cfg.viewTtlSec : cfg.downloadTtlSec) * 1000)
  await deps.insertLog({ ...common, result: 'granted', ticketHash: hashToken(token), ticketExpiresAt: expiresAt })
  const canDownload = purpose === 'view' && evaluateAccess({ ...base, purpose: 'download' }).allow // evaluation only, no log
  return { token, expiresAt, via, canDownload }
}

/** 06 8.4. */
async function openAsMember(ctx: ServiceContext, input: ViewOpenAsMemberInput, deps: ViewDeps = defaultViewDeps): Promise<OpenAsMemberResult> {
  const r = await issue(ctx, input.fileId, 'view', deps)
  return { viewUrl: `${deps.config().contentOrigin}/raw/${r.token}`, canDownload: r.canDownload, mode: r.via === 'admin_preview' ? 'admin_preview' : 'member' }
}

/** 06 8.5. */
async function requestMemberDownload(
  ctx: ServiceContext,
  input: ViewRequestMemberDownloadInput,
  deps: ViewDeps = defaultViewDeps,
): Promise<{ downloadUrl: string; expiresAt: string }> {
  const r = await issue(ctx, input.fileId, 'download', deps)
  return { downloadUrl: `${deps.config().contentOrigin}/raw/${r.token}`, expiresAt: r.expiresAt.toISOString() }
}

export interface ViewContextDeps {
  /** assertFileRole(view): a deleted file or a non-member is NOT_FOUND. */
  load: (ctx: ServiceContext, fileId: string) => Promise<{ file: Awaited<ReturnType<typeof assertFileRole>>['file']; folderName: string }>
}

export const defaultViewContextDeps: ViewContextDeps = {
  load: (ctx, fileId) =>
    getDb().transaction(async (tx) => {
      const r = await assertFileRole(ctx, tx, fileId, 'view')
      return { file: r.file, folderName: r.folder.name }
    }),
}

/** 06 9.11. No restriction evaluation, no ticket, no access log. A non-public file is not NOT_FOUND for a member (D-018 (j)). */
async function getMemberViewContext(ctx: ServiceContext, fileId: string, deps: ViewContextDeps = defaultViewContextDeps): Promise<MemberViewContext> {
  if (!zUuid.safeParse(fileId).success) throw appError('NOT_FOUND', 'common.not_found')
  const r = await deps.load(ctx, fileId)
  if (r.file.status !== 'active') throw appError('NOT_FOUND', 'common.not_found')
  const mode = actorOf(ctx).role === 'admin' ? 'admin_preview' : 'member'
  const state = fileDisplayState(r.file, ctx.now)
  return {
    file: { id: r.file.id, displayName: r.file.displayName, folderId: r.file.folderId, folderName: r.folderName },
    mode,
    previewNotice: mode === 'admin_preview' && state !== 'public' ? state : null,
  }
}

export const viewService = { openAsMember, requestMemberDownload, getMemberViewContext }
