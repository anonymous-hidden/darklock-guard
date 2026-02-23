//! Contact management Tauri commands.
use serde::{Deserialize, Serialize};
use tauri::State;
use chrono::Utc;

use dl_proto::api::UserKeysResponse;
use crate::state::AppState;

// ── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ContactDto {
    pub id: String,
    pub contact_user_id: String,
    pub display_name: Option<String>,
    pub identity_pubkey: String,
    pub verified_fingerprint: Option<String>,
    pub key_change_pending: bool,
    pub fingerprint: String,
    pub system_role: Option<String>,
}

/// A pending friend request (incoming or outgoing), sourced from IDS.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FriendRequestDto {
    /// IDS-assigned request ID, used to accept/deny.
    pub request_id: String,
    /// The other party's user_id.
    pub user_id: String,
    /// The other party's username.
    pub username: String,
    /// The other party's base-64 identity pubkey.
    pub identity_pubkey: String,
    /// Human-readable short fingerprint.
    pub fingerprint: String,
    /// "incoming" or "outgoing".
    pub direction: String,
    pub created_at: String,
}

// ── Internal row types ───────────────────────────────────────────────────────

#[derive(sqlx::FromRow)]
struct RawContact {
    id: String,
    contact_user_id: String,
    display_name: Option<String>,
    identity_pubkey: String,
    verified_fingerprint: Option<String>,
    key_change_pending: bool,
    system_role: Option<String>,
}

// ── IDS JSON shapes ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct IdsIncomingRequest {
    id: String,
    from_user_id: String,
    username: String,
    identity_pubkey: String,
    created_at: String,
}

