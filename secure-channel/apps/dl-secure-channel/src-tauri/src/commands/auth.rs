//! Tauri commands for authentication and device enrollment.

use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::{State, Manager};
use tracing::{info, warn, error};

use dl_crypto::identity::{IdentityKeyPair, DeviceCert, DeviceCapabilities};
use dl_crypto::x3dh;
use dl_proto::api::*;
use dl_store::{db::Store, vault::new_vault_salt};
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthResult {
    pub user_id: String,
    pub username: String,
    pub key_change_detected: bool,
    pub system_role: Option<String>,
}

/// Register a new account on the IDS server and initialise local vault.
#[tauri::command]
pub async fn cmd_register(
    username: String,
    email: String,
    password: String,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<AuthResult, String> {
    info!("[auth] cmd_register: user={} email={} api={}", username, email, state.api_base_url);
    // Generate identity key
    let identity = IdentityKeyPair::generate().map_err(|e| e.to_string())?;
    let identity_pub_b64 = base64::Engine::encode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        &identity.public.0,
    );

    // Register on IDS
    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .build()
        .map_err(|e| e.to_string())?;

    let http_res = client
        .post(format!("{}/register", state.api_base_url))
        .json(&RegisterRequest {
            username: username.clone(),
            email: email.clone(),
            password: password.clone(),
            identity_pubkey: identity_pub_b64.clone(),
        })
        .send()
        .await
        .map_err(|e| { error!("[auth] cmd_register: HTTP error: {}", e); e.to_string() })?;

    if !http_res.status().is_success() {
        let status = http_res.status();
        let body: serde_json::Value = http_res.json().await.unwrap_or_default();
        let msg = body.get("error").and_then(|v| v.as_str()).unwrap_or("Registration failed");
        warn!("[auth] cmd_register: IDS returned {} — {}", status, msg);
        return Err(msg.to_string());
    }

    let res: RegisterResponse = http_res.json().await.map_err(|e| e.to_string())?;
    info!("[auth] cmd_register: IDS OK user_id={}", res.user_id);

    state.set_token(Some(res.access_token.clone())).await;
    state.set_refresh_token(Some(res.refresh_token.clone())).await;

    // Initialise local vault
    let vault_salt = new_vault_salt();
    state.vault.unlock(password.as_bytes(), &vault_salt).await.map_err(|e| e.to_string())?;

    // Open (create) local store
    let db_path = get_db_path(&app_handle, &res.user_id);
    let store = Store::open(&db_path, state.vault.clone()).await.map_err(|e| e.to_string())?;

    // Encrypt and store identity secret
    let identity_secret_enc = store
        .encrypt_value(identity.secret_bytes())
        .await
        .map_err(|e| e.to_string())?;

    // Generate DH key for X3DH
    use dl_crypto::identity::DeviceKeyPair;
    let dh_key = DeviceKeyPair::generate().map_err(|e| e.to_string())?;
    let dh_secret_enc = store
        .encrypt_value(dh_key.secret_bytes())
        .await
        .map_err(|e| e.to_string())?;

    // Insert account row
    let account_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO accounts (id, user_id, username, email, identity_pubkey, identity_secret_enc, dh_secret_enc, vault_salt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&account_id).bind(&res.user_id).bind(&username).bind(&email)
    .bind(&identity_pub_b64).bind(&identity_secret_enc).bind(&dh_secret_enc)
    .bind(hex::encode(vault_salt))
    .execute(&store.pool)
    .await
    .map_err(|e| e.to_string())?;

    // Enroll device
    let device_id = uuid::Uuid::new_v4().to_string();
    let device_key = DeviceKeyPair::generate().map_err(|e| e.to_string())?;
    let cert = DeviceCert::issue(&identity, &device_key.public, &device_id, &res.user_id, 365, DeviceCapabilities::primary())
        .map_err(|e| e.to_string())?;

    // Generate signed prekey using proper X3DH helper
    let (spk_secret, spk_pub, spk_sig_bytes) = x3dh::generate_signed_prekey(&identity)
        .map_err(|e| e.to_string())?;
    let spk_pub_b64 = base64::Engine::encode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        spk_pub.as_bytes(),
    );
    let spk_sig_b64 = base64::Engine::encode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        &spk_sig_bytes,
    );
    let spk_secret_enc = store.encrypt_value(&spk_secret.to_bytes())
        .await.map_err(|e| e.to_string())?;
    // Persist SPK secret now that it is available
    sqlx::query("UPDATE accounts SET spk_secret_enc = ? WHERE user_id = ?")
        .bind(&spk_secret_enc).bind(&res.user_id)
        .execute(&store.pool).await.map_err(|e| e.to_string())?;

    // Generate a batch of one-time prekeys
    let opk_batch = x3dh::generate_one_time_prekeys(20);
    let opk_pub_b64s: Vec<String> = opk_batch.iter().map(|(_, pub_key)| {
        base64::Engine::encode(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
            pub_key.as_bytes(),
        )
    }).collect();

    let device_pub_b64 = base64::Engine::encode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        &device_key.public.0,
    );
    let dh_pub_b64 = base64::Engine::encode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        &dh_key.public.0,
    );

    let _enroll_res: DeviceEnrollResponse = client
        .post(format!("{}/devices/enroll", state.api_base_url))
        .bearer_auth(&res.access_token)
        .json(&DeviceEnrollRequest {
            device_id: device_id.clone(),
            device_name: hostname_or_default(),
            platform: std::env::consts::OS.to_string(),
            device_pubkey: device_pub_b64.clone(),
            device_cert: serde_json::to_value(&cert).map_err(|e| e.to_string())?,
            dh_pubkey: dh_pub_b64,
            spk_pubkey: spk_pub_b64,
            spk_sig: spk_sig_b64,
            one_time_prekeys: opk_pub_b64s,
        })
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    // Store device row
    let device_row_id = uuid::Uuid::new_v4().to_string();
    let cert_json = serde_json::to_string(&cert).map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO devices (id, user_id, device_id, device_name, platform, device_pubkey, device_cert, is_current_device) VALUES (?, ?, ?, ?, ?, ?, ?, 1)"
    )
    .bind(&device_row_id).bind(&res.user_id).bind(&device_id)
    .bind(hostname_or_default()).bind(std::env::consts::OS)
    .bind(&device_pub_b64).bind(&cert_json)
    .execute(&store.pool)
    .await
    .map_err(|e| e.to_string())?;

    *state.store.lock().await = Some(store);

    Ok(AuthResult {
        user_id: res.user_id,
        username,
        key_change_detected: false,
        system_role: None,
    })
}

