// User-facing text (08 9). The only definition of messageKey -> text. Shared by client and server (no server-only).
import type {
  AccessPurpose, AccessResult, AccessVia, AuditAction, AuditResult, CronStep, DenyReason, FileCharset,
  FileDisplayState, InviteState, ShareLinkState, UserRole,
} from '@/lib/domain'
import { formatDateTime } from '@/lib/format'

export const MESSAGES = {
  'common.validation_failed': '入力内容を確認してください',
  'common.unauthenticated': 'ログインしてください',
  'common.forbidden': 'この操作を行う権限がありません',
  'common.not_found': '対象が見つかりません。画面を再読み込みしてください',
  'common.concurrent_update': 'ほかの操作と同時に実行されました。もう一度お試しください',
  'common.rate_limited': 'しばらく時間をおいてから再度お試しください',
  'common.internal': 'エラーが発生しました（ID: {requestId}）',
  'auth.invalid_credentials': 'メールアドレスまたはパスワードが違います',
  'invite.invalid': 'この URL は無効か、期限が切れています。管理者に再発行を依頼してください',
  'invite.already_registered': 'このメールアドレスは既に登録されています。ログイン画面からログインしてください',
  'invite.email_registered': 'このメールアドレスのユーザーは既に登録されています',
  'invite.already_used': 'この招待は既に使用されているため取り消せません',
  'reset.invalid': 'この URL は無効か、期限が切れています。管理者に再発行を依頼してください',
  'account.current_password_invalid': '現在のパスワードが違います',
  'user.disabled_cannot_reset': '無効化されたユーザーには再設定 URL を発行できません。先に再有効化してください',
  'user.cannot_change_self': '自分自身に対してはこの操作を行えません',
  'user.last_admin': '有効な管理者が 1 人だけのため、この操作は行えません',
  'user.ban_failed': '無効化しましたが、認証サービス側の停止に失敗しました。[再試行] を押してください（このアプリにはログインできない状態です）',
  'user.unban_failed': '再有効化しましたが、認証サービス側の停止解除に失敗しました。[再試行] を押してください（解除されるまでログインできません）',
  'folder.confirm_name_mismatch': 'フォルダ名が一致しません',
  'member.invalid_target': '追加できないユーザーが含まれています。画面を再読み込みしてから選び直してください',
  'upload.bad_extension': '.html または .htm のファイルを選択してください',
  'upload.bad_filename': 'ファイル名に使用できない文字が含まれています',
  'upload.too_large': 'ファイルサイズが上限（{maxMb}MB）を超えています',
  'upload.bad_type': 'HTML ファイルとして選択できませんでした。拡張子が .html / .htm のファイルを選択してください',
  'upload.quota_user': 'あなたが使える容量の上限を超えます。不要なファイルを削除してから再度お試しください',
  'upload.quota_total': '全体の容量の上限を超えます。不要なファイルを削除してから再度お試しください',
  'upload.expired': 'アップロードの有効時間が過ぎました。最初からやり直してください',
  'upload.not_found': 'アップロードしたファイルを確認できませんでした。もう一度アップロードしてください',
  'upload.transfer_failed': 'アップロードに失敗しました。通信状態を確認して、もう一度お試しください',
  'upload.verify_empty': 'ファイルが空です',
  'upload.verify_too_large': 'ファイルサイズが上限（{maxMb}MB）を超えています',
  'upload.verify_not_html': 'HTML ファイルとして認識できませんでした',
  'upload.verify_binary': 'テキスト（HTML）ではないファイルです。UTF-16 で保存されている場合は UTF-8 で保存し直してください',
  'restrict.ends_before_starts': '終了日時は開始日時より後にしてください',
  'restrict.expires_in_past': '有効期限には現在より後の日時を指定してください',
  'link.expires_in_past': '有効期限には現在より後の日時を指定してください',
  'link.expires_too_far': '有効期限は {maxDays} 日以内で指定してください',
  'link.download_not_allowed_by_file': 'ファイル側でダウンロードが許可されていないため、リンクでも許可できません',
  'link.already_revoked': 'このリンクは取り消し済みのため再発行できません。新しく発行してください',
  'link.already_expired': 'このリンクは期限切れのため再発行できません。新しく発行してください',
  'view.not_found': 'このファイルは存在しないか、閲覧できません',
  'share.invalid': 'リンクが無効か、期限が切れています',
  'share.password_required': 'このファイルはパスワードで保護されています。パスワードを入力してください',
  'share.password_invalid': 'パスワードが違います',
  'share.view_limit_reached': '閲覧回数の上限に達しました',
  'access.suspended': '現在、公開が停止されています',
  'access.not_started': '公開開始前です（開始: {startsAt}）',
  'access.ended': '公開期間が終了しました',
  'access.download_not_allowed': 'このファイルはダウンロードできません',
} as const satisfies Record<string, string>

