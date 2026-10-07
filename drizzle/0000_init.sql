-- ============================================================
-- 0000_init.sql  （05 §2.1〜§2.9、§3、§4.1 を連結）
-- 実行ロール: postgres（Session pooler 経由）
-- ============================================================

-- 実行時ロール。パスワードとログイン可否は §4.2 で環境ごとに設定する（ここでは NOLOGIN）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;

-- 長時間のロック待ち・暴走クエリを止める（Transaction pooler 経由でもロール単位で効く）
ALTER ROLE app_runtime SET statement_timeout = '15s';
ALTER ROLE app_runtime SET lock_timeout = '5s';
ALTER ROLE app_runtime SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE app_runtime SET search_path = app, pg_catalog;

CREATE SCHEMA app;

CREATE TABLE app.profiles (
  id                 uuid        NOT NULL,
  email              text        NOT NULL,
  display_name       text        NOT NULL,
  role               text        NOT NULL DEFAULT 'user',
  disabled_at        timestamptz,
  session_revoked_at timestamptz,
  last_login_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE RESTRICT,
  CONSTRAINT profiles_email_key UNIQUE (email),
  CONSTRAINT profiles_email_lower_ck CHECK (email = lower(email)),
  CONSTRAINT profiles_email_len_ck CHECK (char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT profiles_display_name_ck CHECK (char_length(display_name) BETWEEN 1 AND 50 AND display_name = btrim(display_name)),
  CONSTRAINT profiles_role_ck CHECK (role IN ('admin', 'user'))
);

CREATE TABLE app.invites (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  purpose     text        NOT NULL,
  email       text        NOT NULL,
  role        text,
  user_id     uuid,
  token_hash  char(64)    NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  revoked_at  timestamptz,
  created_by  uuid        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invites_pkey PRIMARY KEY (id),
  CONSTRAINT invites_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.profiles (id) ON DELETE RESTRICT,
  CONSTRAINT invites_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.profiles (id) ON DELETE RESTRICT,
  CONSTRAINT invites_token_hash_key UNIQUE (token_hash),
  CONSTRAINT invites_token_hash_ck CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT invites_purpose_ck CHECK (purpose IN ('signup', 'password_reset')),
  CONSTRAINT invites_email_lower_ck CHECK (email = lower(email)),
  CONSTRAINT invites_email_len_ck CHECK (char_length(email) BETWEEN 3 AND 254),
  CONSTRAINT invites_role_ck CHECK (role IS NULL OR role IN ('admin', 'user')),
  CONSTRAINT invites_purpose_fields_ck CHECK (
       (purpose = 'signup'         AND role IS NOT NULL AND user_id IS NULL)
    OR (purpose = 'password_reset' AND role IS NULL     AND user_id IS NOT NULL)),
  CONSTRAINT invites_used_revoked_ck CHECK (used_at IS NULL OR revoked_at IS NULL),
  CONSTRAINT invites_expires_ck CHECK (expires_at > created_at)
);

-- 同じ宛先の「未使用・未取消」は 1 件まで（新規発行時は旧分を取り消してから挿入。02 §4.4）
CREATE UNIQUE INDEX invites_signup_open_email_uq ON app.invites (email)
  WHERE purpose = 'signup' AND used_at IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX invites_reset_open_user_uq ON app.invites (user_id)
  WHERE purpose = 'password_reset' AND used_at IS NULL AND revoked_at IS NULL;
CREATE INDEX invites_created_at_idx ON app.invites (created_at DESC);   -- S10 一覧
CREATE INDEX invites_expires_at_idx ON app.invites (expires_at);        -- 日次の保持期間削除

CREATE TABLE app.folders (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  description text        NOT NULL DEFAULT '',
  created_by  uuid        NOT NULL,
  deleted_at  timestamptz,
  deleted_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT folders_pkey PRIMARY KEY (id),
  CONSTRAINT folders_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.profiles (id) ON DELETE RESTRICT,
  CONSTRAINT folders_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES app.profiles (id) ON DELETE RESTRICT,
  CONSTRAINT folders_name_ck CHECK (char_length(name) BETWEEN 1 AND 100 AND name = btrim(name)),
  CONSTRAINT folders_description_ck CHECK (char_length(description) <= 500),
  CONSTRAINT folders_deleted_ck CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
);

CREATE INDEX folders_created_at_idx ON app.folders (created_at DESC) WHERE deleted_at IS NULL;  -- S04 / S12

CREATE TABLE app.folder_members (
  folder_id  uuid        NOT NULL,
  user_id    uuid        NOT NULL,
  added_by   uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT folder_members_pkey PRIMARY KEY (folder_id, user_id),
  CONSTRAINT folder_members_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES app.folders (id) ON DELETE RESTRICT,
  CONSTRAINT folder_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.profiles (id) ON DELETE RESTRICT,
  CONSTRAINT folder_members_added_by_fkey FOREIGN KEY (added_by) REFERENCES app.profiles (id) ON DELETE RESTRICT
);

CREATE INDEX folder_members_user_id_idx ON app.folder_members (user_id);   -- S04（一般ユーザー）

CREATE TABLE app.files (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  folder_id         uuid        NOT NULL,
  uploaded_by       uuid        NOT NULL,
  display_name      text        NOT NULL,
  original_filename text        NOT NULL,
  storage_path      text        NOT NULL,
  content_type      text        NOT NULL DEFAULT 'text/html',
  charset           text        NOT NULL DEFAULT 'utf-8',
  size_bytes        bigint      NOT NULL,
  status            text        NOT NULL DEFAULT 'pending',
  suspended         boolean     NOT NULL DEFAULT false,
  view_starts_at    timestamptz,
  view_ends_at      timestamptz,
  expires_at        timestamptz,
  download_allowed  boolean     NOT NULL DEFAULT false,
  upload_expires_at timestamptz,
  activated_at      timestamptz,
  deleted_at        timestamptz,
  deleted_by        uuid,
  delete_reason     text,
  purged_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT files_pkey PRIMARY KEY (id),
  CONSTRAINT files_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES app.folders (id) ON DELETE RESTRICT,
  CONSTRAINT files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES app.profiles (id) ON DELETE RESTRICT,
  CONSTRAINT files_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES app.profiles (id) ON DELETE RESTRICT,
  CONSTRAINT files_storage_path_key UNIQUE (storage_path),
  CONSTRAINT files_display_name_ck CHECK (char_length(display_name) BETWEEN 1 AND 200 AND display_name = btrim(display_name)),
  CONSTRAINT files_original_filename_ck CHECK (
    char_length(original_filename) BETWEEN 1 AND 255
    AND position('/' IN original_filename) = 0
    AND position(E'\\' IN original_filename) = 0
    AND original_filename !~ '[[:cntrl:]]'),
  CONSTRAINT files_storage_path_ck CHECK (storage_path = folder_id::text || '/' || id::text || '.html'),
  CONSTRAINT files_content_type_ck CHECK (content_type IN ('text/html')),
  CONSTRAINT files_charset_ck CHECK (charset IN ('utf-8', 'shift_jis', 'euc-jp', 'iso-2022-jp')),
  CONSTRAINT files_size_bytes_ck CHECK (size_bytes > 0),
  CONSTRAINT files_status_ck CHECK (status IN ('pending', 'active', 'deleted')),
  CONSTRAINT files_view_range_ck CHECK (view_starts_at IS NULL OR view_ends_at IS NULL OR view_starts_at < view_ends_at),
  CONSTRAINT files_delete_reason_ck CHECK (delete_reason IS NULL OR delete_reason IN
    ('user', 'folder_deleted', 'expired', 'upload_abandoned', 'verification_failed')),
  CONSTRAINT files_deleted_ck CHECK ((status = 'deleted') = (deleted_at IS NOT NULL AND delete_reason IS NOT NULL)),
  CONSTRAINT files_deleted_by_ck CHECK (deleted_by IS NULL OR status = 'deleted'),
  CONSTRAINT files_pending_ck CHECK (status <> 'pending' OR upload_expires_at IS NOT NULL),
  CONSTRAINT files_active_ck CHECK (status <> 'active' OR (activated_at IS NOT NULL AND upload_expires_at IS NULL)),
  CONSTRAINT files_purged_ck CHECK (purged_at IS NULL OR status = 'deleted')
);

CREATE INDEX files_folder_id_status_idx   ON app.files (folder_id, status);                                   -- フォルダ内一覧
CREATE INDEX files_uploaded_by_quota_idx  ON app.files (uploaded_by) WHERE status IN ('pending', 'active');    -- 容量検査
CREATE INDEX files_upload_expires_at_idx  ON app.files (upload_expires_at) WHERE status = 'pending';           -- 放置 pending の掃除
CREATE INDEX files_expires_at_idx         ON app.files (expires_at) WHERE status = 'active' AND expires_at IS NOT NULL; -- 期限切れ削除
CREATE INDEX files_unpurged_idx           ON app.files (deleted_at) WHERE status = 'deleted' AND purged_at IS NULL;    -- 実体削除の再試行

CREATE TABLE app.share_links (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  file_id          uuid        NOT NULL,
  token_hash       char(64)    NOT NULL,
  token_hint       char(4)     NOT NULL,
  label            text        NOT NULL DEFAULT '',
  expires_at       timestamptz NOT NULL,
  max_views        integer,
  view_count       integer     NOT NULL DEFAULT 0,
  password_hash    text,
  download_allowed boolean     NOT NULL DEFAULT false,
  created_by       uuid        NOT NULL,
  revoked_at       timestamptz,
  revoked_by       uuid,
  revoke_reason    text,
  replaced_by      uuid,
  last_viewed_at   timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT share_links_pkey PRIMARY KEY (id),
  CONSTRAINT share_links_file_id_fkey FOREIGN KEY (file_id) REFERENCES app.files (id) ON DELETE RESTRICT,
  CONSTRAINT share_links_created_by_fkey FOREIGN KEY (created_by) REFERENCES app.profiles (id) ON DELETE RESTRICT,
  CONSTRAINT share_links_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES app.profiles (id) ON DELETE RESTRICT,
  CONSTRAINT share_links_replaced_by_fkey FOREIGN KEY (replaced_by) REFERENCES app.share_links (id) ON DELETE RESTRICT,
  CONSTRAINT share_links_token_hash_key UNIQUE (token_hash),
  CONSTRAINT share_links_token_hash_ck CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT share_links_token_hint_ck CHECK (token_hint ~ '^[A-Za-z0-9_-]{4}$'),
  CONSTRAINT share_links_label_ck CHECK (char_length(label) <= 100 AND label = btrim(label)),
  CONSTRAINT share_links_expires_ck CHECK (expires_at > created_at),
  CONSTRAINT share_links_max_views_ck CHECK (max_views IS NULL OR max_views BETWEEN 1 AND 10000),
  CONSTRAINT share_links_view_count_ck CHECK (view_count >= 0 AND (max_views IS NULL OR view_count <= max_views)),
  CONSTRAINT share_links_password_hash_ck CHECK (password_hash IS NULL OR password_hash LIKE 'scrypt$%'),
  CONSTRAINT share_links_revoke_reason_ck CHECK (revoke_reason IS NULL OR revoke_reason IN
    ('user', 'reissued', 'file_deleted', 'folder_deleted')),
  CONSTRAINT share_links_revoked_ck CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL)),
  CONSTRAINT share_links_revoked_by_ck CHECK (revoked_by IS NULL OR revoked_at IS NOT NULL),
  CONSTRAINT share_links_replaced_by_ck CHECK (replaced_by IS NULL OR revoke_reason = 'reissued')
);

