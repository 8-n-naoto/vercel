import 'server-only'
import type { profiles } from '@/server/db/schema'
import { notImplemented } from './not-implemented'

export type ProfileRow = typeof profiles.$inferSelect

export async function findProfileById(id: string): Promise<ProfileRow | undefined> {
  return notImplemented('profiles.findProfileById', [id])
}

export async function findProfileByEmail(email: string): Promise<ProfileRow | undefined> {
  return notImplemented('profiles.findProfileByEmail', [email])
}

export async function listProfiles(): Promise<ProfileRow[]> {
  return notImplemented('profiles.listProfiles', [])
}
