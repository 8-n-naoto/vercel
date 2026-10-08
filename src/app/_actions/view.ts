'use server'
// 06 8.4 / 8.5. view.openShareLink (8.6) belongs to Phase 6.
import type { OpenAsMemberResult } from '@/lib/dto'
import { viewOpenAsMemberInput, viewRequestMemberDownloadInput } from '@/lib/schemas/view'
import { defineAction } from '@/server/actions/define-action'
import { rateLimitKey } from '@/server/security/rate-limit'
import { viewService } from '@/server/services/view'

export const viewOpenAsMember = defineAction({
  name: 'view.openAsMember',
  auth: 'user',
  input: viewOpenAsMemberInput,
  // Q-28 / D-022: ticket issuing is limited to 30 per 60 s per user (06 3.5). view.requestMemberDownload has its own counter (download:user, Q-33 / D-023).
  rateLimit: [{ name: 'ticket:user', key: (ctx) => (ctx.actor ? rateLimitKey('ticket:user', { userId: ctx.actor.userId }) : null), limit: 30, windowSec: 60 }],
  handler: async (ctx, input): Promise<OpenAsMemberResult> => viewService.openAsMember(ctx, input),
})

export const viewRequestMemberDownload = defineAction({
  name: 'view.requestMemberDownload',
  auth: 'user',
  input: viewRequestMemberDownloadInput,
  // Q-33 / D-023: download ticket issuing is limited to 20 per 60 s per user, a counter separate from ticket:user (06 3.5).
  rateLimit: [{ name: 'download:user', key: (ctx) => (ctx.actor ? rateLimitKey('download:user', { userId: ctx.actor.userId }) : null), limit: 20, windowSec: 60 }],
  handler: async (ctx, input): Promise<{ downloadUrl: string; expiresAt: string }> => viewService.requestMemberDownload(ctx, input),
})
