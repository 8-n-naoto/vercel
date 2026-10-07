'use server'
// 06 6.1 / 6.2 / 6.3. The procedures live in services/folders.ts; the Actions add revalidatePath only.
import { revalidatePath } from 'next/cache'
import { foldersCreateInput, foldersDeleteInput, foldersUpdateInput } from '@/lib/schemas/folders'
import { defineAction } from '@/server/actions/define-action'
import { foldersService } from '@/server/services/folders'

export const foldersCreate = defineAction({
  name: 'folders.create',
  auth: 'admin',
  input: foldersCreateInput,
  rateLimit: [],
  handler: async (ctx, input): Promise<{ folderId: string }> => {
    const out = await foldersService.create(ctx, input)
    revalidatePath('/folders')
    revalidatePath('/admin/folders')
    return out
  },
})

export const foldersUpdate = defineAction({
  name: 'folders.update',
  auth: 'admin',
  input: foldersUpdateInput,
  rateLimit: [],
  handler: async (ctx, input): Promise<void> => {
    await foldersService.update(ctx, input)
    revalidatePath('/folders')
    revalidatePath(`/folders/${input.folderId}`)
    revalidatePath('/admin/folders')
  },
})

export const foldersDelete = defineAction({
  name: 'folders.delete',
  auth: 'admin',
  input: foldersDeleteInput,
  rateLimit: [],
  handler: async (ctx, input): Promise<{ deletedFiles: number; revokedLinks: number; purgeFailed: number }> => {
    const out = await foldersService.remove(ctx, input)
    revalidatePath('/folders')
    revalidatePath(`/folders/${input.folderId}`)
    revalidatePath('/admin/folders')
    return out
  },
})
