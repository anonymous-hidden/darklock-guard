//! dl_store — Encrypted local database for Darklock Secure Channel
//!
//! # Encryption strategy
//! SQLite does NOT natively encrypt.  We use application-level encryption:
//! - Sensitive columns (message bodies, key material) are stored as
//!   XChaCha20-Poly1305 ciphertext, base64-encoded.
//! - The vault key is derived from the user password via Argon2id and held
//!   in memory only while the app is unlocked.
//! - Non-sensitive metadata (timestamps, user IDs, delivery state) is stored
//!   in plaintext to allow efficient queries.
//!
//! # Migration
//! SQLx migrations in `migrations/` are run on first open.

pub mod db;
pub mod models;
pub mod migrations;
pub mod vault;
pub mod error;

pub use db::Store;
pub use vault::Vault;
pub use error::StoreError;