export type MessageKey = keyof typeof MESSAGES
export type MessageParams = Record<string, string | number>

/** Replaces '{name}' with params[name]. Placeholders without a value are left as they are. */
export function message(key: MessageKey, params?: MessageParams): string {
  const template: string = MESSAGES[key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name]
    return v === undefined ? whole : String(v)
  })
}

export interface AccessDeniedMessage {
  code: 'NOT_FOUND' | 'ACCESS_DENIED'
  key: MessageKey
  message: string
}

/**
 * DenyReason -> error code and message key (07 1.4). Reasons that map to NOT_FOUND share the same text and status for the route
 * (an observable difference would reveal existence). Combinations marked "cannot happen" in 07 also fall back to NOT_FOUND.
 * startsAt is the ISO string of file.viewStartsAt (NOT_STARTED only).
 */
export function accessDenied(reason: DenyReason, via: AccessVia, startsAt?: string): AccessDeniedMessage {
  const notFoundKey: MessageKey = via === 'share_link' ? 'share.invalid' : 'view.not_found'
  const denied = (key: MessageKey, params?: MessageParams): AccessDeniedMessage => ({
    code: 'ACCESS_DENIED', key, message: message(key, params),
  })
  switch (reason) {
    case 'SUSPENDED':
      return denied('access.suspended')
    case 'FILE_EXPIRED':
    case 'ENDED':
      return denied('access.ended')
    case 'NOT_STARTED':
      return denied('access.not_started', { startsAt: formatDateTime(startsAt ?? null) })
    case 'DOWNLOAD_NOT_ALLOWED':
      return denied('access.download_not_allowed')
    case 'PASSWORD_REQUIRED':
      return via === 'share_link' ? denied('share.password_required') : { code: 'NOT_FOUND', key: notFoundKey, message: message(notFoundKey) }
    case 'PASSWORD_INVALID':
      return via === 'share_link' ? denied('share.password_invalid') : { code: 'NOT_FOUND', key: notFoundKey, message: message(notFoundKey) }
    case 'VIEW_LIMIT_REACHED':
      return via === 'share_link' ? denied('share.view_limit_reached') : { code: 'NOT_FOUND', key: notFoundKey, message: message(notFoundKey) }
    case 'NOT_FOUND':
    case 'LINK_REVOKED':
    case 'LINK_EXPIRED':
    case 'NOT_MEMBER':
    case 'USER_DISABLED':
      return { code: 'NOT_FOUND', key: notFoundKey, message: message(notFoundKey) }
  }
}