CREATE INDEX share_links_file_id_created_at_idx ON app.share_links (file_id, created_at DESC);  -- S07 一覧

CREATE TABLE app.access_logs (
  id                bigint      GENERATED ALWAYS AS IDENTITY,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  file_id           uuid        NOT NULL,
  folder_id         uuid        NOT NULL,
  via               text        NOT NULL,
  purpose           text        NOT NULL,
  share_link_id     uuid,
  user_id           uuid,
  result            text        NOT NULL,
  deny_reason       text,
  ticket_hash       char(64),
  ticket_expires_at timestamptz,
  delivered_at      timestamptz,
  bytes_sent        bigint,
  ip                inet,
  user_agent        text,
  CONSTRAINT access_logs_pkey PRIMARY KEY (id),
  CONSTRAINT access_logs_file_id_fkey FOREIGN KEY (file_id) REFERENCES app.files (id) ON DELETE RESTRICT,
  CONSTRAINT access_logs_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES app.folders (id) ON DELETE RESTRICT,
  CONSTRAINT access_logs_share_link_id_fkey FOREIGN KEY (share_link_id) REFERENCES app.share_links (id) ON DELETE RESTRICT,
  CONSTRAINT access_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES app.profiles (id) ON DELETE RESTRICT,
  CONSTRAINT access_logs_ticket_hash_key UNIQUE (ticket_hash),
  CONSTRAINT access_logs_via_ck CHECK (via IN ('member', 'admin_preview', 'share_link')),
  CONSTRAINT access_logs_purpose_ck CHECK (purpose IN ('view', 'download')),
  CONSTRAINT access_logs_result_ck CHECK (result IN ('granted', 'denied')),
  CONSTRAINT access_logs_via_link_ck CHECK ((via = 'share_link') = (share_link_id IS NOT NULL)),
  CONSTRAINT access_logs_via_user_ck CHECK ((via = 'share_link') = (user_id IS NULL)),
  CONSTRAINT access_logs_deny_reason_ck CHECK (deny_reason IS NULL OR deny_reason IN (
    'NOT_FOUND', 'LINK_REVOKED', 'NOT_MEMBER', 'USER_DISABLED', 'SUSPENDED', 'FILE_EXPIRED',
    'NOT_STARTED', 'ENDED', 'LINK_EXPIRED', 'DOWNLOAD_NOT_ALLOWED', 'PASSWORD_REQUIRED',
    'PASSWORD_INVALID', 'VIEW_LIMIT_REACHED')),
  CONSTRAINT access_logs_denied_ck CHECK ((result = 'denied') = (deny_reason IS NOT NULL)),
  CONSTRAINT access_logs_ticket_ck CHECK (
    result = 'granted' OR (ticket_hash IS NULL AND ticket_expires_at IS NULL AND delivered_at IS NULL)),
  CONSTRAINT access_logs_granted_ck CHECK (result <> 'granted' OR ticket_expires_at IS NOT NULL),
  CONSTRAINT access_logs_ticket_hash_ck CHECK (ticket_hash IS NULL OR ticket_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT access_logs_delivered_ck CHECK ((delivered_at IS NULL) = (bytes_sent IS NULL)),
  CONSTRAINT access_logs_bytes_sent_ck CHECK (bytes_sent IS NULL OR bytes_sent >= 0),
  CONSTRAINT access_logs_user_agent_ck CHECK (user_agent IS NULL OR char_length(user_agent) <= 256)
);

CREATE INDEX access_logs_file_id_occurred_at_idx       ON app.access_logs (file_id, occurred_at DESC);
CREATE INDEX access_logs_folder_id_occurred_at_idx     ON app.access_logs (folder_id, occurred_at DESC);   -- S05 閲覧ログ
CREATE INDEX access_logs_share_link_id_occurred_at_idx ON app.access_logs (share_link_id, occurred_at DESC);
CREATE INDEX access_logs_occurred_at_idx               ON app.access_logs (occurred_at);                   -- 保持期間削除・24h 集計
CREATE INDEX access_logs_delivered_at_idx              ON app.access_logs (delivered_at) WHERE delivered_at IS NOT NULL; -- 月間配信量
CREATE INDEX access_logs_ticket_expires_at_idx         ON app.access_logs (ticket_expires_at) WHERE ticket_hash IS NOT NULL; -- チケットハッシュの NULL 化

CREATE TABLE app.audit_logs (
  id          bigint      GENERATED ALWAYS AS IDENTITY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid,
  action      text        NOT NULL,
  target_type text,
  target_id   text,
  folder_id   uuid,
  result      text        NOT NULL DEFAULT 'success',
  metadata    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ip          inet,
  user_agent  text,
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES app.profiles (id) ON DELETE RESTRICT,
  CONSTRAINT audit_logs_action_ck CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),
  CONSTRAINT audit_logs_target_type_ck CHECK (target_type IS NULL OR target_type IN
    ('user', 'invite', 'folder', 'member', 'file', 'share_link', 'system')),
  CONSTRAINT audit_logs_target_ck CHECK (target_id IS NULL OR target_type IS NOT NULL),
  CONSTRAINT audit_logs_target_id_ck CHECK (target_id IS NULL OR char_length(target_id) <= 100),
  CONSTRAINT audit_logs_result_ck CHECK (result IN ('success', 'failure')),
  CONSTRAINT audit_logs_metadata_ck CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT audit_logs_user_agent_ck CHECK (user_agent IS NULL OR char_length(user_agent) <= 256)
);

