// Drizzle schema. 1:1 with docs/05 (sections 2, 9). Triggers, RLS, policies, GRANTs and roles live only in
// drizzle/0000_init.sql and are intentionally not expressed here (05 section 9).
// Enum values come from src/lib/domain.ts; the database side is enforced by CHECK constraints.
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  inet,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import {
  ACCESS_PURPOSES,
  ACCESS_RESULTS,
  ACCESS_VIAS,
  AUDIT_RESULTS,
  AUDIT_TARGET_TYPES,
  DENY_REASONS,
  FILE_CHARSETS,
  FILE_CONTENT_TYPES,
  FILE_DELETE_REASONS,
  FILE_STATUSES,
  INVITE_PURPOSES,
  SHARE_LINK_REVOKE_REASONS,
  USER_ROLES,
} from '@/lib/domain'

export const app = pgSchema('app')

// Declared only as an FK target. schemaFilter: ['app'] keeps it out of the diff (05 section 9).
const auth = pgSchema('auth')
export const authUsers = auth.table('users', { id: uuid('id').primaryKey() })

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

export const profiles = app.table(
  'profiles',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role', { enum: USER_ROLES }).notNull().default('user'),
    disabledAt: tstz('disabled_at'),
    sessionRevokedAt: tstz('session_revoked_at'),
    lastLoginAt: tstz('last_login_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'profiles_id_fkey', columns: [t.id], foreignColumns: [authUsers.id] }).onDelete('restrict'),
    unique('profiles_email_key').on(t.email),
    check('profiles_email_lower_ck', sql`email = lower(email)`),
    check('profiles_email_len_ck', sql`char_length(email) BETWEEN 3 AND 254`),
    check('profiles_display_name_ck', sql`char_length(display_name) BETWEEN 1 AND 50 AND display_name = btrim(display_name)`),
    check('profiles_role_ck', sql`role IN ('admin', 'user')`),
  ],
)

export const invites = app.table(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    purpose: text('purpose', { enum: INVITE_PURPOSES }).notNull(),
    email: text('email').notNull(),
    role: text('role', { enum: USER_ROLES }),
    userId: uuid('user_id'),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    expiresAt: tstz('expires_at').notNull(),
    usedAt: tstz('used_at'),
    revokedAt: tstz('revoked_at'),
    createdBy: uuid('created_by').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'invites_user_id_fkey', columns: [t.userId], foreignColumns: [profiles.id] }).onDelete('restrict'),
    foreignKey({ name: 'invites_created_by_fkey', columns: [t.createdBy], foreignColumns: [profiles.id] }).onDelete('restrict'),
    unique('invites_token_hash_key').on(t.tokenHash),
    check('invites_token_hash_ck', sql`token_hash ~ '^[0-9a-f]{64}$'`),
    check('invites_purpose_ck', sql`purpose IN ('signup', 'password_reset')`),
    check('invites_email_lower_ck', sql`email = lower(email)`),
    check('invites_email_len_ck', sql`char_length(email) BETWEEN 3 AND 254`),
    check('invites_role_ck', sql`role IS NULL OR role IN ('admin', 'user')`),
    check(
      'invites_purpose_fields_ck',
      sql`(purpose = 'signup' AND role IS NOT NULL AND user_id IS NULL) OR (purpose = 'password_reset' AND role IS NULL AND user_id IS NOT NULL)`,
    ),
    check('invites_used_revoked_ck', sql`used_at IS NULL OR revoked_at IS NULL`),
    check('invites_expires_ck', sql`expires_at > created_at`),
    uniqueIndex('invites_signup_open_email_uq')
      .on(t.email)
      .where(sql`purpose = 'signup' AND used_at IS NULL AND revoked_at IS NULL`),
    uniqueIndex('invites_reset_open_user_uq')
      .on(t.userId)
      .where(sql`purpose = 'password_reset' AND used_at IS NULL AND revoked_at IS NULL`),
    index('invites_created_at_idx').on(t.createdAt.desc()),
    index('invites_expires_at_idx').on(t.expiresAt),
  ],
)

