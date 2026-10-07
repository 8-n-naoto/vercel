'use server'
// 06 6.4 / 6.5. (06 1.1 lists these under folders.ts; the split keeps each file small. The export names follow the action names.)
import { revalidatePath } from 'next/cache'
import { membersAddInput, membersRemoveInput } from '@/lib/schemas/members'
import { defineAction } from '@/server/actions/define-action'
import { membersService } from '@/server/services/members'

export const membersAdd = defineAction({
  name: 'members.add',
  auth: 'admin',
  input: membersAddInput,
  rateLimit: [],
  handler: async (ctx, input): Promise<{ added: number; skipped: number }> => {
    const out = await membersService.add(ctx, input)
    revalidatePath(`/folders/${input.folderId}`)
    revalidatePath('/admin/folders')
    return out
  },
})

export const membersRemove = defineAction({
  name: 'members.remove',
  auth: 'admin',
  input: membersRemoveInput,
  rateLimit: [],
  handler: async (ctx, input): Promise<void> => {
    await membersService.remove(ctx, input)
    revalidatePath(`/folders/${input.folderId}`)
    revalidatePath('/admin/folders')
  },
})
