'use server'
// 06 8.4 / 8.5. view.openShareLink (8.6) belongs to Phase 6.
import type { OpenAsMemberResult } from '@/lib/dto'
import { viewOpenAsMemberInput, viewRequestMemberDownloadInput } from '@/lib/schemas/view'
import { defineAction } from '@/server/actions/define-action'
import { viewService } from '@/server/services/view'

export const viewOpenAsMember = defineAction({
  name: 'view.openAsMember',
  auth: 'user',
  input: viewOpenAsMemberInput,
  rateLimit: [],
  handler: async (ctx, input): Promise<OpenAsMemberResult> => viewService.openAsMember(ctx, input),
})

export const viewRequestMemberDownload = defineAction({
  name: 'view.requestMemberDownload',
  auth: 'user',
  input: viewRequestMemberDownloadInput,
  rateLimit: [],
  handler: async (ctx, input): Promise<{ downloadUrl: string; expiresAt: string }> => viewService.requestMemberDownload(ctx, input),
})