// ---------- display names (08 9.3) ----------
export const USER_ROLE_LABELS: Record<UserRole, string> = { admin: '管理者', user: '一般ユーザー' }
export const ACCESS_VIA_LABELS: Record<AccessVia, string> = { member: 'メンバー', admin_preview: '管理者プレビュー', share_link: '公開リンク' }
export const ACCESS_PURPOSE_LABELS: Record<AccessPurpose, string> = { view: '閲覧', download: 'ダウンロード' }
export const ACCESS_RESULT_LABELS: Record<AccessResult, string> = { granted: '許可', denied: '拒否' }
export const FILE_DISPLAY_STATE_LABELS: Record<FileDisplayState, string> = {
  public: '公開中', suspended: '公開停止', not_started: '公開前', ended: '公開終了', expired: '期限切れ',
}
export const SHARE_LINK_STATE_LABELS: Record<ShareLinkState, string> = {
  active: '有効', limit_reached: '回数上限', expired: '期限切れ', revoked: '取り消し済み',
}
export const INVITE_STATE_LABELS: Record<InviteState, string> = { open: '未使用', used: '使用済み', revoked: '取り消し済み', expired: '期限切れ' }
export const USER_STATUS_LABELS = { enabled: '有効', disabled: '無効' } as const
export const AUDIT_RESULT_LABELS: Record<AuditResult, string> = { success: '成功', failure: '失敗' }
export const FILE_CHARSET_LABELS: Record<FileCharset, string> = {
  'utf-8': 'UTF-8', shift_jis: 'Shift_JIS', 'euc-jp': 'EUC-JP', 'iso-2022-jp': 'ISO-2022-JP',
}
export const DENY_REASON_LABELS: Record<DenyReason, string> = {
  NOT_FOUND: '対象なし', LINK_REVOKED: 'リンク取り消し済み', LINK_EXPIRED: 'リンク期限切れ', NOT_MEMBER: 'メンバー外',
  USER_DISABLED: '無効化ユーザー', SUSPENDED: '公開停止', FILE_EXPIRED: 'ファイル期限切れ', NOT_STARTED: '公開前', ENDED: '公開終了',
  DOWNLOAD_NOT_ALLOWED: 'ダウンロード不可', PASSWORD_REQUIRED: 'パスワード未入力', PASSWORD_INVALID: 'パスワード誤り',
  VIEW_LIMIT_REACHED: '回数上限',
}
export const CRON_STEP_LABELS: Record<CronStep, string> = {
  keepalive: '接続維持', pending_cleanup: '未完了アップロードの掃除', expired_files: '期限切れファイルの削除',
  purge_retry: '実体削除の再試行', ticket_hash_null: '使用済みチケットの消去', retention: '古いログの削除',
  storage_reconcile: 'ストレージ照合', usage_warning: '使用量の警告',
}
/** A missing key is a type error, so an added AuditAction cannot be forgotten. */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  'auth.login': 'ログイン',
  'auth.login_failed': 'ログイン失敗',
  'auth.login_rate_limited': 'ログインの回数制限',
  'auth.logout': 'ログアウト',
  'invite.created': '招待の発行',
  'invite.revoked': '招待の取り消し',
  'invite.accepted': '招待による登録',
  'account.profile_updated': '表示名の変更',
  'account.password_changed': 'パスワードの変更',
  'user.disabled': 'ユーザーの無効化',
  'user.enabled': 'ユーザーの再有効化',
  'user.role_changed': '役割の変更',
  'user.password_reset_issued': '再設定 URL の発行',
  'user.password_reset_completed': 'パスワードの再設定',
  'folder.created': 'フォルダの作成',
  'folder.updated': 'フォルダの変更',
  'folder.deleted': 'フォルダの削除',
  'member.added': 'メンバーの追加',
  'member.removed': 'メンバーの削除',
  'file.uploaded': 'ファイルのアップロード',
  'file.updated': 'ファイル情報の変更',
  'file.restrictions_updated': '閲覧制限の変更',
  'file.deleted': 'ファイルの削除',
  'file.upload_verification_failed': 'アップロードの検証失敗',
  'share_link.created': '公開リンク発行',
  'share_link.revoked': '公開リンクの取り消し',
  'share_link.reissued': '公開リンクの再発行',
  'security.rate_limited': '回数制限',
  'system.cron_daily': '日次処理',
  'system.egress_warning': '配信量の警告',
  'system.storage_warning': 'ストレージ使用量の警告',
}
