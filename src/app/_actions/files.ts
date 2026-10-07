'use server'
// 06 7.1 - 7.6. startUpload / finalizeUpload / cancelUpload are implemented (services/uploads.ts);
// update / updateRestrictions / delete are in services/file-edits.ts (WP-4.2).
import { revalidatePath } from 'next/cache'
import type { FileDetail } from '@/lib/dto'
import {
  filesCancelUploadInput,
  filesDeleteInput,
  filesFinalizeUploadInput,
  filesStartUploadInput,
  filesUpdateInput,
  filesUpdateRestrictionsInput,
} from '@/lib/schemas/files'
import { defineAction } from '@/server/actions/define-action'
import { fileEditsService } from '@/server/services/file-edits'
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

export const filesUpdate = defineAction({
  name: 'files.update',
  auth: 'admin',
  input: filesUpdateInput,
  rateLimit: [],
  handler: async (ctx, input): Promise<FileDetail> => {
    const out = await fileEditsService.update(ctx, input)
    revalidateFile(out.folderId, out.id)
    return out
  },
})

export const filesUpdateRestrictions = defineAction({
  name: 'files.updateRestrictions',
  auth: 'admin',
  input: filesUpdateRestrictionsInput,
  rateLimit: [],
  handler: async (ctx, input): Promise<FileDetail> => {
    const out = await fileEditsService.updateRestrictions(ctx, input)
    revalidateFile(out.folderId, out.id)
    return out
  },
})

export const filesDelete = defineAction({
  name: 'files.delete',
  auth: 'admin',
  input: filesDeleteInput,
  rateLimit: [],
  handler: async (ctx, input): Promise<{ revokedLinks: number; purged: boolean }> => {
    const out = await fileEditsService.delete(ctx, input)
    revalidatePath('/folders', 'layout') // the result has no folder id: refresh the folder list / detail pages
    return out
  },
})
