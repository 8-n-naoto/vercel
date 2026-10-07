import { describe, expect, it } from 'vitest'
import { AUDIT_ACTIONS, CRON_STEPS, DENY_REASONS, type AccessVia, type DenyReason } from '@/lib/domain'
import {
  ACCESS_PURPOSE_LABELS, ACCESS_RESULT_LABELS, ACCESS_VIA_LABELS, AUDIT_ACTION_LABELS, AUDIT_RESULT_LABELS, CRON_STEP_LABELS,
  DENY_REASON_LABELS, FILE_CHARSET_LABELS, FILE_DISPLAY_STATE_LABELS, INVITE_STATE_LABELS, MESSAGES, SHARE_LINK_STATE_LABELS,
  USER_ROLE_LABELS, accessDenied, message, type MessageKey,
} from '@/lib/messages'

// All messageKey rows of 08 9.1 (50 keys). Copied from the table so that a drift in either direction fails the test.
const KEYS_08 = [
  'common.validation_failed', 'common.unauthenticated', 'common.forbidden', 'common.not_found', 'common.concurrent_update',
  'common.rate_limited', 'common.internal', 'auth.invalid_credentials', 'invite.invalid', 'invite.already_registered',
  'invite.email_registered', 'invite.already_used', 'reset.invalid', 'account.current_password_invalid', 'user.disabled_cannot_reset',
  'user.cannot_change_self', 'user.last_admin', 'user.ban_failed', 'user.unban_failed', 'folder.confirm_name_mismatch',
  'member.invalid_target', 'upload.bad_extension', 'upload.bad_filename', 'upload.too_large', 'upload.bad_type', 'upload.quota_user',
  'upload.quota_total', 'upload.expired', 'upload.not_found', 'upload.transfer_failed', 'upload.verify_empty', 'upload.verify_too_large',
  'upload.verify_not_html', 'upload.verify_binary', 'restrict.ends_before_starts', 'restrict.expires_in_past', 'link.expires_in_past',
  'link.expires_too_far', 'link.download_not_allowed_by_file', 'link.already_revoked', 'link.already_expired', 'view.not_found',
  'share.invalid', 'share.password_required', 'share.password_invalid', 'share.view_limit_reached', 'access.suspended',
  'access.not_started', 'access.ended', 'access.download_not_allowed',
]

// messageKeys that appear in 06 (grep of the Action sections; audit action names and structured-log names are not messageKeys).
const KEYS_06 = [
  'account.current_password_invalid', 'auth.invalid_credentials', 'common.concurrent_update', 'common.not_found', 'common.rate_limited',
  'folder.confirm_name_mismatch', 'invite.already_registered', 'invite.already_used', 'invite.email_registered', 'invite.invalid',
  'link.already_expired', 'link.already_revoked', 'link.download_not_allowed_by_file', 'link.expires_in_past', 'link.expires_too_far',
  'member.invalid_target', 'reset.invalid', 'restrict.ends_before_starts', 'restrict.expires_in_past', 'share.invalid',
  'upload.bad_extension', 'upload.bad_filename', 'upload.bad_type', 'upload.expired', 'upload.not_found', 'upload.quota_total',
  'upload.quota_user', 'upload.too_large', 'upload.verify_binary', 'upload.verify_empty', 'upload.verify_not_html',
  'upload.verify_too_large', 'user.ban_failed', 'user.cannot_change_self', 'user.disabled_cannot_reset', 'user.last_admin',
  'view.not_found',
]

describe('MESSAGES (08 9.1)', () => {
  it('has exactly the 08 9.1 keys (difference 0)', () => {
    expect(Object.keys(MESSAGES).sort()).toEqual([...KEYS_08].sort())
    expect(KEYS_08).toHaveLength(50)
  })

  it('has every messageKey that 06 uses', () => {
    for (const k of KEYS_06) expect(Object.keys(MESSAGES), k).toContain(k)
  })

  it('substitutes parameters and leaves no placeholder behind', () => {
    expect(message('upload.too_large', { maxMb: 50 })).toBe('ファイルサイズが上限（50MB）を超えています')
    expect(message('link.expires_too_far', { maxDays: 90 })).toBe('有効期限は 90 日以内で指定してください')
    expect(message('common.internal', { requestId: 'abc-123' })).toBe('エラーが発生しました（ID: abc-123）')
    expect(message('access.not_started', { startsAt: '2026/10/10 10:00' })).not.toContain('{')
  })

  it('keeps placeholders that have no value, and plain texts unchanged', () => {
    expect(message('upload.too_large')).toContain('{maxMb}')
    expect(message('common.forbidden')).toBe('この操作を行う権限がありません')
  })
})

