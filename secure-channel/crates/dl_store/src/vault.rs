//! Vault: in-memory key material unlocked by user password.
//!
//! The vault holds the 32-byte database encryption key in memory.
//! When the user locks the app (or auto-lock fires), the vault is locked
//! and the key is zeroized from memory.
//!
//! Auto-lock: configurable inactivity timer. In High-Security mode, the
//! timer is shortened (e.g., 5 minutes vs 30 minutes default).

use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use zeroize::ZeroizeOnDrop;

use dl_crypto::kdf::{vault_key_from_password, generate_salt};
use crate::error::StoreError;

#[derive(ZeroizeOnDrop)]
struct VaultInner {
    key: [u8; 32],
    #[zeroize(skip)]
    last_activity: Instant,
    #[zeroize(skip)]
    auto_lock_secs: u64,
}

/// Thread-safe vault handle.  Clone to share across Tauri commands.
#[derive(Clone)]
pub struct Vault {
    inner: Arc<RwLock<Option<VaultInner>>>,
}

impl Vault {
    pub fn new() -> Self {
        Self { inner: Arc::new(RwLock::new(None)) }
    }

    /// Unlock the vault with the given password and salt.
    /// Call on successful login before any DB read/write.
    pub async fn unlock(&self, password: &[u8], salt: &[u8; 16]) -> Result<(), StoreError> {
        let vault_key = vault_key_from_password(password, salt)?;
        let mut guard = self.inner.write().await;
        *guard = Some(VaultInner {
            key: vault_key.0,
            last_activity: Instant::now(),
            auto_lock_secs: 1800, // 30 minutes default
        });
        Ok(())
    }

    /// Unlock with an existing key (e.g., from hardware unlock or keyring).
    pub async fn unlock_with_key(&self, key: [u8; 32]) -> Result<(), StoreError> {
        let mut guard = self.inner.write().await;
        *guard = Some(VaultInner {
            key,
            last_activity: Instant::now(),
            auto_lock_secs: 1800,
        });
        Ok(())
    }

    /// Lock the vault — zeroizes the key.
    pub async fn lock(&self) {
        let mut guard = self.inner.write().await;
        *guard = None;
    }

    pub async fn is_locked(&self) -> bool {
        let guard = self.inner.read().await;
        match guard.as_ref() {
            Some(inner) => {
                // Check auto-lock
                if inner.auto_lock_secs > 0 {
                    let elapsed = inner.last_activity.elapsed();
                    if elapsed > Duration::from_secs(inner.auto_lock_secs) {
                        drop(guard);
                        self.lock().await;
                        return true;
                    }
                }
                false
            }
            None => true,
        }
    }

    /// Set the auto-lock timeout in seconds. 0 = disable auto-lock.
    pub async fn set_auto_lock_timeout(&self, seconds: u64) {
        let mut guard = self.inner.write().await;
        if let Some(ref mut inner) = *guard {
            inner.auto_lock_secs = seconds;
        }
    }

    /// Record activity (resets the auto-lock timer).
    pub async fn touch(&self) {
        let mut guard = self.inner.write().await;
        if let Some(ref mut inner) = *guard {
            inner.last_activity = Instant::now();
        }
    }

    /// Access the raw key for an encrypt/decrypt operation.
    /// Returns Err if vault is locked or auto-lock has expired.
    /// Automatically touches the activity timer.
    pub async fn with_key<F, R>(&self, f: F) -> Result<R, StoreError>
    where
        F: FnOnce(&[u8; 32]) -> Result<R, StoreError>,
    {
        // Check auto-lock
        if self.is_locked().await {
            return Err(StoreError::VaultLocked);
        }

        let mut guard = self.inner.write().await;
        match guard.as_mut() {
            Some(inner) => {
                inner.last_activity = Instant::now();
                f(&inner.key)
            }
            None => Err(StoreError::VaultLocked),
        }
    }

    /// Get time remaining until auto-lock (seconds).
    pub async fn time_until_lock(&self) -> Option<u64> {
        let guard = self.inner.read().await;
        guard.as_ref().map(|inner| {
            if inner.auto_lock_secs == 0 {
                return u64::MAX; // No auto-lock
            }
            let elapsed = inner.last_activity.elapsed().as_secs();
            inner.auto_lock_secs.saturating_sub(elapsed)
        })
    }
}

impl Default for Vault {
    fn default() -> Self {
        Self::new()
    }
}

/// Generate a fresh salt for a new account.  Store this in the DB (not secret).
pub fn new_vault_salt() -> [u8; 16] {
    generate_salt()
}