/// Login to existing account.
#[tauri::command]
pub async fn cmd_login(
    username_or_email: String,
    password: String,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<AuthResult, String> {
    info!("[auth] cmd_login: user={} api={}", username_or_email, state.api_base_url);
    let client = reqwest::Client::builder()
        .use_rustls_tls()
        .build()
        .map_err(|e| e.to_string())?;

    let http_res = client
        .post(format!("{}/login", state.api_base_url))
        .json(&LoginRequest { username_or_email, password: password.clone() })
        .send()
        .await
        .map_err(|e| { error!("[auth] cmd_login: HTTP error: {}", e); e.to_string() })?;

    if !http_res.status().is_success() {
        let status = http_res.status();
        let body: serde_json::Value = http_res.json().await.unwrap_or_default();
        let msg = body.get("error").and_then(|v| v.as_str()).unwrap_or("Login failed");
        warn!("[auth] cmd_login: IDS returned {} — {}", status, msg);
        return Err(msg.to_string());
    }

    let res: LoginResponse = http_res.json().await.map_err(|e| e.to_string())?;
    info!("[auth] cmd_login: IDS OK user_id={}", res.user_id);

    state.set_token(Some(res.access_token.clone())).await;
    state.set_refresh_token(Some(res.refresh_token.clone())).await;

    // Find or create local DB
    let db_path = get_db_path(&app_handle, &res.user_id);

    // NOTE: SQLite WAL mode normally leaves .db-wal and .db-shm files alongside
    // the main DB — this is expected and correct.  Deleting them on every login
    // caused is_new_device=true which regenerated identity/SPK keys each time,
    // breaking all pending envelopes.  Only remove corrupt leftovers when the
    // main DB file itself is missing (which wouldn't happen in normal use).
    // If the DB is genuinely corrupt, Store::open will return an error.
    let wal_path = db_path.with_extension("db-wal");
    let shm_path = db_path.with_extension("db-shm");
    if !db_path.exists() {
        // DB missing but WAL/SHM stale from a previous run — clean them up.
        let _ = std::fs::remove_file(&wal_path);
        let _ = std::fs::remove_file(&shm_path);
    }

    // Open with an empty (unauthenticated) vault first so we can read the salt.
    use dl_store::vault::Vault;
    let empty_vault = Vault::new();
    let bootstrap_store = Store::open(&db_path, empty_vault)
        .await
        .map_err(|e| e.to_string())?;

    let salt_hex: Option<(String,)> = sqlx::query_as(
        "SELECT vault_salt FROM accounts WHERE user_id = ? LIMIT 1"
    )
    .bind(&res.user_id)
    .fetch_optional(&bootstrap_store.pool)
    .await
    .map_err(|e| e.to_string())?;

    let (salt, is_new_device) = if let Some((hex,)) = salt_hex {
        let bytes = hex::decode(&hex).map_err(|e| e.to_string())?;
        let arr: [u8; 16] = bytes.try_into().map_err(|_| "Bad salt length".to_string())?;
        (arr, false)
    } else {
        // No local account row — first login on this device (or DB was wiped).
        (new_vault_salt(), true)
    };

    state.vault.unlock(password.as_bytes(), &salt).await.map_err(|e| e.to_string())?;
    let store = Store::open(&db_path, state.vault.clone()).await.map_err(|e| e.to_string())?;

    // ── First-time device setup ───────────────────────────────────────────────
    // When the local DB has no account row (fresh install or wiped DB), generate
    // new device keys and enroll this device with the IDS server.
    if is_new_device {
        use dl_crypto::identity::DeviceKeyPair;

        let identity = IdentityKeyPair::generate().map_err(|e| e.to_string())?;
        let identity_pub_b64 = base64::Engine::encode(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
            &identity.public.0,
        );

        let identity_secret_enc = store
            .encrypt_value(identity.secret_bytes())
            .await
            .map_err(|e| e.to_string())?;

        let dh_key = DeviceKeyPair::generate().map_err(|e| e.to_string())?;
        let dh_secret_enc = store
            .encrypt_value(dh_key.secret_bytes())
            .await
            .map_err(|e| e.to_string())?;

        let account_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO accounts (id, user_id, username, email, identity_pubkey, identity_secret_enc, dh_secret_enc, vault_salt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&account_id).bind(&res.user_id).bind(&res.username)
        .bind("") // email — not returned by IDS login endpoint
        .bind(&identity_pub_b64).bind(&identity_secret_enc).bind(&dh_secret_enc)
        .bind(hex::encode(salt))
        .execute(&store.pool)
        .await
        .map_err(|e| e.to_string())?;

        // Generate and enroll device keys
        let device_id = uuid::Uuid::new_v4().to_string();
        let device_key = DeviceKeyPair::generate().map_err(|e| e.to_string())?;
        let cert = DeviceCert::issue(
            &identity, &device_key.public, &device_id, &res.user_id, 365,
            DeviceCapabilities::primary(),
        ).map_err(|e| e.to_string())?;

        let (spk_secret_nd, spk_pub, spk_sig_bytes) = x3dh::generate_signed_prekey(&identity)
            .map_err(|e| e.to_string())?;
        let spk_pub_b64 = base64::Engine::encode(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
            spk_pub.as_bytes(),
        );
        let spk_sig_b64 = base64::Engine::encode(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
            &spk_sig_bytes,
        );
        // Persist SPK secret so Bob's X3DH respond path can decrypt incoming messages.
        let spk_secret_enc_nd = store.encrypt_value(&spk_secret_nd.to_bytes())
            .await.map_err(|e| e.to_string())?;

        let opk_batch = x3dh::generate_one_time_prekeys(20);
        let opk_pub_b64s: Vec<String> = opk_batch.iter().map(|(_, pub_key)| {
            base64::Engine::encode(
                &base64::engine::general_purpose::URL_SAFE_NO_PAD,
                pub_key.as_bytes(),
            )
        }).collect();

        let device_pub_b64 = base64::Engine::encode(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
            &device_key.public.0,
        );
        let dh_pub_b64 = base64::Engine::encode(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
            &dh_key.public.0,
        );

        // Enroll with IDS (best-effort — don't fail login if server rejects)
        let _ = async {
            client
                .post(format!("{}/devices/enroll", state.api_base_url))
                .bearer_auth(&res.access_token)
                .json(&DeviceEnrollRequest {
                    device_id: device_id.clone(),
                    device_name: hostname_or_default(),
                    platform: std::env::consts::OS.to_string(),
                    device_pubkey: device_pub_b64.clone(),
                    device_cert: serde_json::to_value(&cert).unwrap_or_default(),
                    dh_pubkey: dh_pub_b64,
                    spk_pubkey: spk_pub_b64,
                    spk_sig: spk_sig_b64,
                    one_time_prekeys: opk_pub_b64s,
                })
                .send()
                .await?
                .json::<DeviceEnrollResponse>()
                .await
        }.await;

        let device_row_id = uuid::Uuid::new_v4().to_string();
        let cert_json = serde_json::to_string(&cert).map_err(|e| e.to_string())?;
        sqlx::query(
            "INSERT INTO devices (id, user_id, device_id, device_name, platform, device_pubkey, device_cert, is_current_device) VALUES (?, ?, ?, ?, ?, ?, ?, 1)"
        )
        .bind(&device_row_id).bind(&res.user_id).bind(&device_id)
        .bind(hostname_or_default()).bind(std::env::consts::OS)
        .bind(&device_pub_b64).bind(&cert_json)
        .execute(&store.pool)
        .await
        .map_err(|e| e.to_string())?;

        // Save SPK secret so this device can respond to X3DH from senders.
        sqlx::query("UPDATE accounts SET spk_secret_enc = ? WHERE user_id = ?")
            .bind(&spk_secret_enc_nd).bind(&res.user_id)
            .execute(&store.pool).await.map_err(|e| e.to_string())?;
    }

    *state.store.lock().await = Some(store);

    // ── Sync SPK to IDS on every login ────────────────────────────────────────
    // We NEVER rotate the SPK if one already exists locally — rotating would
    // invalidate pending X3DH sessions. Instead we re-upload the current SPK
    // public key on every login so that an IDS restart or DB reset cannot
    // silently leave the entry empty and break future session initiations.
    {
        let existing_store = state.get_store().await.ok_or("Store unavailable after login")?;

        let enc_result: Option<(String, Option<String>)> = sqlx::query_as(
            "SELECT identity_secret_enc, spk_secret_enc FROM accounts WHERE user_id = ? LIMIT 1"
        ).bind(&res.user_id)
        .fetch_optional(&existing_store.pool).await.map_err(|e| e.to_string())?;

        if let Some((identity_secret_enc, existing_spk_enc)) = enc_result {
            let identity_bytes = existing_store.decrypt_value(&identity_secret_enc).await
                .map_err(|e| format!("Failed to decrypt identity key: {e}"))?;
            let identity = IdentityKeyPair::from_bytes(&identity_bytes)
                .map_err(|e| format!("Bad identity key: {e}"))?;

            let local_ik_pub_b64 = base64::Engine::encode(
                &base64::engine::general_purpose::URL_SAFE_NO_PAD,
                &identity.public.0,
            );

            // Derive the SPK pub+sig to upload. If a secret already exists we
            // reuse it (no rotation). If not, generate a fresh one.
            let (spk_pub_b64, spk_sig_b64, maybe_new_secret) = if let Some(ref spk_enc) = existing_spk_enc {
                // Existing SPK — re-derive pubkey and re-sign. No rotation.
                let spk_bytes = existing_store.decrypt_value(spk_enc).await
                    .map_err(|e| format!("Failed to decrypt SPK: {e}"))?;
                let spk_raw: [u8; 32] = spk_bytes.try_into()
                    .map_err(|_| "SPK bytes wrong length".to_string())?;
                let spk_secret = x25519_dalek::StaticSecret::from(spk_raw);
                let spk_pub = x25519_dalek::PublicKey::from(&spk_secret);
                let spk_sig = identity.sign(spk_pub.as_bytes());
                let pub_b64 = base64::Engine::encode(
                    &base64::engine::general_purpose::URL_SAFE_NO_PAD, spk_pub.as_bytes());
                let sig_b64 = base64::Engine::encode(
                    &base64::engine::general_purpose::URL_SAFE_NO_PAD, &spk_sig);
                tracing::info!(
                    target: "dl_secure_channel",
                    event = "spk_reupload",
                    user_id = %res.user_id,
                    "Syncing existing SPK to IDS"
                );
                (pub_b64, sig_b64, None::<x25519_dalek::StaticSecret>)
            } else {
                // No SPK yet — generate a fresh one and persist after upload.
                let (fresh_secret, fresh_pub, fresh_sig) =
                    x3dh::generate_signed_prekey(&identity).map_err(|e| e.to_string())?;
                let pub_b64 = base64::Engine::encode(
                    &base64::engine::general_purpose::URL_SAFE_NO_PAD, fresh_pub.as_bytes());
                let sig_b64 = base64::Engine::encode(
                    &base64::engine::general_purpose::URL_SAFE_NO_PAD, &fresh_sig);
                tracing::info!(
                    target: "dl_secure_channel",
                    event = "spk_new",
                    user_id = %res.user_id,
                    "Generated new SPK"
                );
                (pub_b64, sig_b64, Some(fresh_secret))
            };

            // Upload to IDS — idempotent INSERT OR REPLACE on the server side.
            let spk_resp = client
                .put(format!("{}/keys/spk", state.api_base_url))
                .bearer_auth(&res.access_token)
                .json(&serde_json::json!({
                    "spk_pubkey": spk_pub_b64,
                    "spk_sig": spk_sig_b64,
                    "identity_pubkey": local_ik_pub_b64,
                }))
                .send().await.map_err(|e| format!("SPK upload failed: {e}"))?;

            if !spk_resp.status().is_success() {
                let status = spk_resp.status();
                let body = spk_resp.text().await.unwrap_or_default();
                tracing::error!("SPK upload to IDS failed ({status}): {body}");
            } else {
                tracing::info!(
                    target: "dl_secure_channel",
                    event = "spk_synced",
                    user_id = %res.user_id,
                    "SPK synced to IDS"
                );
            }

            // Persist new SPK secret only when we just generated one.
            if let Some(fresh_secret) = maybe_new_secret {
                let fresh_enc = existing_store
                    .encrypt_value(&fresh_secret.to_bytes()).await
                    .map_err(|e| format!("SPK encrypt failed: {e}"))?;
                sqlx::query("UPDATE accounts SET spk_secret_enc = ? WHERE user_id = ?")
                    .bind(&fresh_enc).bind(&res.user_id)
                    .execute(&existing_store.pool).await.map_err(|e| e.to_string())?;
            }
        }
    }

    eprintln!("[DEBUG auth] cmd_login: system_role from IDS = {:?}", res.system_role);
    state.set_system_role(res.system_role.clone()).await;
    eprintln!("[DEBUG auth] cmd_login: set_system_role called, returning AuthResult");

    Ok(AuthResult {
        user_id: res.user_id,
        username: res.username,
        key_change_detected: res.key_change_detected,
        system_role: res.system_role,
    })
}

/// Internal helper — refresh the access token and update state.
/// Returns the new access token on success.
pub(crate) async fn refresh_access_token(state: &AppState) -> Result<String, String> {
    let refresh = state.get_refresh_token().await.ok_or("No refresh token — please log in again")?;

    #[derive(Serialize)]
    struct RefreshReq { refresh_token: String }
    #[derive(Deserialize)]
    struct RefreshResp { access_token: String, refresh_token: String }

    let client = reqwest::Client::builder().use_rustls_tls().build().map_err(|e| e.to_string())?;
    let res = client
        .post(format!("{}/refresh", state.api_base_url))
        .json(&RefreshReq { refresh_token: refresh })
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let body: serde_json::Value = res.json().await.unwrap_or_default();
        let msg = body.get("error").and_then(|v| v.as_str()).unwrap_or("Token refresh failed");
        return Err(msg.to_string());
    }

    let body: RefreshResp = res.json().await.map_err(|e| e.to_string())?;
    state.set_token(Some(body.access_token.clone())).await;
    state.set_refresh_token(Some(body.refresh_token)).await;
    Ok(body.access_token)
}

