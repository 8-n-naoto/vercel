// Real dependencies for seed.ts / seed-cleanup.ts: supabase-js admin client + postgres.js (DATABASE_URL, app_runtime).
// src/server/auth/supabase-admin.ts is not used: it imports server-only and getConfig(), which do not work under tsx.
import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import type { SeedAuthAdmin, SeedContext, SeedDb } from './seed-lib'

export function buildAuthAdmin(url: string, secretKey: string): SeedAuthAdmin {
  const client = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  return {
    async findUserIdByEmail(email) {
      for (let page = 1; page <= 20; page++) {
        const { data, error } = await client.auth.admin.listUsers({ page, perPage: 200 })
        if (error) throw new Error(`listUsers failed: ${error.message}`)
        const hit = data.users.find((u) => u.email?.toLowerCase() === email)
        if (hit) return hit.id
        if (data.users.length < 200) return null
      }
      return null
    },
    async createUser(email, password) {
      const { data, error } = await client.auth.admin.createUser({ email, password, email_confirm: true })
      if (error || !data.user) throw new Error(`createUser failed for ${email}: ${error?.message ?? 'no user'}`)
      return data.user.id
    },
    async deleteUser(id) {
      const { error } = await client.auth.admin.deleteUser(id)
      if (error) throw new Error(`deleteUser failed: ${error.message}`)
    },
  }
}

export function buildDb(sql: postgres.Sql): SeedDb {
  return {
    async upsertProfile(p) {
      await sql`INSERT INTO app.profiles (id, email, display_name, role) VALUES (${p.id}, ${p.email}, ${p.displayName}, ${p.role})
        ON CONFLICT (id) DO NOTHING`
    },
    async findFolderId(name, createdBy) {
      const rows = await sql<{ id: string }[]>`SELECT id FROM app.folders WHERE name = ${name} AND created_by = ${createdBy} AND deleted_at IS NULL LIMIT 1`
      return rows[0]?.id ?? null
    },
    async createFolder(name, createdBy) {
      const rows = await sql<{ id: string }[]>`INSERT INTO app.folders (name, created_by) VALUES (${name}, ${createdBy}) RETURNING id`
      const id = rows[0]?.id
      if (!id) throw new Error('folder insert returned no row')
      return id
    },
    async addMember(folderId, userId, addedBy) {
      await sql`INSERT INTO app.folder_members (folder_id, user_id, added_by) VALUES (${folderId}, ${userId}, ${addedBy})
        ON CONFLICT (folder_id, user_id) DO NOTHING`
    },
    async profileIdsByEmail(emails) {
      return await sql<{ id: string; email: string }[]>`SELECT id, email FROM app.profiles WHERE email IN ${sql(emails)}`
    },
    async seedFolderIds(name, createdByIds) {
      if (createdByIds.length === 0) return []
      const rows = await sql<{ id: string }[]>`SELECT id FROM app.folders WHERE name = ${name} AND created_by IN ${sql(createdByIds)}`
      return rows.map((r) => r.id)
    },
    async deleteMembers(folderIds, userIds) {
      if (folderIds.length > 0) await sql`DELETE FROM app.folder_members WHERE folder_id IN ${sql(folderIds)}`
      if (userIds.length > 0) await sql`DELETE FROM app.folder_members WHERE user_id IN ${sql(userIds)}`
    },
    async deleteFolders(ids) {
      if (ids.length > 0) await sql`DELETE FROM app.folders WHERE id IN ${sql(ids)}`
    },
    async deleteProfiles(ids) {
      if (ids.length > 0) await sql`DELETE FROM app.profiles WHERE id IN ${sql(ids)}`
    },
  }
}

/** Builds the real context. Called only after the APP_ENV check in the entry script. */
export async function withRealContext(env: Record<string, string | undefined>, body: (ctx: SeedContext) => Promise<number>): Promise<number> {
  const url = env.SUPABASE_URL
  const key = env.SUPABASE_SECRET_KEY
  const dbUrl = env.DATABASE_URL
  if (!url || !key || !dbUrl) {
    console.error('seed: SUPABASE_URL, SUPABASE_SECRET_KEY and DATABASE_URL are required')
    return 1
  }
  const sql = postgres(dbUrl, { prepare: false, max: 1, connect_timeout: 10 })
  try {
    return await body({ env, auth: buildAuthAdmin(url, key), db: buildDb(sql), log: (l) => console.error(l) })
  } finally {
    await sql.end()
  }
}