CREATE INDEX audit_logs_occurred_at_idx        ON app.audit_logs (occurred_at DESC);
CREATE INDEX audit_logs_actor_id_occurred_at_idx ON app.audit_logs (actor_id, occurred_at DESC);
CREATE INDEX audit_logs_target_idx             ON app.audit_logs (target_type, target_id);
CREATE INDEX audit_logs_folder_id_occurred_at_idx ON app.audit_logs (folder_id, occurred_at DESC) WHERE folder_id IS NOT NULL;
CREATE INDEX audit_logs_action_occurred_at_idx ON app.audit_logs (action, occurred_at DESC);  -- 最終の日次処理・24h のログイン失敗数

CREATE TABLE app.rate_limits (
  key          text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 1,
  CONSTRAINT rate_limits_pkey PRIMARY KEY (key, window_start),
  CONSTRAINT rate_limits_key_ck CHECK (char_length(key) BETWEEN 1 AND 200),
  CONSTRAINT rate_limits_count_ck CHECK (count >= 1)
);

CREATE INDEX rate_limits_window_start_idx ON app.rate_limits (window_start);   -- 日次の削除

CREATE FUNCTION app.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER profiles_set_updated_at    BEFORE UPDATE ON app.profiles    FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER folders_set_updated_at     BEFORE UPDATE ON app.folders     FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER files_set_updated_at       BEFORE UPDATE ON app.files       FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER share_links_set_updated_at BEFORE UPDATE ON app.share_links FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ---------- RLS: 全テーブル有効。ポリシーは app_runtime 向けのみ ----------
ALTER TABLE app.profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invites        ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.folders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.folder_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.files          ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.share_links    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.access_logs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.rate_limits    ENABLE ROW LEVEL SECURITY;