export const folders = app.table(
  'folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    createdBy: uuid('created_by').notNull(),
    deletedAt: tstz('deleted_at'),
    deletedBy: uuid('deleted_by'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'folders_created_by_fkey', columns: [t.createdBy], foreignColumns: [profiles.id] }).onDelete('restrict'),
    foreignKey({ name: 'folders_deleted_by_fkey', columns: [t.deletedBy], foreignColumns: [profiles.id] }).onDelete('restrict'),
    check('folders_name_ck', sql`char_length(name) BETWEEN 1 AND 100 AND name = btrim(name)`),
    check('folders_description_ck', sql`char_length(description) <= 500`),
    check('folders_deleted_ck', sql`(deleted_at IS NULL) = (deleted_by IS NULL)`),
    index('folders_created_at_idx').on(t.createdAt.desc()).where(sql`deleted_at IS NULL`),
  ],
)

export const folderMembers = app.table(
  'folder_members',
  {
    folderId: uuid('folder_id').notNull(),
    userId: uuid('user_id').notNull(),
    addedBy: uuid('added_by').notNull(),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'folder_members_pkey', columns: [t.folderId, t.userId] }),
    foreignKey({ name: 'folder_members_folder_id_fkey', columns: [t.folderId], foreignColumns: [folders.id] }).onDelete('restrict'),
    foreignKey({ name: 'folder_members_user_id_fkey', columns: [t.userId], foreignColumns: [profiles.id] }).onDelete('restrict'),
    foreignKey({ name: 'folder_members_added_by_fkey', columns: [t.addedBy], foreignColumns: [profiles.id] }).onDelete('restrict'),
    index('folder_members_user_id_idx').on(t.userId),
  ],
)

