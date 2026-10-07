// Expected column lists, copied from docs/05 section 8.1 (103 columns in total).
export const EXPECTED_COLUMNS: Record<string, string[]> = {
  profiles: ['id', 'email', 'display_name', 'role', 'disabled_at', 'session_revoked_at', 'last_login_at', 'created_at', 'updated_at'],
  invites: ['id', 'purpose', 'email', 'role', 'user_id', 'token_hash', 'expires_at', 'used_at', 'revoked_at', 'created_by', 'created_at'],
  folders: ['id', 'name', 'description', 'created_by', 'deleted_at', 'deleted_by', 'created_at', 'updated_at'],
  folder_members: ['folder_id', 'user_id', 'added_by', 'created_at'],
  files: [
    'id', 'folder_id', 'uploaded_by', 'display_name', 'original_filename', 'storage_path', 'content_type', 'charset', 'size_bytes',
    'status', 'suspended', 'view_starts_at', 'view_ends_at', 'expires_at', 'download_allowed', 'upload_expires_at', 'activated_at',
    'deleted_at', 'deleted_by', 'delete_reason', 'purged_at', 'created_at', 'updated_at',
  ],
  share_links: [
    'id', 'file_id', 'token_hash', 'token_hint', 'label', 'expires_at', 'max_views', 'view_count', 'password_hash', 'download_allowed',
    'created_by', 'revoked_at', 'revoked_by', 'revoke_reason', 'replaced_by', 'last_viewed_at', 'created_at', 'updated_at',
  ],
  access_logs: [
    'id', 'occurred_at', 'file_id', 'folder_id', 'via', 'purpose', 'share_link_id', 'user_id', 'result', 'deny_reason', 'ticket_hash',
    'ticket_expires_at', 'delivered_at', 'bytes_sent', 'ip', 'user_agent',
  ],
  audit_logs: ['id', 'occurred_at', 'actor_id', 'action', 'target_type', 'target_id', 'folder_id', 'result', 'metadata', 'ip', 'user_agent'],
  rate_limits: ['key', 'window_start', 'count'],
}

export const EXPECTED_COLUMN_TOTAL = 103
