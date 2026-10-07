// Upload procedures (06 7.1 / 7.2 / 7.3). The data access is injectable (UploadDeps) so unit tests run the procedures
// without a database; the Storage adapter is a fake in tests. Signed URLs and keys are never logged or put into errors.
import 'server-only'
import type { FileCharset } from '@/lib/domain'
import type { FileDetail } from '@/lib/dto'
import { appError } from '@/lib/errors'
import { message } from '@/lib/messages'
import type { ServiceContext } from '@/server/actions/define-action'
import { assertFileRole, assertFolderRole, type FolderLock } from '@/server/authz/folder'
import { getConfig } from '@/server/config'
import { getDb } from '@/server/db/client'
import {
  activateFile,
  insertPendingFile,
  markFileDeleted,
  markFilesPurged,
  sumQuotaUsage,
  type FileRow,
} from '@/server/repositories/files'
import { lockProfileForUpdate } from '@/server/repositories/profiles'
import { getObjects, type ObjectsAdapter } from '@/server/storage/objects'
import { record } from './audit'
import { toFileDetail } from './files'
import { decideQuota } from './quota'
import { verifyUpload, type VerifyFailReason } from './upload-verify'

const MB = 1_048_576
const UPLOAD_TTL_MS = 2 * 60 * 60 * 1000 // 06 7.1: ctx.now + 2 hours
const HEAD_BYTES = 4096 // 06 7.2 step 3

function actorOf(ctx: ServiceContext) {
  if (!ctx.actor) throw appError('UNAUTHENTICATED', 'common.unauthenticated') // callers are authenticated actions
  return ctx.actor
}

export interface UploadLimits {
  maxFileBytes: number
  userLimitBytes: number
  totalLimitBytes: number
  /** Publishable key sent as `apikey` with the PUT (D1). null = not sent. */
  apiKey: string | null
}

export interface UploadFile {
  file: FileRow
  folderName: string
}

export interface UploadTx {
  /** assertFolderRole(manage) with the given lock. */
  assertFolderManage: (folderId: string, lock: FolderLock) => Promise<{ id: string; name: string }>
  /** assertFileRole(manage); a deleted file or a non-member is NOT_FOUND. */
  assertFile: (fileId: string, opts: { lock?: FolderLock; lockFile?: boolean }) => Promise<UploadFile>
  /** The actor's profiles row, FOR UPDATE (serializes concurrent uploads of one admin). */
  lockOwnProfile: () => Promise<void>
  usage: () => Promise<{ userUsed: number; totalUsed: number }>
  insertPending: (v: {
    id: string
    folderId: string
    displayName: string
    originalFilename: string
    storagePath: string
    sizeBytes: number
    uploadExpiresAt: Date
  }) => Promise<void>
  markDeleted: (fileId: string, reason: 'verification_failed' | 'upload_abandoned', purged: boolean) => Promise<void>
  activate: (fileId: string, v: { sizeBytes: number; charset: FileCharset }) => Promise<FileRow>
  auditUploaded: (file: FileRow, v: { sizeBytes: number; charset: FileCharset }) => Promise<void>
  auditVerificationFailed: (file: FileRow, reason: VerifyFailReason | 'quota') => Promise<void>
  /** createSignedUploadUrl runs inside the startUpload transaction (06 1 transaction note). */
  objects: ObjectsAdapter
}

export interface UploadDeps {
  transaction: <T>(ctx: ServiceContext, fn: (tx: UploadTx) => Promise<T>) => Promise<T>
  objects: () => ObjectsAdapter
  markPurged: (fileId: string, at: Date) => Promise<void>
  limits: () => UploadLimits
  newId: () => string
  log: (event: string, ctx: ServiceContext, extra?: Record<string, unknown>) => void
}

export const defaultUploadDeps: UploadDeps = {
  transaction: (ctx, fn) =>
    getDb().transaction((tx) => {
      const actor = actorOf(ctx)
      return fn({
        assertFolderManage: async (folderId, lock) => (await assertFolderRole(ctx, tx, folderId, 'manage', { lock })).folder,
        assertFile: async (fileId, opts) => {
          const r = await assertFileRole(ctx, tx, fileId, 'manage', opts)
          return { file: r.file, folderName: r.folder.name }
        },
        lockOwnProfile: async () => void (await lockProfileForUpdate(tx, actor.userId)),
        usage: () => sumQuotaUsage(tx, actor.userId),
        insertPending: (v) => insertPendingFile(tx, { ...v, uploadedBy: actor.userId }),
        markDeleted: (id, reason, purged) =>
          markFileDeleted(tx, id, { by: actor.userId, at: ctx.now, reason, purgedAt: purged ? ctx.now : null }),
        activate: async (id, v) => {
          const row = await activateFile(tx, id, { ...v, at: ctx.now })
          if (!row) throw appError('NOT_FOUND', 'common.not_found') // no longer pending
          return row
        },
        auditUploaded: (f, v) =>
          record(tx, ctx, {
            action: 'file.uploaded',
            target: { type: 'file', id: f.id },
            folderId: f.folderId,
            metadata: { displayName: f.displayName, sizeBytes: v.sizeBytes, charset: v.charset },
          }),
        auditVerificationFailed: (f, reason) =>
          record(tx, ctx, {
            action: 'file.upload_verification_failed',
            target: { type: 'file', id: f.id },
            folderId: f.folderId,
            result: 'failure',
            metadata: { reason },
          }),
        objects: getObjects(),
      })
    }),
  objects: getObjects,
  markPurged: (id, at) => markFilesPurged(getDb(), [id], at),
  limits: () => {
    const c = getConfig()
    return {
      maxFileBytes: c.MAX_FILE_SIZE_MB * MB,
      userLimitBytes: c.USER_QUOTA_MB * MB,
      totalLimitBytes: c.TOTAL_QUOTA_MB * MB,
      apiKey: c.SUPABASE_PUBLISHABLE_KEY,
    }
  },
  newId: () => crypto.randomUUID(),
  // Names only: never a path, a signed URL or an SDK message.
  log: (event, ctx, extra) =>
    console.error(JSON.stringify({ ts: new Date().toISOString(), event, requestId: ctx.requestMeta.requestId, ...extra })),
}