export const files = app.table(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    folderId: uuid('folder_id').notNull(),
    uploadedBy: uuid('uploaded_by').notNull(),
    displayName: text('display_name').notNull(),
    originalFilename: text('original_filename').notNull(),
    storagePath: text('storage_path').notNull(),
    contentType: text('content_type', { enum: FILE_CONTENT_TYPES }).notNull().default('text/html'),
    charset: text('charset', { enum: FILE_CHARSETS }).notNull().default('utf-8'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    status: text('status', { enum: FILE_STATUSES }).notNull().default('pending'),
    suspended: boolean('suspended').notNull().default(false),
    viewStartsAt: tstz('view_starts_at'),
    viewEndsAt: tstz('view_ends_at'),
    expiresAt: tstz('expires_at'),
    downloadAllowed: boolean('download_allowed').notNull().default(false),
    uploadExpiresAt: tstz('upload_expires_at'),
    activatedAt: tstz('activated_at'),
    deletedAt: tstz('deleted_at'),
    deletedBy: uuid('deleted_by'),
    deleteReason: text('delete_reason', { enum: FILE_DELETE_REASONS }),
    purgedAt: tstz('purged_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'files_folder_id_fkey', columns: [t.folderId], foreignColumns: [folders.id] }).onDelete('restrict'),
    foreignKey({ name: 'files_uploaded_by_fkey', columns: [t.uploadedBy], foreignColumns: [profiles.id] }).onDelete('restrict'),
    foreignKey({ name: 'files_deleted_by_fkey', columns: [t.deletedBy], foreignColumns: [profiles.id] }).onDelete('restrict'),
    unique('files_storage_path_key').on(t.storagePath),
    check('files_display_name_ck', sql`char_length(display_name) BETWEEN 1 AND 200 AND display_name = btrim(display_name)`),
    check(
      'files_original_filename_ck',
      sql`char_length(original_filename) BETWEEN 1 AND 255 AND position('/' IN original_filename) = 0 AND position(E'\\\\' IN original_filename) = 0 AND original_filename !~ '[[:cntrl:]]'`,
    ),
    check('files_storage_path_ck', sql`storage_path = folder_id::text || '/' || id::text || '.html'`),
    check('files_content_type_ck', sql`content_type IN ('text/html')`),
    check('files_charset_ck', sql`charset IN ('utf-8', 'shift_jis', 'euc-jp', 'iso-2022-jp')`),
    check('files_size_bytes_ck', sql`size_bytes > 0`),
    check('files_status_ck', sql`status IN ('pending', 'active', 'deleted')`),
    check('files_view_range_ck', sql`view_starts_at IS NULL OR view_ends_at IS NULL OR view_starts_at < view_ends_at`),
    check(
      'files_delete_reason_ck',
      sql`delete_reason IS NULL OR delete_reason IN ('user', 'folder_deleted', 'expired', 'upload_abandoned', 'verification_failed')`,
    ),
    check('files_deleted_ck', sql`(status = 'deleted') = (deleted_at IS NOT NULL AND delete_reason IS NOT NULL)`),
    check('files_deleted_by_ck', sql`deleted_by IS NULL OR status = 'deleted'`),
    check('files_pending_ck', sql`status <> 'pending' OR upload_expires_at IS NOT NULL`),
    check('files_active_ck', sql`status <> 'active' OR (activated_at IS NOT NULL AND upload_expires_at IS NULL)`),
    check('files_purged_ck', sql`purged_at IS NULL OR status = 'deleted'`),
    index('files_folder_id_status_idx').on(t.folderId, t.status),
    index('files_uploaded_by_quota_idx').on(t.uploadedBy).where(sql`status IN ('pending', 'active')`),
    index('files_upload_expires_at_idx').on(t.uploadExpiresAt).where(sql`status = 'pending'`),
    index('files_expires_at_idx').on(t.expiresAt).where(sql`status = 'active' AND expires_at IS NOT NULL`),
    index('files_unpurged_idx').on(t.deletedAt).where(sql`status = 'deleted' AND purged_at IS NULL`),
  ],
)

export const shareLinks = app.table(
  'share_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fileId: uuid('file_id').notNull(),
    tokenHash: char('token_hash', { length: 64 }).notNull(),
    tokenHint: char('token_hint', { length: 4 }).notNull(),
    label: text('label').notNull().default(''),
    expiresAt: tstz('expires_at').notNull(),
    maxViews: integer('max_views'),
    viewCount: integer('view_count').notNull().default(0),
    passwordHash: text('password_hash'),
    downloadAllowed: boolean('download_allowed').notNull().default(false),
    createdBy: uuid('created_by').notNull(),
    revokedAt: tstz('revoked_at'),
    revokedBy: uuid('revoked_by'),
    revokeReason: text('revoke_reason', { enum: SHARE_LINK_REVOKE_REASONS }),
    replacedBy: uuid('replaced_by'),
    lastViewedAt: tstz('last_viewed_at'),
    createdAt: tstz('created_at').notNull().defaultNow(),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: 'share_links_file_id_fkey', columns: [t.fileId], foreignColumns: [files.id] }).onDelete('restrict'),
    foreignKey({ name: 'share_links_created_by_fkey', columns: [t.createdBy], foreignColumns: [profiles.id] }).onDelete('restrict'),
    foreignKey({ name: 'share_links_revoked_by_fkey', columns: [t.revokedBy], foreignColumns: [profiles.id] }).onDelete('restrict'),
    foreignKey({ name: 'share_links_replaced_by_fkey', columns: [t.replacedBy], foreignColumns: [t.id] }).onDelete('restrict'),
    unique('share_links_token_hash_key').on(t.tokenHash),
    check('share_links_token_hash_ck', sql`token_hash ~ '^[0-9a-f]{64}$'`),
    check('share_links_token_hint_ck', sql`token_hint ~ '^[A-Za-z0-9_-]{4}$'`),
    check('share_links_label_ck', sql`char_length(label) <= 100 AND label = btrim(label)`),
    check('share_links_expires_ck', sql`expires_at > created_at`),
    check('share_links_max_views_ck', sql`max_views IS NULL OR max_views BETWEEN 1 AND 10000`),
    check('share_links_view_count_ck', sql`view_count >= 0 AND (max_views IS NULL OR view_count <= max_views)`),
    check('share_links_password_hash_ck', sql`password_hash IS NULL OR password_hash LIKE 'scrypt$%'`),
    check(
      'share_links_revoke_reason_ck',
      sql`revoke_reason IS NULL OR revoke_reason IN ('user', 'reissued', 'file_deleted', 'folder_deleted')`,
    ),
    check('share_links_revoked_ck', sql`(revoked_at IS NULL) = (revoke_reason IS NULL)`),
    check('share_links_revoked_by_ck', sql`revoked_by IS NULL OR revoked_at IS NOT NULL`),
    check('share_links_replaced_by_ck', sql`replaced_by IS NULL OR revoke_reason = 'reissued'`),
    index('share_links_file_id_created_at_idx').on(t.fileId, t.createdAt.desc()),
  ],
)

