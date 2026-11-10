-- 001: esquema base (contas, sessões, campanhas, participantes, fichas)
-- Idempotente: bancos criados pela versão anterior continuam intactos
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT NOT NULL, username_lc TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS campaigns(id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id), join_code TEXT NOT NULL UNIQUE, allow_layers INTEGER NOT NULL DEFAULT 0, potions TEXT NOT NULL, rev BIGINT NOT NULL DEFAULT 1, created_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS members(campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('master','player')), joined_at BIGINT NOT NULL, PRIMARY KEY(campaign_id,user_id));
CREATE TABLE IF NOT EXISTS sheets(id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE, owner_id TEXT NOT NULL REFERENCES users(id), data TEXT NOT NULL, rev BIGINT NOT NULL DEFAULT 1, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS sheets_campaign ON sheets(campaign_id);
CREATE INDEX IF NOT EXISTS members_user ON members(user_id);