export interface StartUploadInput {
  folderId: string
  originalFilename: string
  displayName: string | null
  sizeBytes: number
  contentType: string
}

/** 06 7.1: null -> the file name without its extension, at most 200 characters (code points); never empty. */
export function defaultDisplayName(originalFilename: string): string {
  const cut = (s: string) => Array.from(s).slice(0, 200).join('').trim()
  return cut(originalFilename.replace(/\.html?$/i, '')) || cut(originalFilename)
}

function quotaVerdict(used: { userUsed: number; totalUsed: number }, limits: UploadLimits, addBytes: number) {
  return decideQuota({ ...used, addBytes, userLimit: limits.userLimitBytes, totalLimit: limits.totalLimitBytes })
}

function quotaError(which: 'user' | 'total') {
  return appError('QUOTA_EXCEEDED', which === 'user' ? 'upload.quota_user' : 'upload.quota_total')
}

/** 07 6 checkQuota: throws QUOTA_EXCEEDED. The caller holds the FOR UPDATE lock on the actor's profiles row. */
async function checkQuota(tx: UploadTx, limits: UploadLimits, addBytes: number): Promise<void> {
  const verdict = quotaVerdict(await tx.usage(), limits, addBytes)
  if (verdict !== 'ok') throw quotaError(verdict)
}

/** 06 7.1. */
async function startUpload(
  ctx: ServiceContext,
  input: StartUploadInput,
  deps: UploadDeps = defaultUploadDeps,
): Promise<{ fileId: string; uploadUrl: string; uploadHeaders: Record<string, string>; uploadExpiresAt: string }> {
  const limits = deps.limits()
  const fieldErrors: Record<string, string[]> = {}
  if (input.sizeBytes > limits.maxFileBytes) {
    fieldErrors.sizeBytes = [message('upload.too_large', { maxMb: Math.floor(limits.maxFileBytes / MB) })]
  }
  if (input.contentType !== '' && input.contentType !== 'text/html') fieldErrors.contentType = [message('upload.bad_type')]
  if (Object.keys(fieldErrors).length > 0) throw appError('VALIDATION_FAILED', 'common.validation_failed', { fieldErrors })

  const uploadExpiresAt = new Date(ctx.now.getTime() + UPLOAD_TTL_MS)
  const out = await deps.transaction(ctx, async (tx) => {
    const folder = await tx.assertFolderManage(input.folderId, 'share')
    await tx.lockOwnProfile()
    await checkQuota(tx, limits, input.sizeBytes)
    const fileId = deps.newId()
    const storagePath = `${folder.id}/${fileId}.html`
    await tx.insertPending({
      id: fileId,
      folderId: folder.id,
      displayName: input.displayName ?? defaultDisplayName(input.originalFilename),
      originalFilename: input.originalFilename,
      storagePath,
      sizeBytes: input.sizeBytes,
      uploadExpiresAt,
    })
    // A failure here propagates (the transaction rolls back, INTERNAL). The upload URL must not allow overwriting (D1 / D6).
    const { signedUrl } = await tx.objects.createSignedUploadUrl(storagePath)
    return { fileId, signedUrl }
  })
  const uploadHeaders: Record<string, string> = { 'content-type': 'text/html' }
  if (limits.apiKey) uploadHeaders.apikey = limits.apiKey
  return { fileId: out.fileId, uploadUrl: out.signedUrl, uploadHeaders, uploadExpiresAt: uploadExpiresAt.toISOString() }
}

/** Removes the object; false when the adapter reports a failure or throws (the daily job retries while purged_at is NULL). */
async function removeObject(objects: ObjectsAdapter, path: string): Promise<boolean> {
  try {
    const r = await objects.remove(path)
    return r.failed.length === 0
  } catch {
    return false
  }
}

