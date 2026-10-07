// Shared logic of seed.ts / seed-cleanup.ts (WP-1.5). Dependencies are injected so that unit tests can mock Auth and the DB.
// Never prints the password, keys, or connection strings. Output is e-mail, role, and created / reused only.
import { z } from 'zod'
import type { UserRole } from '../src/lib/domain'

export const SEED_FOLDER_NAME = 'seed-folder'
export const SEED_USERS: readonly { email: string; displayName: string; role: UserRole; member: boolean }[] = [
  { email: 'seed-admin@example.com', displayName: 'Seed Admin', role: 'admin', member: false },
  { email: 'seed-member@example.com', displayName: 'Seed Member', role: 'user', member: true },
  { email: 'seed-outsider@example.com', displayName: 'Seed Outsider', role: 'user', member: false },
]
export const SEED_EMAILS: readonly string[] = SEED_USERS.map((u) => u.email)
const ADMIN_EMAIL = 'seed-admin@example.com'

/** Auth admin API subset (auth.admin of supabase-js). */
export interface SeedAuthAdmin {
  findUserIdByEmail(email: string): Promise<string | null>
  createUser(email: string, password: string): Promise<string>
  deleteUser(id: string): Promise<void>
}

/** DB subset. Implemented with postgres.js in seed-runtime.ts (DATABASE_URL, app_runtime). */
export interface SeedDb {
  upsertProfile(p: { id: string; email: string; displayName: string; role: UserRole }): Promise<void>
  findFolderId(name: string, createdBy: string): Promise<string | null>
  createFolder(name: string, createdBy: string): Promise<string>
  addMember(folderId: string, userId: string, addedBy: string): Promise<void>
  // cleanup
  profileIdsByEmail(emails: readonly string[]): Promise<{ id: string; email: string }[]>
  seedFolderIds(name: string, createdByIds: readonly string[]): Promise<string[]>
  deleteMembers(folderIds: readonly string[], userIds: readonly string[]): Promise<void>
  deleteFolders(ids: readonly string[]): Promise<void>
  deleteProfiles(ids: readonly string[]): Promise<void>
}

export interface SeedContext {
  env: Record<string, string | undefined>
  auth: SeedAuthAdmin
  db: SeedDb
  log: (line: string) => void
}

const passwordSchema = z.string().min(12)

/** Checks APP_ENV (and SEED_PASSWORD when needed) before any dependency is touched. */
function preflight(ctx: SeedContext, needPassword: boolean): { ok: boolean; password?: string } {
  const appEnv = ctx.env.APP_ENV
  if (appEnv !== 'local' && appEnv !== 'test') {
    ctx.log(`seed: APP_ENV must be "local" or "test" (got "${appEnv ?? ''}"). Refusing to run.`)
    return { ok: false }
  }
  if (!needPassword) return { ok: true }
  const parsed = passwordSchema.safeParse(ctx.env.SEED_PASSWORD)
  if (!parsed.success) {
    ctx.log('seed: SEED_PASSWORD is not set or shorter than 12 characters. Set it in .env.local (value is not shown).')
    return { ok: false }
  }
  return { ok: true, password: parsed.data }
}

/** Returns the process exit code. */
export async function runSeed(ctx: SeedContext): Promise<number> {
  const pre = preflight(ctx, true)
  if (!pre.ok || pre.password === undefined) return 1
  const ids = new Map<string, string>()
  for (const u of SEED_USERS) {
    let id = await ctx.auth.findUserIdByEmail(u.email)
    const created = id === null
    if (id === null) id = await ctx.auth.createUser(u.email, pre.password)
    ids.set(u.email, id)
    await ctx.db.upsertProfile({ id, email: u.email, displayName: u.displayName, role: u.role })
    ctx.log(`auth+profile  ${u.email}  ${u.role}  ${created ? 'created' : 'reused'}`)
  }
  const adminId = ids.get(ADMIN_EMAIL)
  if (adminId === undefined) throw new Error('seed admin id missing')
  let folderId = await ctx.db.findFolderId(SEED_FOLDER_NAME, adminId)
  const folderCreated = folderId === null
  if (folderId === null) folderId = await ctx.db.createFolder(SEED_FOLDER_NAME, adminId)
  ctx.log(`folder        ${SEED_FOLDER_NAME}  ${folderCreated ? 'created' : 'reused'}`)
  for (const u of SEED_USERS.filter((x) => x.member)) {
    const uid = ids.get(u.email)
    if (uid === undefined) throw new Error('seed member id missing')
    await ctx.db.addMember(folderId, uid, adminId)
    ctx.log(`folder_member ${u.email}  ensured`)
  }
  ctx.log('seed: done (files / share_links are not seeded)')
  return 0
}

/** Returns the process exit code. Only rows tied to the three fixed seed e-mails are touched; other FK references fail (RESTRICT) on purpose. */
export async function runCleanup(ctx: SeedContext): Promise<number> {
  const pre = preflight(ctx, false)
  if (!pre.ok) return 1
  const profiles = await ctx.db.profileIdsByEmail(SEED_EMAILS)
  const userIds = profiles.map((p) => p.id)
  const adminIds = profiles.filter((p) => p.email === ADMIN_EMAIL).map((p) => p.id)
  const folderIds = await ctx.db.seedFolderIds(SEED_FOLDER_NAME, adminIds)
  ctx.log(`seed-cleanup: targets profiles=${userIds.length} folders=${folderIds.length}`)
  await ctx.db.deleteMembers(folderIds, userIds)
  await ctx.db.deleteFolders(folderIds)
  await ctx.db.deleteProfiles(userIds)
  for (const email of SEED_EMAILS) {
    const id = await ctx.auth.findUserIdByEmail(email)
    if (id !== null) await ctx.auth.deleteUser(id)
    ctx.log(`auth          ${email}  ${id !== null ? 'deleted' : 'absent'}`)
  }
  ctx.log('seed-cleanup: done')
  return 0
}
