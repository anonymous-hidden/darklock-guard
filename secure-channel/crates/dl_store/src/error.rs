use thiserror::Error;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Vault is locked — unlock with password first")]
    VaultLocked,

    #[error("Crypto error: {0}")]
    Crypto(#[from] dl_crypto::CryptoError),

    #[error("Serialisation error: {0}")]
    Serialisation(#[from] serde_json::Error),

    #[error("Record not found: {0}")]
    NotFound(String),

    #[error("Identity key conflict for user {user_id}: stored={stored} new={new}")]
    IdentityKeyConflict { user_id: String, stored: String, new: String },

    #[error("Migration error: {0}")]
    Migration(String),
}