function verifyError(reason: VerifyFailReason, maxBytes: number) {
  const params = { maxMb: Math.floor(maxBytes / MB) }
  switch (reason) {
    case 'empty':
      return appError('UPLOAD_VERIFICATION_FAILED', 'upload.verify_empty', { params })
    case 'too_large':
      return appError('UPLOAD_VERIFICATION_FAILED', 'upload.verify_too_large', { params })
    case 'not_html':
      return appError('UPLOAD_VERIFICATION_FAILED', 'upload.verify_not_html', { params })
    case 'binary':
      return appError('UPLOAD_VERIFICATION_FAILED', 'upload.verify_binary', { params })
  }
}

async function markPurgedSafe(deps: UploadDeps, ctx: ServiceContext, fileId: string): Promise<void> {
  try {
    await deps.markPurged(fileId, ctx.now)
  } catch {
    deps.log('upload.mark_purged_failed', ctx) // the daily job retries (purged_at stays NULL)
  }
}

/** 06 7.2. */
async function finalizeUpload(ctx: ServiceContext, input: { fileId: string }, deps: UploadDeps = defaultUploadDeps): Promise<FileDetail> {
  const actor = actorOf(ctx)
  const uploader = { id: actor.userId, displayName: actor.displayName }
  const limits = deps.limits()

  // Transaction A (read only).
  const a = await deps.transaction(ctx, async (tx) => {
    const { file, folderName } = await tx.assertFile(input.fileId, {})
    if (file.uploadedBy !== actor.userId) throw appError('NOT_FOUND', 'common.not_found')
    if (file.status === 'active') return { kind: 'done' as const, detail: toFileDetail(file, folderName, uploader, ctx.now) }
    if (file.status !== 'pending') throw appError('NOT_FOUND', 'common.not_found')
    if (file.uploadExpiresAt === null || file.uploadExpiresAt.getTime() <= ctx.now.getTime()) throw appError('CONFLICT', 'upload.expired')
    return { kind: 'verify' as const, file }
  })
  if (a.kind === 'done') return a.detail
  const pending = a.file

  const objects = deps.objects()
  const stat = await objects.stat(pending.storagePath)
  if (stat === null) throw appError('UPLOAD_NOT_FOUND', 'upload.not_found')
  const head = stat.size > 0 && stat.size <= limits.maxFileBytes ? await objects.readHead(pending.storagePath, HEAD_BYTES) : new Uint8Array()
  const verdict = verifyUpload({ size: stat.size, mime: stat.mimeType, head, maxBytes: limits.maxFileBytes })

  if (!verdict.ok) {
    // Transaction B: remove the object first, then mark the row (purged_at only when the removal succeeded).
    const purged = await removeObject(objects, pending.storagePath)
    await deps.transaction(ctx, async (tx) => {
      const { file } = await tx.assertFile(pending.id, { lockFile: true })
      if (file.status !== 'pending') throw appError('NOT_FOUND', 'common.not_found')
      await tx.markDeleted(file.id, 'verification_failed', purged)
      await tx.auditVerificationFailed(file, verdict.reason)
    })
    throw verifyError(verdict.reason, limits.maxFileBytes)
  }

  // Transaction C: folders(share) -> files -> profiles.
  const c = await deps.transaction(ctx, async (tx) => {
    const { file, folderName } = await tx.assertFile(pending.id, { lock: 'share', lockFile: true })
    if (file.status !== 'pending' || file.uploadedBy !== actor.userId) throw appError('NOT_FOUND', 'common.not_found')
    await tx.lockOwnProfile()
    // The usage already contains this row at its declared size (07 6.2).
    const quota = quotaVerdict(await tx.usage(), limits, stat.size - file.sizeBytes)
    if (quota !== 'ok') {
      await tx.markDeleted(file.id, 'verification_failed', false)
      await tx.auditVerificationFailed(file, 'quota')
      return { kind: 'quota' as const, quota }
    }
    const row = await tx.activate(file.id, { sizeBytes: stat.size, charset: verdict.charset })
    await tx.auditUploaded(row, { sizeBytes: stat.size, charset: verdict.charset })
    return { kind: 'ok' as const, detail: toFileDetail(row, folderName, uploader, ctx.now) }
  })
  if (c.kind === 'quota') {
    // The rejection is committed first; the object is removed afterwards (a failure is retried by the daily job).
    if (await removeObject(objects, pending.storagePath)) await markPurgedSafe(deps, ctx, pending.id)
    throw quotaError(c.quota)
  }
  return c.detail
}

/** 06 7.3. The object is removed after the commit; a failure leaves purged_at NULL for the daily job. */
async function cancelUpload(ctx: ServiceContext, input: { fileId: string }, deps: UploadDeps = defaultUploadDeps): Promise<void> {
  const actor = actorOf(ctx)
  const target = await deps.transaction(ctx, async (tx) => {
    const { file } = await tx.assertFile(input.fileId, { lock: 'share', lockFile: true })
    if (file.uploadedBy !== actor.userId || file.status !== 'pending') throw appError('NOT_FOUND', 'common.not_found')
    await tx.markDeleted(file.id, 'upload_abandoned', false)
    return file
  })
  if (await removeObject(deps.objects(), target.storagePath)) await markPurgedSafe(deps, ctx, target.id)
  else deps.log('upload.remove_failed', ctx)
}

export const uploadsService = { startUpload, finalizeUpload, cancelUpload }
