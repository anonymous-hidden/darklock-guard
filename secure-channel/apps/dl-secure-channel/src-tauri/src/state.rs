//! Shared Tauri application state.
use std::sync::Arc;
use tokio::sync::Mutex;

use dl_store::{vault::Vault, db::Store};

#[derive(Clone)]
pub struct AppState {
    pub vault: Vault,
    /// None until user logs in and vault is opened.
    pub store: Arc<Mutex<Option<Store>>>,
    pub api_base_url: String,
    pub rly_base_url: String,
    /// Short-lived JWT access token (15-min TTL).
    pub access_token: Arc<Mutex<Option<String>>>,
    /// Long-lived refresh token for obtaining new access tokens.
    pub refresh_token: Arc<Mutex<Option<String>>>,
    /// System role for the currently logged-in user (e.g. "owner", "admin").
    pub system_role: Arc<Mutex<Option<String>>>,
}

impl AppState {
    pub async fn get_token(&self) -> Option<String> {
        self.access_token.lock().await.clone()
    }

    pub async fn set_token(&self, token: Option<String>) {
        *self.access_token.lock().await = token;
    }

    pub async fn get_refresh_token(&self) -> Option<String> {
        self.refresh_token.lock().await.clone()
    }

    pub async fn set_refresh_token(&self, token: Option<String>) {
        *self.refresh_token.lock().await = token;
    }

    pub async fn get_system_role(&self) -> Option<String> {
        self.system_role.lock().await.clone()
    }

    pub async fn set_system_role(&self, role: Option<String>) {
        *self.system_role.lock().await = role;
    }

    pub async fn get_store(&self) -> Option<Store> {
        self.store.lock().await.clone()
    }
}
