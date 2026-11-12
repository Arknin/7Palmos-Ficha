-- 002: contas completas, conteúdo global versionado, inventário e tabelas de proteção
-- Somente ADICIONA estruturas. Não altera nem apaga dados existentes
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_lc TEXT;
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'player';
ALTER TABLE users ADD COLUMN avatar TEXT;
ALTER TABLE users ADD COLUMN avatar_v INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN updated_at BIGINT NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lc ON users(email_lc);
ALTER TABLE sessions ADD COLUMN created_at BIGINT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS password_resets(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at BIGINT NOT NULL, used_at BIGINT);
CREATE TABLE IF NOT EXISTS content_blobs(hash TEXT PRIMARY KEY, data TEXT NOT NULL, created_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS paths(id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','hidden','deleted')), rev BIGINT NOT NULL DEFAULT 1, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS potions(id TEXT PRIMARY KEY, path_id TEXT NOT NULL REFERENCES paths(id), layer INTEGER NOT NULL CHECK(layer BETWEEN 0 AND 9), name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '', data TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','hidden','deleted')), rev BIGINT NOT NULL DEFAULT 1, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, created_by TEXT REFERENCES users(id), updated_by TEXT REFERENCES users(id));
CREATE UNIQUE INDEX IF NOT EXISTS potions_path_layer ON potions(path_id, layer) WHERE status <> 'deleted';
CREATE TABLE IF NOT EXISTS content_versions(id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, version INTEGER NOT NULL, action TEXT NOT NULL, snapshot TEXT NOT NULL, actor_id TEXT REFERENCES users(id), note TEXT NOT NULL DEFAULT '', created_at BIGINT NOT NULL, UNIQUE(entity_type, entity_id, version));
CREATE TABLE IF NOT EXISTS game_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, rev BIGINT NOT NULL DEFAULT 1, updated_at BIGINT NOT NULL, updated_by TEXT REFERENCES users(id));
CREATE TABLE IF NOT EXISTS content_backups(id TEXT PRIMARY KEY, reason TEXT NOT NULL, actor_id TEXT REFERENCES users(id), data TEXT NOT NULL, created_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_log(id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, detail TEXT NOT NULL, created_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS inventory(sheet_id TEXT NOT NULL REFERENCES sheets(id) ON DELETE CASCADE, potion_id TEXT NOT NULL REFERENCES potions(id), quantity INTEGER NOT NULL CHECK(quantity >= 0), updated_at BIGINT NOT NULL, PRIMARY KEY(sheet_id, potion_id));
CREATE INDEX IF NOT EXISTS potions_path ON potions(path_id);
CREATE INDEX IF NOT EXISTS versions_entity ON content_versions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS inventory_potion ON inventory(potion_id);
