import { describe, expect, it } from 'vitest'
import {
  ACCESS_PURPOSES, ACCESS_RESULTS, ACCESS_VIAS, AUDIT_ACTIONS, AUDIT_RESULTS, AUDIT_TARGET_TYPES, DENY_REASONS, FILE_CHARSETS,
  FILE_CONTENT_TYPES, FILE_DELETE_REASONS, FILE_DISPLAY_STATES, FILE_STATUSES, INVITE_PURPOSES, INVITE_STATES, PUBLIC_DENY_REASONS,
  SHARE_LINK_REVOKE_REASONS, SHARE_LINK_STATES, USER_ROLES,
} from '@/lib/domain'

// Literal copies of the CHECK constraints in 05 2 (the DB side). If either side changes, this test fails (05 5: same commit).
describe('domain.ts matches the 05 CHECK constraints', () => {
  it.each([
    ['profiles_role_ck / invites_role_ck', USER_ROLES, ['admin', 'user']],
    ['invites_purpose_ck', INVITE_PURPOSES, ['signup', 'password_reset']],
    ['files_status_ck', FILE_STATUSES, ['pending', 'active', 'deleted']],
    ['files_content_type_ck', FILE_CONTENT_TYPES, ['text/html']],
    ['files_charset_ck', FILE_CHARSETS, ['utf-8', 'shift_jis', 'euc-jp', 'iso-2022-jp']],
    ['files_delete_reason_ck', FILE_DELETE_REASONS, ['user', 'folder_deleted', 'expired', 'upload_abandoned', 'verification_failed']],
    ['share_links_revoke_reason_ck', SHARE_LINK_REVOKE_REASONS, ['user', 'reissued', 'file_deleted', 'folder_deleted']],
    ['access_logs_via_ck', ACCESS_VIAS, ['member', 'admin_preview', 'share_link']],
    ['access_logs_purpose_ck', ACCESS_PURPOSES, ['view', 'download']],
    ['access_logs_result_ck', ACCESS_RESULTS, ['granted', 'denied']],
    [
      'access_logs_deny_reason_ck',
      DENY_REASONS,
      [
        'NOT_FOUND', 'LINK_REVOKED', 'NOT_MEMBER', 'USER_DISABLED', 'SUSPENDED', 'FILE_EXPIRED',
        'NOT_STARTED', 'ENDED', 'LINK_EXPIRED', 'DOWNLOAD_NOT_ALLOWED', 'PASSWORD_REQUIRED',
        'PASSWORD_INVALID', 'VIEW_LIMIT_REACHED',
      ],
    ],
    ['audit_logs_target_type_ck', AUDIT_TARGET_TYPES, ['user', 'invite', 'folder', 'member', 'file', 'share_link', 'system']],
    ['audit_logs_result_ck', AUDIT_RESULTS, ['success', 'failure']],
    ['derived: FileDisplayState (07 11.1)', FILE_DISPLAY_STATES, ['public', 'suspended', 'not_started', 'ended', 'expired']],
    ['derived: ShareLinkState (07 11.2)', SHARE_LINK_STATES, ['active', 'expired', 'limit_reached', 'revoked']],
    ['derived: InviteState (07 11.3)', INVITE_STATES, ['open', 'used', 'revoked', 'expired']],
  ] as const)('%s', (_name, actual, expected) => {
    expect([...actual]).toEqual([...expected])
  })

  it('AUDIT_ACTIONS has 31 distinct kinds, each "<group>.<name>"', () => {
    expect(AUDIT_ACTIONS).toHaveLength(31)
    expect(new Set(AUDIT_ACTIONS).size).toBe(31)
    for (const a of AUDIT_ACTIONS) expect(a).toMatch(/^[a-z_]+\.[a-z_]+$/)
  })

  it('PUBLIC_DENY_REASONS is a subset of DENY_REASONS and has the 8 reasons of 07 1.4', () => {
    expect(PUBLIC_DENY_REASONS).toHaveLength(8)
    for (const r of PUBLIC_DENY_REASONS) expect(DENY_REASONS).toContain(r)
  })
})
