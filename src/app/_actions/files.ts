'use server'
// 06 7.1 - 7.6. startUpload / finalizeUpload / cancelUpload are implemented (services/uploads.ts);
// update / updateRestrictions / delete are STUBs until WP-4.2 (same signatures, they answer NOT_FOUND).
import { revalidatePath } from 'next/cache'
import type { FileDetail } from '@/lib/dto'
import { appError } from '@/lib/errors'
import {
  filesCancelUploadInput,
  filesDeleteInput,
  filesFinalizeUploadInput,
  filesStartUploadInput,
  filesUpdateInput,
  filesUpdateRestrictionsInput,
} from '@/lib/schemas/files'
import { defineAction } from '@/server/actions/define-action'
import { uploadsService } from '@/server/services/uploads'

function revalidateFile(folderId: string, fileId: string): void {
  revalidatePath(`/folders/${folderId}`)
  revalidatePath(`/folders/${folderId}/files/${fileId}`)
}

export const filesStartUpload = defineAction({
  name: 'files.startUpload',
  auth: 'admin',
  input: filesStartUploadInput,
  rateLimit: [],
  handler: async (ctx, input): Promise<{ fileId: string; uploadUrl: string; uploadHeaders: Record<string, string>; uploadExpiresAt: string }> => {
    const out = await uploadsService.startUpload(ctx, input)
    revalidatePath(`/folders/${input.folderId}`)
    return out
  },
})

export const filesFinalizeUpload = defineAction({
  name: 'files.finalizeUpload',
  auth: 'admin',
  input: filesFinalizeUploadInput,
  rateLimit: [],
  handler: async (ctx, input): Promise<FileDetail> => {
    const out = await uploadsService.finalizeUpload(ctx, input)
    revalidateFile(out.folderId, out.id)
    return out
  },
})

export const filesCancelUpload = defineAction({
  name: 'files.cancelUpload',
  auth: 'admin',
  input: filesCancelUploadInput,
  rateLimit: [],
  handler: async (ctx, input): Promise<void> => {
    await uploadsService.cancelUpload(ctx, input)
  },
})

// STUB: WP-4.2 replaces.
export const filesUpdate = defineAction({
  name: 'files.update',
  auth: 'admin',
  input: filesUpdateInput,
  rateLimit: [],
  handler: async (): Promise<FileDetail> => {
    throw appError('NOT_FOUND', 'common.not_found')
  },
})

// STUB: WP-4.2 replaces.
export const filesUpdateRestrictions = defineAction({
  name: 'files.updateRestrictions',
  auth: 'admin',
  input: filesUpdateRestrictionsInput,
  rateLimit: [],
  handler: async (): Promise<FileDetail> => {
    throw appError('NOT_FOUND', 'common.not_found')
  },
})

// STUB: WP-4.2 replaces.
export const filesDelete = defineAction({
  name: 'files.delete',
  auth: 'admin',
  input: filesDeleteInput,
  rateLimit: [],
  handler: async (): Promise<{ revokedLinks: number; purged: boolean }> => {
    throw appError('NOT_FOUND', 'common.not_found')
  },
})
