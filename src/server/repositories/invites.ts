import 'server-only'
import type { invites } from '@/server/db/schema'
import { notImplemented } from './not-implemented'

export type InviteRow = typeof invites.$inferSelect

export async function findInviteByTokenHash(tokenHash: string): Promise<InviteRow | undefined> {
  return notImplemented('invites.findInviteByTokenHash', [tokenHash])
}

export async function listInvites(): Promise<InviteRow[]> {
  return notImplemented('invites.listInvites', [])
}