export const accessLogs = app.table(
  'access_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: tstz('occurred_at').notNull().defaultNow(),
    fileId: uuid('file_id').notNull(),
    folderId: uuid('folder_id').notNull(),
    via: text('via', { enum: ACCESS_VIAS }).notNull(),
    purpose: text('purpose', { enum: ACCESS_PURPOSES }).notNull(),
    shareLinkId: uuid('share_link_id'),
    userId: uuid('user_id'),
    result: text('result', { enum: ACCESS_RESULTS }).notNull(),
    denyReason: text('deny_reason', { enum: DENY_REASONS }),
    ticketHash: char('ticket_hash', { length: 64 }),
    ticketExpiresAt: tstz('ticket_expires_at'),
    deliveredAt: tstz('delivered_at'),
    bytesSent: bigint('bytes_sent', { mode: 'number' }),
    ip: inet('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    foreignKey({ name: 'access_logs_file_id_fkey', columns: [t.fileId], foreignColumns: [files.id] }).onDelete('restrict'),
    foreignKey({ name: 'access_logs_folder_id_fkey', columns: [t.folderId], foreignColumns: [folders.id] }).onDelete('restrict'),
    foreignKey({ name: 'access_logs_share_link_id_fkey', columns: [t.shareLinkId], foreignColumns: [shareLinks.id] }).onDelete('restrict'),
    foreignKey({ name: 'access_logs_user_id_fkey', columns: [t.userId], foreignColumns: [profiles.id] }).onDelete('restrict'),
    unique('access_logs_ticket_hash_key').on(t.ticketHash),
    check('access_logs_via_ck', sql`via IN ('member', 'admin_preview', 'share_link')`),
    check('access_logs_purpose_ck', sql`purpose IN ('view', 'download')`),
    check('access_logs_result_ck', sql`result IN ('granted', 'denied')`),
    check('access_logs_via_link_ck', sql`(via = 'share_link') = (share_link_id IS NOT NULL)`),
    check('access_logs_via_user_ck', sql`(via = 'share_link') = (user_id IS NULL)`),
    check(
      'access_logs_deny_reason_ck',
      sql`deny_reason IS NULL OR deny_reason IN ('NOT_FOUND', 'LINK_REVOKED', 'NOT_MEMBER', 'USER_DISABLED', 'SUSPENDED', 'FILE_EXPIRED', 'NOT_STARTED', 'ENDED', 'LINK_EXPIRED', 'DOWNLOAD_NOT_ALLOWED', 'PASSWORD_REQUIRED', 'PASSWORD_INVALID', 'VIEW_LIMIT_REACHED')`,
    ),
    check('access_logs_denied_ck', sql`(result = 'denied') = (deny_reason IS NOT NULL)`),
    check(
      'access_logs_ticket_ck',
      sql`result = 'granted' OR (ticket_hash IS NULL AND ticket_expires_at IS NULL AND delivered_at IS NULL)`,
    ),
    check('access_logs_granted_ck', sql`result <> 'granted' OR ticket_expires_at IS NOT NULL`),
    check('access_logs_ticket_hash_ck', sql`ticket_hash IS NULL OR ticket_hash ~ '^[0-9a-f]{64}$'`),
    check('access_logs_delivered_ck', sql`(delivered_at IS NULL) = (bytes_sent IS NULL)`),
    check('access_logs_bytes_sent_ck', sql`bytes_sent IS NULL OR bytes_sent >= 0`),
    check('access_logs_user_agent_ck', sql`user_agent IS NULL OR char_length(user_agent) <= 256`),
    index('access_logs_file_id_occurred_at_idx').on(t.fileId, t.occurredAt.desc()),
    index('access_logs_folder_id_occurred_at_idx').on(t.folderId, t.occurredAt.desc()),
    index('access_logs_share_link_id_occurred_at_idx').on(t.shareLinkId, t.occurredAt.desc()),
    index('access_logs_occurred_at_idx').on(t.occurredAt),
    index('access_logs_delivered_at_idx').on(t.deliveredAt).where(sql`delivered_at IS NOT NULL`),
    index('access_logs_ticket_expires_at_idx').on(t.ticketExpiresAt).where(sql`ticket_hash IS NOT NULL`),
  ],
)