describe('accessDenied (07 1.4 AM-01..AM-08)', () => {
  it.each([
    ['AM-01', 'NOT_MEMBER', 'member', undefined, 'NOT_FOUND', 'view.not_found'],
    ['AM-02', 'LINK_EXPIRED', 'share_link', undefined, 'NOT_FOUND', 'share.invalid'],
    ['AM-03', 'LINK_REVOKED', 'share_link', undefined, 'NOT_FOUND', 'share.invalid'],
    ['AM-04', 'NOT_FOUND', 'member', undefined, 'NOT_FOUND', 'view.not_found'],
    ['AM-05', 'NOT_STARTED', 'share_link', '2026-10-10T01:00:00Z', 'ACCESS_DENIED', 'access.not_started'],
    ['AM-06', 'PASSWORD_INVALID', 'share_link', undefined, 'ACCESS_DENIED', 'share.password_invalid'],
    ['AM-07', 'ENDED', 'member', undefined, 'ACCESS_DENIED', 'access.ended'],
    ['AM-08', 'FILE_EXPIRED', 'share_link', undefined, 'ACCESS_DENIED', 'access.ended'],
  ] as const)('%s', (_id, reason, via, startsAt, code, key) => {
    const r = accessDenied(reason, via, startsAt)
    expect(r.code).toBe(code)
    expect(r.key).toBe(key)
    expect(r.message).toBe(message(key, key === 'access.not_started' ? { startsAt: '2026/10/10 10:00' } : undefined))
  })

  it('AM-05 shows the start time in Japan time', () => {
    expect(accessDenied('NOT_STARTED', 'share_link', '2026-10-10T01:00:00Z').message).toContain('2026/10/10 10:00')
  })

  it('every reason resolves to a message without placeholders for every route', () => {
    for (const reason of DENY_REASONS) {
      for (const via of ['member', 'admin_preview', 'share_link'] as AccessVia[]) {
        const r = accessDenied(reason as DenyReason, via, '2026-10-10T01:00:00Z')
        expect(r.message, `${reason}/${via}`).not.toMatch(/\{/)
        expect(MESSAGES[r.key as MessageKey]).toBeDefined()
      }
    }
  })

  it('NOT_FOUND groups share one text per route (no observable difference)', () => {
    for (const via of ['member', 'share_link'] as AccessVia[]) {
      const texts = new Set(['NOT_FOUND', 'LINK_REVOKED', 'LINK_EXPIRED', 'NOT_MEMBER', 'USER_DISABLED'].map((r) => accessDenied(r as DenyReason, via).message))
      expect(texts.size).toBe(1)
    }
  })

  it('combinations that cannot happen fall back to NOT_FOUND', () => {
    expect(accessDenied('PASSWORD_REQUIRED', 'member').code).toBe('NOT_FOUND')
    expect(accessDenied('VIEW_LIMIT_REACHED', 'admin_preview').key).toBe('view.not_found')
  })
})

describe('display names (08 9.3)', () => {
  it('cover every enumeration value', () => {
    expect(Object.keys(AUDIT_ACTION_LABELS).sort()).toEqual([...AUDIT_ACTIONS].sort())
    expect(AUDIT_ACTIONS).toHaveLength(31)
    expect(Object.keys(DENY_REASON_LABELS).sort()).toEqual([...DENY_REASONS].sort())
    expect(Object.keys(CRON_STEP_LABELS).sort()).toEqual([...CRON_STEPS].sort())
  })

  it('spot checks', () => {
    expect(USER_ROLE_LABELS.admin).toBe('管理者')
    expect(ACCESS_VIA_LABELS.admin_preview).toBe('管理者プレビュー')
    expect(ACCESS_PURPOSE_LABELS.download).toBe('ダウンロード')
    expect(ACCESS_RESULT_LABELS.denied).toBe('拒否')
    expect(FILE_DISPLAY_STATE_LABELS.not_started).toBe('公開前')
    expect(SHARE_LINK_STATE_LABELS.limit_reached).toBe('回数上限')
    expect(INVITE_STATE_LABELS.open).toBe('未使用')
    expect(AUDIT_RESULT_LABELS.failure).toBe('失敗')
    expect(FILE_CHARSET_LABELS.shift_jis).toBe('Shift_JIS')
  })
})

describe('FILE_TEXT / deleteFileConfirmText (08 9.4 S06 / S07 / C-01)', () => {
  it('matches the fixed texts', async () => {
    const { FILE_TEXT, deleteFileConfirmText } = await import('@/lib/messages')
    expect(FILE_TEXT.dropZoneHint(50)).toBe('ここに HTML ファイルをドロップ、または [ファイルを選択]／.html / .htm、1 ファイル 50MB まで')
    expect(FILE_TEXT.quota({ userUsed: '1MB', userLimit: '100MB', totalUsed: '2MB', totalLimit: '200MB' })).toBe('残り容量: あなた 1MB / 100MB、全体 2MB / 200MB')
    expect(FILE_TEXT.multipleDropped).toBe('1 回に 1 ファイルだけアップロードできます')
    expect(FILE_TEXT.uploadCancelled).toBe('アップロードを取り消しました')
    expect(FILE_TEXT.uploaded).toBe('アップロードしました。閲覧制限と公開リンクを確認してください')
    expect(deleteFileConfirmText('仕様書')).toBe('「仕様書」を削除します。このファイルの公開リンクもすべて使えなくなります。元に戻せません。')
  })
})
