//! Database abstraction over SQLite via sqlx.

use std::path::Path;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool},
    SqlitePool as Pool,
};

use crate::{error::StoreError, vault::Vault};

/// Central store handle.  Cheap to clone (Arc internally).
#[derive(Clone)]
pub struct Store {
    pub pool: Pool,
    pub vault: Vault,
}

impl Store {
    /// Open (or create) the SQLite database at `db_path`.
    /// Runs all pending migrations automatically.
    ///
    /// WAL journal mode and foreign-key enforcement are configured at connection
    /// time here — NOT inside a migration, because SQLite forbids changing
    /// `journal_mode` inside a transaction and sqlx wraps every migration in
    /// one (which produced SQLITE_ERROR code 1 during the first login).
    pub async fn open(db_path: &Path, vault: Vault) -> Result<Self, StoreError> {
        let opts = SqliteConnectOptions::new()
            .filename(db_path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .foreign_keys(true);

        let pool = SqlitePool::connect_with(opts).await?;

        // Run migrations
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .map_err(|e| StoreError::Migration(e.to_string()))?;

        Ok(Self { pool, vault })
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /// Encrypt a plaintext value with the vault key.
    pub async fn encrypt_value(&self, plaintext: &[u8]) -> Result<String, StoreError> {
        self.vault
            .with_key(|key| {
                let ct = dl_crypto::aead::encrypt(key, plaintext, b"dl-store-v1")
                    .map_err(StoreError::Crypto)?;
                Ok(base64::Engine::encode(
                    &base64::engine::general_purpose::URL_SAFE_NO_PAD,
                    &ct,
                ))
            })
            .await
    }

    /// Decrypt a vault-encrypted value.
    pub async fn decrypt_value(&self, b64: &str) -> Result<Vec<u8>, StoreError> {
        let ct = base64::Engine::decode(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
            b64,
        )
        .map_err(|e| StoreError::Crypto(dl_crypto::CryptoError::Base64Decode(e)))?;

        self.vault
            .with_key(|key| {
                let pt = dl_crypto::aead::decrypt(key, &ct, b"dl-store-v1")
                    .map_err(StoreError::Crypto)?;
                Ok(pt.to_vec())
            })
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::Store;
    use crate::vault::Vault;
    use std::path::PathBuf;
    use uuid::Uuid;

    #[tokio::test]
    async fn migrations_allow_multiple_sessions_per_peer() {
        let db_path = PathBuf::from(format!("/tmp/dl-store-test-{}.db", Uuid::new_v4()));
        let store = Store::open(&db_path, Vault::new()).await.expect("open store");

        // Same local/peer pair with two distinct session IDs must be valid.
        sqlx::query(
            "INSERT INTO sessions (id, local_user_id, peer_user_id, session_state_enc, chain_head, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))"
        )
        .bind("sid-1")
        .bind("alice")
        .bind("bob")
        .bind("enc-1")
        .bind("00")
        .execute(&store.pool)
        .await
        .expect("insert first session");

        sqlx::query(
            "INSERT INTO sessions (id, local_user_id, peer_user_id, session_state_enc, chain_head, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))"
        )
        .bind("sid-2")
        .bind("alice")
        .bind("bob")
        .bind("enc-2")
        .bind("11")
        .execute(&store.pool)
        .await
        .expect("insert second session");

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sessions WHERE local_user_id = ? AND peer_user_id = ?"
        )
        .bind("alice")
        .bind("bob")
        .fetch_one(&store.pool)
        .await
        .expect("count sessions");

        assert_eq!(count, 2);

        let _ = std::fs::remove_file(&db_path);
        let _ = std::fs::remove_file(db_path.with_extension("db-wal"));
        let _ = std::fs::remove_file(db_path.with_extension("db-shm"));
    }
}
