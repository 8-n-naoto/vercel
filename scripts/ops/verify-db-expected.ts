// Expected constraint and index names, extracted from docs/05 section 2 (DDL) on 2026-10-08.
// Prefix of a constraint: p = PRIMARY KEY, f = FOREIGN KEY, u = UNIQUE, c = CHECK (pg_constraint.contype).
// Primary key / unique constraints also create an index of the same name (handled in verify-db).
// Update by hand from 05 when a migration adds a constraint or index; do not derive from schema.ts.
export const EXPECTED_DB_OBJECTS: Record<string, { constraints: string[]; indexes: string[] }> = {
  profiles: {
    constraints: ['p:profiles_pkey', 'f:profiles_id_fkey', 'u:profiles_email_key', 'c:profiles_email_lower_ck', 'c:profiles_email_len_ck', 'c:profiles_display_name_ck', 'c:profiles_role_ck'],
    indexes: [],
  },
  invites: {
    constraints: ['p:invites_pkey', 'f:invites_user_id_fkey', 'f:invites_created_by_fkey', 'u:invites_token_hash_key', 'c:invites_token_hash_ck', 'c:invites_purpose_ck', 'c:invites_email_lower_ck', 'c:invites_email_len_ck', 'c:invites_role_ck', 'c:invites_purpose_fields_ck', 'c:invites_used_revoked_ck', 'c:invites_expires_ck'],
    indexes: ['invites_signup_open_email_uq', 'invites_reset_open_user_uq', 'invites_created_at_idx', 'invites_expires_at_idx'],
  },
  folders: {
    constraints: ['p:folders_pkey', 'f:folders_created_by_fkey', 'f:folders_deleted_by_fkey', 'c:folders_name_ck', 'c:folders_description_ck', 'c:folders_deleted_ck'],
    indexes: ['folders_created_at_idx'],
  },
  folder_members: {
    constraints: ['p:folder_members_pkey', 'f:folder_members_folder_id_fkey', 'f:folder_members_user_id_fkey', 'f:folder_members_added_by_fkey'],
    indexes: ['folder_members_user_id_idx'],
  },
  files: {
    constraints: ['p:files_pkey', 'f:files_folder_id_fkey', 'f:files_uploaded_by_fkey', 'f:files_deleted_by_fkey', 'u:files_storage_path_key', 'c:files_display_name_ck', 'c:files_original_filename_ck', 'c:files_storage_path_ck', 'c:files_content_type_ck', 'c:files_charset_ck', 'c:files_size_bytes_ck', 'c:files_status_ck', 'c:files_view_range_ck', 'c:files_delete_reason_ck', 'c:files_deleted_ck', 'c:files_deleted_by_ck', 'c:files_pending_ck', 'c:files_active_ck', 'c:files_purged_ck'],
    indexes: ['files_folder_id_status_idx', 'files_uploaded_by_quota_idx', 'files_upload_expires_at_idx', 'files_expires_at_idx', 'files_unpurged_idx'],
  },
  share_links: {
    constraints: ['p:share_links_pkey', 'f:share_links_file_id_fkey', 'f:share_links_created_by_fkey', 'f:share_links_revoked_by_fkey', 'f:share_links_replaced_by_fkey', 'u:share_links_token_hash_key', 'c:share_links_token_hash_ck', 'c:share_links_token_hint_ck', 'c:share_links_label_ck', 'c:share_links_expires_ck', 'c:share_links_max_views_ck', 'c:share_links_view_count_ck', 'c:share_links_password_hash_ck', 'c:share_links_revoke_reason_ck', 'c:share_links_revoked_ck', 'c:share_links_revoked_by_ck', 'c:share_links_replaced_by_ck'],
    indexes: ['share_links_file_id_created_at_idx'],
  },
  access_logs: {
    constraints: ['p:access_logs_pkey', 'f:access_logs_file_id_fkey', 'f:access_logs_folder_id_fkey', 'f:access_logs_share_link_id_fkey', 'f:access_logs_user_id_fkey', 'u:access_logs_ticket_hash_key', 'c:access_logs_via_ck', 'c:access_logs_purpose_ck', 'c:access_logs_result_ck', 'c:access_logs_via_link_ck', 'c:access_logs_via_user_ck', 'c:access_logs_deny_reason_ck', 'c:access_logs_denied_ck', 'c:access_logs_ticket_ck', 'c:access_logs_granted_ck', 'c:access_logs_ticket_hash_ck', 'c:access_logs_delivered_ck', 'c:access_logs_bytes_sent_ck', 'c:access_logs_user_agent_ck'],
    indexes: ['access_logs_file_id_occurred_at_idx', 'access_logs_folder_id_occurred_at_idx', 'access_logs_share_link_id_occurred_at_idx', 'access_logs_occurred_at_idx', 'access_logs_delivered_at_idx', 'access_logs_ticket_expires_at_idx'],
  },
  audit_logs: {
    constraints: ['p:audit_logs_pkey', 'f:audit_logs_actor_id_fkey', 'c:audit_logs_action_ck', 'c:audit_logs_target_type_ck', 'c:audit_logs_target_ck', 'c:audit_logs_target_id_ck', 'c:audit_logs_result_ck', 'c:audit_logs_metadata_ck', 'c:audit_logs_user_agent_ck'],
    indexes: ['audit_logs_occurred_at_idx', 'audit_logs_actor_id_occurred_at_idx', 'audit_logs_target_idx', 'audit_logs_folder_id_occurred_at_idx', 'audit_logs_action_occurred_at_idx'],
  },
  rate_limits: {
    constraints: ['p:rate_limits_pkey', 'c:rate_limits_key_ck', 'c:rate_limits_count_ck'],
    indexes: ['rate_limits_window_start_idx'],
  },
}