#[derive(Deserialize)]
struct IdsOutgoingRequest {
    id: String,
    to_user_id: String,
    username: String,
    identity_pubkey: String,
    created_at: String,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct IdsIncomingList {
    requests: Vec<IdsIncomingRequest>,
}

#[allow(dead_code)]
#[derive(Deserialize)]
struct IdsOutgoingList {
    requests: Vec<IdsOutgoingRequest>,
}

#[derive(Deserialize)]
struct IdsAcceptResponse {
    status: String,
    contact: Option<IdsContactInfo>,
}

#[derive(Deserialize)]
struct IdsContactInfo {
    id: String,
    username: String,
    identity_pubkey: String,
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Extract a human-readable error from an IDS error JSON body.
/// IDS errors look like: `{ "error": "User not found", "code": "not_found" }`
/// Falls back to a clean status-based message if the body is HTML or unparseable.
fn ids_error_with_status(status: reqwest::StatusCode, body: &str) -> String {
    // Try to parse as JSON first
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(body) {
        if let Some(code) = v.get("code").and_then(|c| c.as_str()) {
            return code.to_string();
        }
        if let Some(msg) = v.get("error").and_then(|e| e.as_str()) {
            return msg.to_string();
        }
    }
    // Non-JSON body (e.g. Express HTML error page) — use HTTP status
    match status.as_u16() {
        404 => "not_found".to_string(),
        401 | 403 => "unauthorized".to_string(),
        409 => "conflict".to_string(),
        429 => "rate_limited".to_string(),
        _ => format!("server_error (HTTP {})", status.as_u16()),
    }
}

fn compute_fingerprint(pubkey_b64: &str) -> String {
    dl_crypto::identity::PublicKeyBytes(
        base64::Engine::decode(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
            pubkey_b64,
        ).unwrap_or_default()
    ).fingerprint()
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// List all accepted contacts for the current user.
#[tauri::command]
pub async fn cmd_get_contacts(state: State<'_, AppState>) -> Result<Vec<ContactDto>, String> {
    let store = state.get_store().await.ok_or("Not logged in")?;
    if state.vault.is_locked().await {
        return Err("Vault locked".into());
    }

    let rows: Vec<RawContact> = sqlx::query_as::<_, RawContact>(
        "SELECT id, contact_user_id, display_name, identity_pubkey, verified_fingerprint, key_change_pending, system_role \
         FROM contacts \
         WHERE owner_user_id = (SELECT user_id FROM accounts LIMIT 1) \
         ORDER BY display_name ASC"
    )
    .fetch_all(&store.pool)
    .await
    .map_err(|e| e.to_string())?;

    let contacts = rows.into_iter().map(|r| {
        let fp = compute_fingerprint(&r.identity_pubkey);
        ContactDto {
            id: r.id,
            contact_user_id: r.contact_user_id,
            display_name: r.display_name,
            identity_pubkey: r.identity_pubkey,
            verified_fingerprint: r.verified_fingerprint,
            key_change_pending: r.key_change_pending,
            fingerprint: fp,
            system_role: r.system_role,
        }
    }).collect();

    Ok(contacts)
}

/// Send a friend request to a user by username.
/// Posts to IDS — the peer will see it on their next `cmd_get_pending_requests` poll.
#[tauri::command]
pub async fn cmd_send_friend_request(
    username: String,
    state: State<'_, AppState>,
) -> Result<FriendRequestDto, String> {
    let token = state.get_token().await.ok_or("Not authenticated")?;
    let client = reqwest::Client::builder().use_rustls_tls().build().map_err(|e| e.to_string())?;

    // Look up target user's keys (so we can return a preview DTO)
    let keys_resp = client
        .get(format!("{}/users/{}/keys", state.api_base_url, username))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let keys_status = keys_resp.status();
    let keys_body = keys_resp.text().await.map_err(|e| e.to_string())?;
    if !keys_status.is_success() {
        return Err(ids_error_with_status(keys_status, &keys_body));
    }
    let keys: UserKeysResponse = serde_json::from_str(&keys_body).map_err(|e| e.to_string())?;

    // POST friend request to IDS
    #[derive(Serialize)]
    struct SendReqBody { target_username: String }
    #[derive(Deserialize)]
    struct SendReqResp { id: String, status: String }

    let req_resp = client
        .post(format!("{}/friends/request", state.api_base_url))
        .bearer_auth(&token)
        .json(&SendReqBody { target_username: username })
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let req_status = req_resp.status();
    let req_body = req_resp.text().await.map_err(|e| e.to_string())?;
    if !req_status.is_success() {
        return Err(ids_error_with_status(req_status, &req_body));
    }
    let resp: SendReqResp = serde_json::from_str(&req_body).map_err(|e| e.to_string())?;

    // If IDS auto-accepted (both users sent requests to each other), add contact locally
    if resp.status == "accepted" {
        let _ = insert_accepted_contact_from_keys(&keys, &state).await;
    }

    let fp = compute_fingerprint(&keys.identity_pubkey);

    Ok(FriendRequestDto {
        request_id: resp.id,
        user_id: keys.user_id,
        username: keys.username,
        identity_pubkey: keys.identity_pubkey,
        fingerprint: fp,
        direction: if resp.status == "accepted" { "accepted".into() } else { "outgoing".into() },
        created_at: Utc::now().to_rfc3339(),
    })
}

/// Poll IDS for pending friend requests (incoming + outgoing).
#[tauri::command]
pub async fn cmd_get_pending_requests(
    state: State<'_, AppState>,
) -> Result<Vec<FriendRequestDto>, String> {
    let token = state.get_token().await.ok_or("Not authenticated")?;
    let client = reqwest::Client::builder().use_rustls_tls().build().map_err(|e| e.to_string())?;

    let mut results: Vec<FriendRequestDto> = Vec::new();

    // Incoming
    let incoming: IdsIncomingList = client
        .get(format!("{}/friends/requests", state.api_base_url))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    for r in incoming.requests {
        let fp = compute_fingerprint(&r.identity_pubkey);
        results.push(FriendRequestDto {
            request_id: r.id,
            user_id: r.from_user_id,
            username: r.username,
            identity_pubkey: r.identity_pubkey,
            fingerprint: fp,
            direction: "incoming".into(),
            created_at: r.created_at,
        });
    }

    // Outgoing
    let outgoing: IdsOutgoingList = client
        .get(format!("{}/friends/requests/sent", state.api_base_url))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    for r in outgoing.requests {
        let fp = compute_fingerprint(&r.identity_pubkey);
        results.push(FriendRequestDto {
            request_id: r.id,
            user_id: r.to_user_id,
            username: r.username,
            identity_pubkey: r.identity_pubkey,
            fingerprint: fp,
            direction: "outgoing".into(),
            created_at: r.created_at,
        });
    }

    Ok(results)
}

/// Accept or deny a friend request.
/// - `accept = true`  → accept on IDS + insert contact locally
/// - `accept = false` → deny on IDS (no local insert)
#[tauri::command]
pub async fn cmd_respond_friend_request(
    request_id: String,
    accept: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let token = state.get_token().await.ok_or("Not authenticated")?;
    let client = reqwest::Client::builder().use_rustls_tls().build().map_err(|e| e.to_string())?;

    let action = if accept { "accept" } else { "deny" };
    let action_resp = client
        .post(format!("{}/friends/requests/{}/{}", state.api_base_url, request_id, action))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let action_status = action_resp.status();
    let action_body = action_resp.text().await.map_err(|e| e.to_string())?;
    if !action_status.is_success() {
        return Err(ids_error_with_status(action_status, &action_body));
    }
    let resp_body: IdsAcceptResponse = serde_json::from_str(&action_body).map_err(|e| e.to_string())?;

    if accept {
        if let Some(contact_info) = resp_body.contact {
            // Fetch full key bundle to get prekey data
            let keys_resp = client
                .get(format!("{}/users/{}/keys", state.api_base_url, contact_info.id))
                .bearer_auth(&token)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            let keys_status = keys_resp.status();
            let keys_body = keys_resp.text().await.map_err(|e| e.to_string())?;
            if !keys_status.is_success() {
                return Err(ids_error_with_status(keys_status, &keys_body));
            }
            let keys: UserKeysResponse = serde_json::from_str(&keys_body).map_err(|e| e.to_string())?;
            insert_accepted_contact_from_keys(&keys, &state).await?;
        }
    }

    Ok(())
}

/// Cancel an outgoing friend request.
#[tauri::command]
pub async fn cmd_cancel_friend_request(
    request_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let token = state.get_token().await.ok_or("Not authenticated")?;
    let client = reqwest::Client::builder().use_rustls_tls().build().map_err(|e| e.to_string())?;

    client
        .delete(format!("{}/friends/requests/{}", state.api_base_url, request_id))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/// Insert (or update) an accepted contact into the local SQLite vault from IDS key data.
async fn insert_accepted_contact_from_keys(
    keys: &UserKeysResponse,
    state: &AppState,
) -> Result<ContactDto, String> {
    let store = state.get_store().await.ok_or("Not logged in")?;

    let existing: Option<(String, bool)> = sqlx::query_as(
        "SELECT identity_pubkey, key_change_pending FROM contacts WHERE contact_user_id = ? LIMIT 1"
    )
    .bind(&keys.user_id)
    .fetch_optional(&store.pool)
    .await
    .map_err(|e| e.to_string())?;

    let key_change_pending = if let Some((stored_key, _)) = existing {
        if stored_key != keys.identity_pubkey {
            tracing::warn!(
                "Identity key change detected for user {} — blocking until re-verified",
                keys.user_id
            );
            true
        } else {
            false
        }
    } else {
        false
    };

    let id = uuid::Uuid::new_v4().to_string();
    let owner_id: String = sqlx::query_scalar("SELECT user_id FROM accounts LIMIT 1")
        .fetch_one(&store.pool)
        .await
        .map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO contacts (id, owner_user_id, contact_user_id, display_name, identity_pubkey, key_change_pending, status) \
         VALUES (?, ?, ?, ?, ?, ?, 'accepted') \
         ON CONFLICT(owner_user_id, contact_user_id) \
         DO UPDATE SET identity_pubkey = excluded.identity_pubkey, key_change_pending = excluded.key_change_pending, status = 'accepted'"
    )
    .bind(&id).bind(&owner_id).bind(&keys.user_id).bind(&keys.username)
    .bind(&keys.identity_pubkey).bind(key_change_pending)
    .execute(&store.pool)
    .await
    .map_err(|e| e.to_string())?;

    let fp = compute_fingerprint(&keys.identity_pubkey);

    Ok(ContactDto {
        id,
        contact_user_id: keys.user_id.clone(),
        display_name: Some(keys.username.clone()),
        identity_pubkey: keys.identity_pubkey.clone(),
        verified_fingerprint: None,
        key_change_pending,
        fingerprint: fp,
        system_role: None, // filled on next cmd_sync_contacts
    })
}

/// Mark a contact's key as verified (after user confirms fingerprint out-of-band).
#[tauri::command]
pub async fn cmd_verify_contact(
    contact_user_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let store = state.get_store().await.ok_or("Not logged in")?;

    let row: Option<(String,)> = sqlx::query_as(
        "SELECT identity_pubkey FROM contacts WHERE contact_user_id = ? LIMIT 1"
    )
    .bind(&contact_user_id)
    .fetch_optional(&store.pool)
    .await
    .map_err(|e| e.to_string())?;

    let (identity_pubkey,) = row.ok_or_else(|| format!("Contact {contact_user_id} not found"))?;

    let fp = compute_fingerprint(&identity_pubkey);

    sqlx::query(
        "UPDATE contacts SET verified_fingerprint = ?, key_change_pending = 0 WHERE contact_user_id = ?"
    )
    .bind(&fp).bind(&contact_user_id)
    .execute(&store.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Fetch current key bundle for a user from IDS.
#[tauri::command]
pub async fn cmd_get_user_keys(
    user_id: String,
    state: State<'_, AppState>,
) -> Result<UserKeysResponse, String> {
    let token = state.get_token().await.ok_or("Not authenticated")?;
    let client = reqwest::Client::builder().use_rustls_tls().build().map_err(|e| e.to_string())?;
    let resp = client
        .get(format!("{}/users/{}/keys", state.api_base_url, user_id))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(ids_error_with_status(status, &body));
    }
    serde_json::from_str(&body).map_err(|e| e.to_string())
}

/// Sync all accepted IDS friends into the local contacts table.
/// Idempotent — safe to call on every login. Fixes accounts whose local
/// contacts table is empty after a re-enrol during a buggy build period.
#[tauri::command]
pub async fn cmd_sync_contacts(state: State<'_, AppState>) -> Result<usize, String> {
    let token = state.get_token().await.ok_or("Not authenticated")?;
    let client = reqwest::Client::builder().use_rustls_tls().build().map_err(|e| e.to_string())?;

    // Fetch accepted friends list from IDS
    #[derive(Deserialize)]
    struct FriendEntry { id: String, username: String, identity_pubkey: String }
    #[derive(Deserialize)]
    struct FriendsResp { friends: Vec<FriendEntry> }

    let resp = client
        .get(format!("{}/friends", state.api_base_url))
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(ids_error_with_status(status, &body));
    }
    let friends: FriendsResp = serde_json::from_str(&body).map_err(|e| e.to_string())?;

    let store = state.get_store().await.ok_or("Not logged in")?;
    let owner_id: String = sqlx::query_scalar("SELECT user_id FROM accounts LIMIT 1")
        .fetch_one(&store.pool)
        .await
        .map_err(|e| e.to_string())?;

    let mut synced = 0usize;
    for f in &friends.friends {
        // Fetch full key bundle (best-effort — skip on error)
        let keys_resp = client
            .get(format!("{}/users/{}/keys", state.api_base_url, f.id))
            .bearer_auth(&token)
            .send()
            .await;
        let keys: Option<UserKeysResponse> = match keys_resp {
            Ok(r) if r.status().is_success() => r.json().await.ok(),
            _ => None,
        };

        // Use key from bundle if available, else fall back to friends list entry
        let identity_pubkey = keys.as_ref().map(|k| k.identity_pubkey.as_str())
            .unwrap_or(&f.identity_pubkey);
        let username = keys.as_ref().map(|k| k.username.as_str()).unwrap_or(&f.username);

        // Fetch public profile to get system_role (best-effort)
        #[derive(Deserialize)]
        struct ProfileResp { system_role: Option<String> }
        let profile_resp = client
            .get(format!("{}/users/{}/profile", state.api_base_url, f.id))
            .bearer_auth(&token)
            .send()
            .await;
        let system_role: Option<String> = match profile_resp {
            Ok(r) if r.status().is_success() => {
                r.json::<ProfileResp>().await.ok().and_then(|p| p.system_role)
            }
            _ => None,
        };

        let id = uuid::Uuid::new_v4().to_string();
        let result = sqlx::query(
            "INSERT INTO contacts (id, owner_user_id, contact_user_id, display_name, identity_pubkey, key_change_pending, status, system_role) \
             VALUES (?, ?, ?, ?, ?, 0, 'accepted', ?) \
             ON CONFLICT(owner_user_id, contact_user_id) \
             DO UPDATE SET identity_pubkey = excluded.identity_pubkey, status = 'accepted', system_role = excluded.system_role"
        )
        .bind(&id).bind(&owner_id).bind(&f.id).bind(username).bind(identity_pubkey)
        .bind(&system_role)
        .execute(&store.pool)
        .await;

        if result.is_ok() {
            synced += 1;
        } else {
            tracing::warn!("Sync contact failed for {}: {:?}", f.id, result.err());
        }
    }

    tracing::info!("Contact sync: {} / {} upserted", synced, friends.friends.len());
    Ok(synced)
}