/// Refresh the short-lived access token using the stored refresh token.
/// Returns the new access token string on success.
#[tauri::command]
pub async fn cmd_refresh_token(state: State<'_, AppState>) -> Result<String, String> {
    refresh_access_token(&state).await
}

/// Logout and lock vault.
#[tauri::command]
pub async fn cmd_logout(state: State<'_, AppState>) -> Result<(), String> {
    state.vault.lock().await;
    state.set_token(None).await;
    state.set_refresh_token(None).await;
    *state.store.lock().await = None;
    Ok(())
}

/// Change the vault password.
///
/// Re-derives the encryption key with a new salt, re-encrypts the identity and DH
/// secrets, then purges sessions, messages, and attachments (they were encrypted
/// with the old key and cannot be migrated in v1).
#[tauri::command]
pub async fn cmd_change_password(
    current_password: String,
    new_password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let store = state.get_store().await.ok_or("Not logged in")?;

    // 1. Load current vault salt + encrypted secrets.
    let (vault_salt_hex, identity_secret_enc, dh_secret_enc): (String, String, String) =
        sqlx::query_as(
            "SELECT vault_salt, identity_secret_enc, dh_secret_enc FROM accounts LIMIT 1",
        )
        .fetch_one(&store.pool)
        .await
        .map_err(|e| e.to_string())?;

    let old_salt: [u8; 16] = hex::decode(&vault_salt_hex)
        .map_err(|e| e.to_string())?
        .try_into()
        .map_err(|_| "Bad vault salt".to_string())?;

    // 2. Verify current password by attempting a fresh unlock.
    {
        let test_vault = dl_store::vault::Vault::new();
        test_vault
            .unlock(current_password.as_bytes(), &old_salt)
            .await
            .map_err(|_| "Current password is incorrect".to_string())?;
    }

    // 3. Decrypt identity + DH secrets with the old key.
    let identity_secret = store
        .decrypt_value(&identity_secret_enc)
        .await
        .map_err(|e| e.to_string())?;
    let dh_secret = store
        .decrypt_value(&dh_secret_enc)
        .await
        .map_err(|e| e.to_string())?;

    // 4. Re-derive vault key with new password + fresh salt.
    let new_salt = new_vault_salt();
    state
        .vault
        .unlock(new_password.as_bytes(), &new_salt)
        .await
        .map_err(|e| e.to_string())?;

    // 5. Re-encrypt with new key.
    let new_identity_enc = store
        .encrypt_value(&identity_secret)
        .await
        .map_err(|e| e.to_string())?;
    let new_dh_enc = store
        .encrypt_value(&dh_secret)
        .await
        .map_err(|e| e.to_string())?;

    // 6. Persist new salt + secrets.
    sqlx::query(
        "UPDATE accounts SET identity_secret_enc = ?, dh_secret_enc = ?, \
         vault_salt = ?, updated_at = datetime('now')",
    )
    .bind(&new_identity_enc)
    .bind(&new_dh_enc)
    .bind(hex::encode(new_salt))
    .execute(&store.pool)
    .await
    .map_err(|e| e.to_string())?;

    // 7. Purge anything encrypted with the old key (sessions, messages, attachments).
    //    Sessions re-establish automatically; message history is cleared (v1 limitation).
    sqlx::query("DELETE FROM attachments").execute(&store.pool).await.ok();
    sqlx::query("DELETE FROM messages").execute(&store.pool).await.ok();
    sqlx::query("DELETE FROM sessions").execute(&store.pool).await.ok();

    Ok(())
}
#[tauri::command]
pub async fn cmd_enroll_device(
    device_name: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // REPLACE_ME: implement full re-enrollment flow similar to register
    Err("Not yet implemented in v1".to_string())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn get_db_path(app: &tauri::AppHandle, user_id: &str) -> std::path::PathBuf {
    let mut path = app.path().app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    path.push("vaults");
    std::fs::create_dir_all(&path).ok();
    path.push(format!("{user_id}.db"));
    path
}

fn hostname_or_default() -> String {
    hostname::get()
        .ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| "unknown-device".to_string())
}