-- anon / authenticated / service_role 向けのポリシーは作らない（= 全拒否）。
-- app_runtime は BYPASSRLS を持たないため、行の可視性を与えるポリシーを 1 本ずつ作る。
-- 認可はアプリ（src/server/authz）が担う（D-003）。
CREATE POLICY app_runtime_all ON app.profiles       AS PERMISSIVE FOR ALL TO app_runtime USING (true) WITH CHECK (true);
CREATE POLICY app_runtime_all ON app.invites        AS PERMISSIVE FOR ALL TO app_runtime USING (true) WITH CHECK (true);
CREATE POLICY app_runtime_all ON app.folders        AS PERMISSIVE FOR ALL TO app_runtime USING (true) WITH CHECK (true);
CREATE POLICY app_runtime_all ON app.folder_members AS PERMISSIVE FOR ALL TO app_runtime USING (true) WITH CHECK (true);
CREATE POLICY app_runtime_all ON app.files          AS PERMISSIVE FOR ALL TO app_runtime USING (true) WITH CHECK (true);
CREATE POLICY app_runtime_all ON app.share_links    AS PERMISSIVE FOR ALL TO app_runtime USING (true) WITH CHECK (true);
CREATE POLICY app_runtime_all ON app.access_logs    AS PERMISSIVE FOR ALL TO app_runtime USING (true) WITH CHECK (true);
CREATE POLICY app_runtime_all ON app.audit_logs     AS PERMISSIVE FOR ALL TO app_runtime USING (true) WITH CHECK (true);
CREATE POLICY app_runtime_all ON app.rate_limits    AS PERMISSIVE FOR ALL TO app_runtime USING (true) WITH CHECK (true);

-- ---------- 剥奪: Data API 経由のロールと PUBLIC から一切の権限を外す ----------
REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES    IN SCHEMA app FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC, anon, authenticated, service_role;

-- 今後 postgres が app に作るオブジェクトにも既定で権限を付けない
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON TABLES    FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

-- ---------- 付与: app_runtime は DML のみ（DDL・TRUNCATE・REFERENCES・TRIGGER なし） ----------
GRANT USAGE ON SCHEMA app TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO app_runtime;          -- identity 列（access_logs / audit_logs）
GRANT EXECUTE ON FUNCTION app.set_updated_at() TO app_runtime;

ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