export const auditLogs = app.table(
  'audit_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: tstz('occurred_at').notNull().defaultNow(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    targetType: text('target_type', { enum: AUDIT_TARGET_TYPES }),
    targetId: text('target_id'),
    // Denormalized filter column. No FK on purpose (05 section 2.9).
    folderId: uuid('folder_id'),
    result: text('result', { enum: AUDIT_RESULTS }).notNull().default('success'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ip: inet('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    foreignKey({ name: 'audit_logs_actor_id_fkey', columns: [t.actorId], foreignColumns: [profiles.id] }).onDelete('restrict'),
    check('audit_logs_action_ck', sql`action ~ '^[a-z_]+\\.[a-z_]+$'`),
    check(
      'audit_logs_target_type_ck',
      sql`target_type IS NULL OR target_type IN ('user', 'invite', 'folder', 'member', 'file', 'share_link', 'system')`,
    ),
    check('audit_logs_target_ck', sql`target_id IS NULL OR target_type IS NOT NULL`),
    check('audit_logs_target_id_ck', sql`target_id IS NULL OR char_length(target_id) <= 100`),
    check('audit_logs_result_ck', sql`result IN ('success', 'failure')`),
    check('audit_logs_metadata_ck', sql`jsonb_typeof(metadata) = 'object'`),
    check('audit_logs_user_agent_ck', sql`user_agent IS NULL OR char_length(user_agent) <= 256`),
    index('audit_logs_occurred_at_idx').on(t.occurredAt.desc()),
    index('audit_logs_actor_id_occurred_at_idx').on(t.actorId, t.occurredAt.desc()),
    index('audit_logs_target_idx').on(t.targetType, t.targetId),
    index('audit_logs_folder_id_occurred_at_idx').on(t.folderId, t.occurredAt.desc()).where(sql`folder_id IS NOT NULL`),
    index('audit_logs_action_occurred_at_idx').on(t.action, t.occurredAt.desc()),
  ],
)

export const rateLimits = app.table(
  'rate_limits',
  {
    key: text('key').notNull(),
    windowStart: tstz('window_start').notNull(),
    count: integer('count').notNull().default(1),
  },
  (t) => [
    primaryKey({ name: 'rate_limits_pkey', columns: [t.key, t.windowStart] }),
    check('rate_limits_key_ck', sql`char_length(key) BETWEEN 1 AND 200`),
    check('rate_limits_count_ck', sql`count >= 1`),
    index('rate_limits_window_start_idx').on(t.windowStart),
  ],
)
