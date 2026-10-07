// Input schemas of the view Actions (06 8.4 - 8.6). Shared by client and server.
import { z } from 'zod'
import { zToken, zUuid } from './common'

export const viewOpenAsMemberInput = z.object({ fileId: zUuid }).strict()
export const viewRequestMemberDownloadInput = z.object({ fileId: zUuid }).strict()
// Used by view.openShareLink (Phase 6); no Action exists yet.
export const viewOpenShareLinkInput = z
  .object({ token: zToken, password: z.string().min(1).max(128).nullable().default(null) })
  .strict()

export type ViewOpenAsMemberInput = z.infer<typeof viewOpenAsMemberInput>
export type ViewRequestMemberDownloadInput = z.infer<typeof viewRequestMemberDownloadInput>
export type ViewOpenShareLinkInput = z.infer<typeof viewOpenShareLinkInput>
