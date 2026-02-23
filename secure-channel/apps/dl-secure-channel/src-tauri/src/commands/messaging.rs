//! Messaging Tauri commands: session init, send, poll, decrypt.
//!
//! Uses the proper X3DH handshake + Double Ratchet protocol from dl_crypto.
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::State;

use dl_crypto::{aead, hash, x3dh, ratchet::RatchetSession};
use dl_proto::{
    api::*,
    envelope::Envelope,
    message::{MessageContent, PlaintextPayload},
};
use crate::state::AppState;
use super::auth::refresh_access_token;

async fn find_primary_session_id(
    pool: &sqlx::SqlitePool,
    local_user_id: &str,
    peer_user_id: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT id FROM sessions WHERE local_user_id = ? AND peer_user_id = ? ORDER BY created_at ASC LIMIT 1"
    )
    .bind(local_user_id)
    .bind(peer_user_id)
    .fetch_optional(pool)
    .await
}

fn extract_invite_code(text: &str) -> Option<String> {
    let candidates = [
        "darklock://invite/",
        "https://darklock.app/invite/",
        "http://darklock.app/invite/",
        "https://darklock.net/invite/",
        "http://darklock.net/invite/",
    ];
    for marker in candidates {
        if let Some(idx) = text.find(marker) {
            let rest = &text[idx + marker.len()..];
            let code: String = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
                .collect();
            if !code.is_empty() {
                return Some(code);
            }
        }
    }
    None
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MessageDto {
    pub id: String,
    pub session_id: String,
    pub sender_id: String,
    pub recipient_id: String,
    pub sent_at: String,
    pub delivery_state: String,
    pub content: serde_json::Value,
    pub is_outgoing: bool,
    pub chain_link: String,
    pub ratchet_n: u64,
}

/// Start or retrieve an existing session with a peer.
/// Uses proper X3DH handshake + initialises Double Ratchet as Alice.
#[tauri::command]
pub async fn cmd_start_session(
    peer_user_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let store = state.get_store().await.ok_or("Not logged in")?;
    if state.vault.is_locked().await { return Err("Vault locked".into()); }

    let local_user_id: String = sqlx::query_scalar("SELECT user_id FROM accounts LIMIT 1")
        .fetch_one(&store.pool).await.map_err(|e| e.to_string())?;

    // Check for existing session
    if let Some(id) = find_primary_session_id(&store.pool, &local_user_id, &peer_user_id)
        .await
        .map_err(|e| e.to_string())?
    {
        return Ok(id);
    }

    // Check contact key_change_pending — BLOCK if pending
    let kcp: Option<(bool,)> = sqlx::query_as(
        "SELECT key_change_pending FROM contacts WHERE contact_user_id = ? LIMIT 1"
    ).bind(&peer_user_id).fetch_optional(&store.pool).await.map_err(|e| e.to_string())?;

    if let Some((true,)) = kcp {
        return Err(format!("Identity key change detected for {peer_user_id} — verify before messaging."));
    }

    // Fetch prekey bundle from IDS
    let mut token = state.get_token().await.ok_or("Not authenticated")?;
    let client = reqwest::Client::builder().build().map_err(|e| e.to_string())?;
    let keys_resp = client
        .get(format!("{}/users/{}/keys", state.api_base_url, peer_user_id))
        .bearer_auth(&token)
        .send().await.map_err(|e| e.to_string())?;
    let keys_resp = if keys_resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        token = refresh_access_token(&state).await
            .map_err(|e| format!("Token refresh failed: {e}"))?;
        client
            .get(format!("{}/users/{}/keys", state.api_base_url, peer_user_id))
            .bearer_auth(&token)
            .send().await.map_err(|e| e.to_string())?
    } else {
        keys_resp
    };
    let keys: UserKeysResponse = keys_resp.json().await.map_err(|e| e.to_string())?;

    // Load our identity secret
    let identity_secret_enc: String = sqlx::query_scalar(
        "SELECT identity_secret_enc FROM accounts WHERE user_id = ? LIMIT 1"
    ).bind(&local_user_id).fetch_one(&store.pool).await.map_err(|e| e.to_string())?;

    let identity_bytes = store.decrypt_value(&identity_secret_enc).await.map_err(|e| e.to_string())?;
    let my_ik = dl_crypto::identity::IdentityKeyPair::from_bytes(&identity_bytes)
        .map_err(|e| e.to_string())?;

    // Build prekey bundle for X3DH
    // NOTE: We currently do NOT persist OPK *secrets* locally, only publish OPK
    // public keys to IDS. If we include an OPK in the bundle here, Alice will
    // derive SK including DH4, but Bob cannot mirror DH4 without the OPK secret,
    // causing first-message decryption failures and an inbox that never drains.
    //
    // Until OPK secret storage is implemented end-to-end, disable OPK usage so
    // X3DH runs in the "no OPK" mode (still secure, slightly less forward secret).
    let bundle = x3dh::PrekeyBundle {
        user_id: keys.user_id.clone(),
        ik_pub: keys.prekey_bundle.ik_pub.clone(),
        spk_pub: keys.prekey_bundle.spk_pub.clone(),
        spk_sig: keys.prekey_bundle.spk_sig.clone(),
        opk_pub: None,
        opk_id: None,
    };

    // Perform X3DH handshake (Alice side)
    let x3dh_result = x3dh::initiate(&local_user_id, &my_ik, &bundle)
        .map_err(|e| e.to_string())?;

    // Parse Bob's SPK for the Double Ratchet initialisation
    let spk_b_bytes = base64::Engine::decode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        &bundle.spk_pub,
    ).map_err(|e| e.to_string())?;
    let spk_b_arr: [u8; 32] = spk_b_bytes.try_into().map_err(|_| "Bad SPK length")?;
    let bob_spk_pub = x25519_dalek::PublicKey::from(spk_b_arr);

    // Initialise Double Ratchet as Alice
    let session = RatchetSession::init_alice(
        x3dh_result.header.session_id.clone(),
        peer_user_id.clone(),
        x3dh_result.shared_key,
        &bob_spk_pub,
    ).map_err(|e| e.to_string())?;

    let session_id = x3dh_result.header.session_id.clone();

    // Encrypt and store session state
    let session_json = serde_json::to_vec(&session).map_err(|e| e.to_string())?;
    let session_state_enc = store.encrypt_value(&session_json).await.map_err(|e| e.to_string())?;

    // Store the X3DH header so it can be included in the first message
    let x3dh_header_json = serde_json::to_string(&x3dh_result.header).map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO sessions (id, local_user_id, peer_user_id, session_state_enc, x3dh_header_pending) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(&session_id).bind(&local_user_id).bind(&peer_user_id)
    .bind(&session_state_enc).bind(&x3dh_header_json)
    .execute(&store.pool).await.map_err(|e| e.to_string())?;

    Ok(session_id)
}

/// Encrypt and send a text message using the Double Ratchet.
#[tauri::command]
pub async fn cmd_send_message(
    session_id: String,
    body: String,
    state: State<'_, AppState>,
) -> Result<MessageDto, String> {
    let store = state.get_store().await.ok_or("Not logged in")?;
    let token = state.get_token().await.ok_or("Not authenticated")?;
    if state.vault.is_locked().await { return Err("Vault locked".into()); }

    let local_user_id: String = sqlx::query_scalar("SELECT user_id FROM accounts LIMIT 1")
        .fetch_one(&store.pool).await.map_err(|e| e.to_string())?;

    let device_id: String = sqlx::query_scalar(
        "SELECT device_id FROM devices WHERE user_id = ? AND is_current_device = 1 LIMIT 1"
    ).bind(&local_user_id).fetch_one(&store.pool).await.map_err(|e| e.to_string())?;

    // Load session
    let (peer_user_id, session_state_enc, chain_head_hex): (String, String, String) =
        sqlx::query_as("SELECT peer_user_id, session_state_enc, chain_head FROM sessions WHERE id = ? LIMIT 1")
        .bind(&session_id)
        .fetch_one(&store.pool).await.map_err(|e| e.to_string())?;

    let session_bytes = store.decrypt_value(&session_state_enc).await.map_err(|e| e.to_string())?;
    let mut session: RatchetSession = serde_json::from_slice(&session_bytes).map_err(|e| e.to_string())?;

    // Double Ratchet encrypt step — get ratchet header + message key
    let (ratchet_header, mk) = session.encrypt_step().map_err(|e| e.to_string())?;

    // Build plaintext payload
    let now = Utc::now();
    let content = if let Some(invite_code) = extract_invite_code(&body) {
        let mut server_name = "Server Invite".to_string();
        let mut server_id = String::new();
        let preview_url = format!("{}/api/invites/{}/preview", state.api_base_url, invite_code);
        if let Ok(resp) = reqwest::Client::builder()
            .build()
            .map_err(|e| e.to_string())?
            .get(preview_url)
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(val) = resp.json::<serde_json::Value>().await {
                    if let Some(name) = val.get("server_name").and_then(|v| v.as_str()) {
                        server_name = name.to_string();
                    }
                    if let Some(sid) = val.get("server_id").and_then(|v| v.as_str()) {
                        server_id = sid.to_string();
                    }
                }
            }
        }
        MessageContent::GroupInvite {
            group_id: server_id,
            group_name: server_name,
            invite_token: invite_code,
        }
    } else {
        MessageContent::Text { body: body.clone() }
    };
    let content_bytes = serde_json::to_vec(&content).map_err(|e| e.to_string())?;
    let msg_id = hash::message_id(&local_user_id, &peer_user_id, &content_bytes, now.timestamp_nanos_opt().unwrap_or(0));

    let prev_chain: [u8; 32] = hex::decode(&chain_head_hex)
        .ok().and_then(|b| b.try_into().ok())
        .unwrap_or([0u8; 32]);
    let new_chain_link_bytes = hash::chain_link(&prev_chain, &msg_id, &content_bytes);
    let new_chain_link = hex::encode(new_chain_link_bytes);

    tracing::info!(
        target: "dl_secure_channel",
        event = "send_message_start",
        kind = "text",
        session_id = %session_id,
        peer_user_id = %peer_user_id,
        message_id = %msg_id,
        chain_link = %new_chain_link,
        plaintext_bytes = content_bytes.len()
    );

    // Pad plaintext
    let payload = PlaintextPayload {
        version: 2,
        message_id: msg_id.clone(),
        content: content.clone(),
        sent_at: now,
        sender_user_id: local_user_id.clone(),
        sender_device_id: device_id.clone(),
        chain_link: new_chain_link.clone(),
        prev_chain_link: chain_head_hex.clone(),
        padding_bucket: 0, // Will be set by codec
    };

    let payload_bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;

    // Apply padding
    let padded = dl_proto::codec::pad_to_bucket(&payload_bytes, dl_proto::codec::PaddingMode::Buckets);

    let ciphertext = aead::encrypt(&mk, &padded, session_id.as_bytes()).map_err(|e| e.to_string())?;
    let ct_b64 = base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, &ciphertext);

    // Check if there's a pending X3DH header (first message in session)
    let x3dh_pending: Option<(String,)> = sqlx::query_as(
        "SELECT x3dh_header_pending FROM sessions WHERE id = ? AND x3dh_header_pending IS NOT NULL"
    ).bind(&session_id).fetch_optional(&store.pool).await.map_err(|e| e.to_string())?;

    let x3dh_header: Option<x3dh::X3DHHeader> = x3dh_pending
        .and_then(|(json,)| serde_json::from_str(&json).ok());

    let envelope = Envelope {
        envelope_id: uuid::Uuid::new_v4().to_string(),
        version: 1,
        sender_id: local_user_id.clone(),
        recipient_id: peer_user_id.clone(),
        sent_at: now,
        session_id: session_id.clone(),
        ratchet_header,
        ciphertext: ct_b64,
        x3dh_header,
        chain_link: new_chain_link.clone(),
    };

    // Send to relay — store full Envelope JSON in the relay's ciphertext field
    let envelope_json = serde_json::to_string(&envelope).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder().build().map_err(|e| e.to_string())?;
    let send_payload = serde_json::json!({
        "recipient_id": &peer_user_id,
        "ciphertext": envelope_json,
        "chain_link": &new_chain_link,
    });
    let mut active_token = token;
    let send_resp = client
        .post(format!("{}/send", state.rly_base_url))
        .bearer_auth(&active_token)
        .json(&send_payload)
        .send().await.map_err(|e| e.to_string())?;
    let send_resp = if send_resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        tracing::warn!(
            target: "dl_secure_channel",
            event = "send_message_unauthorized",
            kind = "text",
            session_id = %session_id,
            peer_user_id = %peer_user_id,
            message_id = %msg_id
        );
        // Token expired — refresh and retry once
        active_token = refresh_access_token(&state).await
            .map_err(|e| format!("Token refresh failed: {e}"))?;
        client
            .post(format!("{}/send", state.rly_base_url))
            .bearer_auth(&active_token)
            .json(&send_payload)
            .send().await.map_err(|e| e.to_string())?
    } else {
        send_resp
    };
    let send_status = send_resp.status();
    if !send_status.is_success() {
        let b = send_resp.text().await.unwrap_or_default();
        tracing::error!(
            target: "dl_secure_channel",
            event = "send_message_failed",
            kind = "text",
            session_id = %session_id,
            peer_user_id = %peer_user_id,
            message_id = %msg_id,
            status = %send_status,
            body_len = b.len()
        );
        return Err(format!("Relay send failed ({send_status}): {b}"));
    }

    tracing::info!(
        target: "dl_secure_channel",
        event = "send_message_ok",
        kind = "text",
        session_id = %session_id,
        peer_user_id = %peer_user_id,
        message_id = %msg_id,
        status = %send_status
    );

    // Persist updated session state and clear X3DH header
    let new_session_json = serde_json::to_vec(&session).map_err(|e| e.to_string())?;
    let new_session_enc = store.encrypt_value(&new_session_json).await.map_err(|e| e.to_string())?;

    sqlx::query(
        "UPDATE sessions SET session_state_enc = ?, chain_head = ?, x3dh_header_pending = NULL, updated_at = ? WHERE id = ?"
    )
    .bind(&new_session_enc).bind(&new_chain_link).bind(now.to_rfc3339()).bind(&session_id)
    .execute(&store.pool).await.map_err(|e| e.to_string())?;

    // Store encrypted message locally
    let body_enc = store.encrypt_value(&serde_json::to_vec(&content).map_err(|e| e.to_string())?)
        .await.map_err(|e| e.to_string())?;

    let msg_type = match &content {
        MessageContent::Text { .. } => "text",
        MessageContent::Attachment { .. } => "attachment",
        MessageContent::GroupInvite { .. } => "invite",
        _ => "other",
    };

    sqlx::query(
        "INSERT INTO messages (id, session_id, sender_id, recipient_id, sent_at, delivery_state, message_type, body_enc, chain_link, message_n, is_outgoing) VALUES (?, ?, ?, ?, ?, 'delivered', ?, ?, ?, ?, 1)"
    )
    .bind(&msg_id).bind(&session_id).bind(&local_user_id).bind(&peer_user_id)
    .bind(now.to_rfc3339()).bind(msg_type).bind(&body_enc).bind(&new_chain_link).bind(session.send_n as i64)
    .execute(&store.pool).await.map_err(|e| e.to_string())?;

    Ok(MessageDto {
        id: msg_id,
        session_id,
        sender_id: local_user_id,
        recipient_id: peer_user_id,
        sent_at: now.to_rfc3339(),
        delivery_state: "delivered".into(),
        content: serde_json::to_value(content).unwrap_or_default(),
        is_outgoing: true,
        chain_link: new_chain_link,
        ratchet_n: session.send_n,
    })
}

/// Poll relay for new messages and decrypt them using the Double Ratchet.
#[tauri::command]
pub async fn cmd_poll_inbox(state: State<'_, AppState>) -> Result<Vec<MessageDto>, String> {
    let store = state.get_store().await.ok_or("Not logged in")?;
    let mut token = state.get_token().await.ok_or("Not authenticated")?;
    if state.vault.is_locked().await { return Err("Vault locked".into()); }

    let local_user_id: String = sqlx::query_scalar("SELECT user_id FROM accounts LIMIT 1")
        .fetch_one(&store.pool).await.map_err(|e| e.to_string())?;

    // Relay flat poll response
    #[derive(Deserialize)]
    struct RlyEnv { id: String, sender_id: String, ciphertext: String }
    #[derive(Deserialize)]
    struct RlyPoll {
        envelopes: Vec<RlyEnv>,
        #[allow(dead_code)]
        count: Option<usize>,
    }

    let client = reqwest::Client::builder().build().map_err(|e| e.to_string())?;
    let poll_resp = client
        .post(format!("{}/poll", state.rly_base_url))
        .bearer_auth(&token)
        .json(&serde_json::json!({}))
        .send().await.map_err(|e| e.to_string())?;
    let poll_resp = if poll_resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        token = refresh_access_token(&state).await
            .map_err(|e| format!("Token refresh failed: {e}"))?;
        client
            .post(format!("{}/poll", state.rly_base_url))
            .bearer_auth(&token)
            .json(&serde_json::json!({}))
            .send().await.map_err(|e| e.to_string())?
    } else {
        poll_resp
    };
    let poll_status = poll_resp.status();
    if !poll_status.is_success() {
        let body = poll_resp.text().await.unwrap_or_default();
        return Err(format!("Relay poll failed ({poll_status}): {body}"));
    }
    let poll: RlyPoll = poll_resp.json().await.map_err(|e| e.to_string())?;

    if !poll.envelopes.is_empty() {
        tracing::info!(
            target: "dl_secure_channel",
            event = "poll_inbox",
            count = poll.envelopes.len()
        );
    }

    let mut results = Vec::new();
    let mut ack_ids = Vec::new();

    for rly_env in poll.envelopes {
        tracing::debug!(
            target: "dl_secure_channel",
            event = "poll_envelope",
            relay_id = %rly_env.id,
            sender_id = %rly_env.sender_id,
            ciphertext_len = rly_env.ciphertext.len()
        );
        let envelope: Envelope = match serde_json::from_str(&rly_env.ciphertext) {
            Ok(e) => e,
            Err(err) => {
                tracing::error!("Failed to parse envelope from relay ciphertext {}: {err}", rly_env.id);
                ack_ids.push(rly_env.id);
                continue;
            }
        };
        // Sanity-check sender matches
        if envelope.sender_id != rly_env.sender_id {
            tracing::warn!("sender_id mismatch relay={} envelope={}", rly_env.sender_id, envelope.sender_id);
        }
        // NOTE: do NOT push to ack_ids here — only ack after successful decrypt.

        // Find session by explicit session_id from envelope — this prevents
        // confusing Alice's outgoing session with Bob's incoming session when
        // both peers independently initiate X3DH at the same time.
        let session_row: Option<(String, String, String)> = sqlx::query_as(
            "SELECT id, session_state_enc, chain_head FROM sessions WHERE id = ? AND local_user_id = ? LIMIT 1"
        ).bind(&envelope.session_id).bind(&local_user_id)
        .fetch_optional(&store.pool).await.map_err(|e| e.to_string())?;

        if session_row.is_none() {
            tracing::info!(
                target: "dl_secure_channel",
                event = "missing_session_for_envelope",
                session_id = %envelope.session_id,
                sender_id = %envelope.sender_id,
                relay_id = %rly_env.id,
                has_x3dh = envelope.x3dh_header.is_some()
            );
        }

        if session_row.is_none() {
            // New session from X3DH init — complete Bob's side of the handshake
            if let Some(ref x3dh_hdr) = envelope.x3dh_header {
                // Load our identity key + SPK secret
                let keys: Option<(String, Option<String>)> = sqlx::query_as(
                    "SELECT identity_secret_enc, spk_secret_enc FROM accounts WHERE user_id = ? LIMIT 1"
                ).bind(&local_user_id)
                .fetch_optional(&store.pool).await.ok().flatten();

                if let Some((ik_enc, Some(spk_enc))) = keys {
                    let ik_bytes = store.decrypt_value(&ik_enc).await.ok();
                    let spk_bytes = store.decrypt_value(&spk_enc).await.ok();

                    if let (Some(ik_b), Some(spk_b)) = (ik_bytes, spk_bytes) {
                        let ik_ok = dl_crypto::identity::IdentityKeyPair::from_bytes(&ik_b).ok();
                        let spk_arr: Option<[u8; 32]> = spk_b.try_into().ok();

                        if let (Some(my_ik), Some(spk_raw)) = (ik_ok, spk_arr) {
                            let my_spk_secret = x25519_dalek::StaticSecret::from(spk_raw);

                            // Fetch sender's Ed25519 identity pubkey.
                            // Prefer contacts table; fallback to IDS if contacts not yet synced.
                            let sender_ik_b64_opt: Option<String> = sqlx::query_scalar(
                                "SELECT identity_pubkey FROM contacts WHERE contact_user_id = ? LIMIT 1"
                            )
                            .bind(&envelope.sender_id)
                            .fetch_optional(&store.pool).await.ok().flatten();

                            let sender_ik_b64_opt = if sender_ik_b64_opt.is_some() {
                                sender_ik_b64_opt
                            } else {
                                tracing::warn!(
                                    target: "dl_secure_channel",
                                    event = "missing_sender_identity_key",
                                    sender_id = %envelope.sender_id
                                );

                                // IDS lookup: /users/:id/keys includes identity pubkey in prekey_bundle.ik_pub
                                let mut tok = token.clone();
                                let keys_resp = client
                                    .get(format!("{}/users/{}/keys", state.api_base_url, envelope.sender_id))
                                    .bearer_auth(&tok)
                                    .send().await;

                                let keys_resp = match keys_resp {
                                    Ok(r) if r.status() == reqwest::StatusCode::UNAUTHORIZED => {
                                        tok = refresh_access_token(&state).await
                                            .map_err(|e| format!("Token refresh failed: {e}"))?;
                                        token = tok.clone();
                                        client
                                            .get(format!("{}/users/{}/keys", state.api_base_url, envelope.sender_id))
                                            .bearer_auth(&tok)
                                            .send().await
                                            .map_err(|e| e.to_string())?
                                    }
                                    Ok(r) => r,
                                    Err(e) => {
                                        tracing::error!(
                                            target: "dl_secure_channel",
                                            event = "ids_keys_fetch_failed",
                                            sender_id = %envelope.sender_id,
                                            error = %e
                                        );
                                        // Can't proceed without sender identity key; don't ack.
                                        continue;
                                    }
                                };

                                if !keys_resp.status().is_success() {
                                    tracing::error!(
                                        target: "dl_secure_channel",
                                        event = "ids_keys_fetch_bad_status",
                                        sender_id = %envelope.sender_id,
                                        status = %keys_resp.status()
                                    );
                                    continue;
                                }

                                let keys: UserKeysResponse = keys_resp.json().await.map_err(|e| e.to_string())?;
                                Some(keys.prekey_bundle.ik_pub)
                            };

                            let sender_ik_bytes = sender_ik_b64_opt
                                .and_then(|b| base64::Engine::decode(
                                    &base64::engine::general_purpose::URL_SAFE_NO_PAD, b).ok());

                            if let Some(sik) = sender_ik_bytes {
                                let sik_arr: Option<[u8; 32]> = sik.try_into().ok();
                                if let Some(sender_ik_ed) = sik_arr {
                                    if let Ok(sk) = dl_crypto::x3dh::respond(
                                        &my_ik, &my_spk_secret, None, &sender_ik_ed, x3dh_hdr,
                                    ) {
                                        // Init Double Ratchet as Bob
                                        let ek_a_bytes = base64::Engine::decode(
                                            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
                                            &x3dh_hdr.ek_pub,
                                        ).ok();
                                        let ek_a_pub = ek_a_bytes
                                            .and_then(|b| b.try_into().ok())
                                            .map(|a: [u8; 32]| x25519_dalek::PublicKey::from(a));

                                        if let Some(ek_pub) = ek_a_pub {
                                            if let Ok(session) = RatchetSession::init_bob(
                                                x3dh_hdr.session_id.clone(),
                                                envelope.sender_id.clone(),
                                                sk,
                                                &my_spk_secret,
                                                &ek_pub,
                                            ) {
                                                let session_json = serde_json::to_vec(&session).ok();
                                                if let Some(sj) = session_json {
                                                    if let Ok(enc) = store.encrypt_value(&sj).await {
                                                        let _ = sqlx::query(
                                                            "INSERT OR IGNORE INTO sessions (id, local_user_id, peer_user_id, session_state_enc, x3dh_header_pending) VALUES (?, ?, ?, ?, NULL)"
                                                        ).bind(&x3dh_hdr.session_id)
                                                        .bind(&local_user_id)
                                                        .bind(&envelope.sender_id)
                                                        .bind(&enc)
                                                        .execute(&store.pool).await;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Re-query by session_id so we get exactly the Bob-side session just created
            let bob_session_id = envelope.x3dh_header.as_ref().map(|h| h.session_id.clone());
            let s2: Option<(String, String, String)> = if let Some(ref sid) = bob_session_id {
                sqlx::query_as(
                    "SELECT id, session_state_enc, chain_head FROM sessions WHERE id = ? AND local_user_id = ? LIMIT 1"
                ).bind(sid).bind(&local_user_id)
                .fetch_optional(&store.pool).await.ok().flatten()
            } else {
                None
            };

            if s2.is_none() {
                tracing::warn!("Could not establish session from {} — skipping envelope", envelope.sender_id);
                continue;
            }

            // Fall through with the newly created session
            let (session_id, session_state_enc, chain_head) = s2.unwrap();
            let session_bytes = store.decrypt_value(&session_state_enc).await.map_err(|e| e.to_string())?;
            let mut session: RatchetSession = serde_json::from_slice(&session_bytes).map_err(|e| e.to_string())?;

            let mk = match session.decrypt_step(&envelope.ratchet_header) {
                Ok(mk) => mk,
                Err(e) => {
                    tracing::error!("Ratchet decrypt failed for new session envelope {}: {e}", envelope.envelope_id);
                    continue;
                }
            };
            let ct = base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, &envelope.ciphertext).map_err(|e| e.to_string())?;
            let padded = match dl_crypto::aead::decrypt(&mk, &ct, session_id.as_bytes()) {
                Ok(b) => b,
                Err(e) => {
                    tracing::error!(
                        target: "dl_secure_channel",
                        event = "decrypt_failed_new_session",
                        relay_id = %rly_env.id,
                        envelope_id = %envelope.envelope_id,
                        error = %e
                    );
                    continue;
                }
            };
            let payload_bytes = dl_proto::codec::unpad(&padded).map_err(|e| e.to_string())?;
            let payload: PlaintextPayload = serde_json::from_slice(&payload_bytes).map_err(|e| e.to_string())?;
            let body_json = serde_json::to_vec(&payload.content).map_err(|e| e.to_string())?;
            let body_enc = store.encrypt_value(&body_json).await.map_err(|e| e.to_string())?;
            let msg_type = match &payload.content {
                MessageContent::Text { .. } => "text",
                MessageContent::Attachment { .. } => "attachment",
                MessageContent::GroupInvite { .. } => "invite",
                _ => "other",
            };
            sqlx::query("INSERT OR IGNORE INTO messages (id, session_id, sender_id, recipient_id, sent_at, received_at, delivery_state, message_type, body_enc, chain_link, message_n, is_outgoing) VALUES (?, ?, ?, ?, ?, ?, 'delivered', ?, ?, ?, ?, 0)")
                .bind(&payload.message_id).bind(&session_id).bind(&envelope.sender_id).bind(&local_user_id)
                .bind(payload.sent_at.to_rfc3339()).bind(Utc::now().to_rfc3339())
                .bind(msg_type).bind(&body_enc).bind(&payload.chain_link).bind(envelope.ratchet_header.n as i64)
                .execute(&store.pool).await.map_err(|e| e.to_string())?;
            let new_sj = serde_json::to_vec(&session).map_err(|e| e.to_string())?;
            let new_enc = store.encrypt_value(&new_sj).await.map_err(|e| e.to_string())?;
            sqlx::query("UPDATE sessions SET session_state_enc = ?, chain_head = ? WHERE id = ?")
                .bind(&new_enc).bind(&payload.chain_link).bind(&session_id)
                .execute(&store.pool).await.map_err(|e| e.to_string())?;
            // Return under the canonical (oldest/Alice-side) session_id so appendMessages
            // updates the right chat bucket in the UI.
            let ui_sid: String = sqlx::query_scalar(
                "SELECT id FROM sessions WHERE local_user_id = ? AND peer_user_id = ? ORDER BY created_at ASC LIMIT 1"
            ).bind(&local_user_id).bind(&envelope.sender_id)
            .fetch_optional(&store.pool).await.ok().flatten().unwrap_or_else(|| session_id.clone());
            results.push(MessageDto {
                id: payload.message_id, session_id: ui_sid, sender_id: envelope.sender_id,
                recipient_id: local_user_id.clone(), sent_at: payload.sent_at.to_rfc3339(),
                delivery_state: "delivered".into(),
                content: serde_json::to_value(payload.content).unwrap_or_default(),
                is_outgoing: false, chain_link: payload.chain_link, ratchet_n: envelope.ratchet_header.n,
            });
            ack_ids.push(rly_env.id.clone()); // ack only after successful decrypt
            continue;
        }

        let (session_id, session_state_enc, chain_head) = session_row.unwrap();
        let session_bytes = store.decrypt_value(&session_state_enc).await.map_err(|e| e.to_string())?;
        let mut session: RatchetSession = serde_json::from_slice(&session_bytes).map_err(|e| e.to_string())?;

        // Double Ratchet decrypt step — derives message key from ratchet header
        let mk = match session.decrypt_step(&envelope.ratchet_header) {
            Ok(mk) => mk,
            Err(e) => {
                tracing::error!(
                    target: "dl_secure_channel",
                    event = "ratchet_decrypt_failed",
                    relay_id = %rly_env.id,
                    envelope_id = %envelope.envelope_id,
                    error = %e
                );
                continue;
            }
        };

        let ct = base64::Engine::decode(
            &base64::engine::general_purpose::URL_SAFE_NO_PAD,
            &envelope.ciphertext,
        ).map_err(|e| e.to_string())?;

        let padded_bytes = match aead::decrypt(&mk, &ct, session_id.as_bytes()) {
            Ok(b) => b,
            Err(e) => {
                tracing::error!(
                    target: "dl_secure_channel",
                    event = "decrypt_failed",
                    relay_id = %rly_env.id,
                    envelope_id = %envelope.envelope_id,
                    error = %e
                );
                continue;
            }
        };

        // Remove padding
        let payload_bytes = dl_proto::codec::unpad(&padded_bytes).map_err(|e| e.to_string())?;

        let payload: PlaintextPayload = serde_json::from_slice(&payload_bytes).map_err(|e| e.to_string())?;

        // Cross-check sender_user_id matches envelope
        if payload.sender_user_id != envelope.sender_id {
            tracing::error!("sender_user_id mismatch in envelope {}: payload says {}, envelope says {}",
                envelope.envelope_id, payload.sender_user_id, envelope.sender_id);
            continue;
        }

        // Persist
        let body_json = serde_json::to_vec(&payload.content).map_err(|e| e.to_string())?;
        let body_enc = store.encrypt_value(&body_json).await.map_err(|e| e.to_string())?;
        let msg_type = match &payload.content {
            MessageContent::Text { .. } => "text",
            MessageContent::Attachment { .. } => "attachment",
            MessageContent::GroupInvite { .. } => "invite",
            _ => "other",
        };

        sqlx::query(
            "INSERT OR IGNORE INTO messages (id, session_id, sender_id, recipient_id, sent_at, received_at, delivery_state, message_type, body_enc, chain_link, message_n, is_outgoing) VALUES (?, ?, ?, ?, ?, ?, 'delivered', ?, ?, ?, ?, 0)"
        )
        .bind(&payload.message_id).bind(&session_id)
        .bind(&envelope.sender_id).bind(&local_user_id)
        .bind(payload.sent_at.to_rfc3339()).bind(Utc::now().to_rfc3339())
        .bind(msg_type).bind(&body_enc).bind(&payload.chain_link)
        .bind(envelope.ratchet_header.n as i64)
        .execute(&store.pool).await.map_err(|e| e.to_string())?;

        // Update session
        let new_session_json = serde_json::to_vec(&session).map_err(|e| e.to_string())?;
        let new_enc = store.encrypt_value(&new_session_json).await.map_err(|e| e.to_string())?;
        sqlx::query("UPDATE sessions SET session_state_enc = ?, chain_head = ? WHERE id = ?")
            .bind(&new_enc).bind(&payload.chain_link).bind(&session_id)
            .execute(&store.pool).await.map_err(|e| e.to_string())?;

        // Return under the canonical (oldest/Alice-side) session_id so appendMessages
        // updates the right chat bucket in the UI.
        let ui_sid: String = sqlx::query_scalar(
            "SELECT id FROM sessions WHERE local_user_id = ? AND peer_user_id = ? ORDER BY created_at ASC LIMIT 1"
        ).bind(&local_user_id).bind(&envelope.sender_id)
        .fetch_optional(&store.pool).await.ok().flatten().unwrap_or_else(|| session_id.clone());

        results.push(MessageDto {
            id: payload.message_id,
            session_id: ui_sid,
            sender_id: envelope.sender_id,
            recipient_id: local_user_id.clone(),
            sent_at: payload.sent_at.to_rfc3339(),
            delivery_state: "delivered".into(),
            content: serde_json::to_value(payload.content).unwrap_or_default(),
            is_outgoing: false,
            chain_link: payload.chain_link,
            ratchet_n: envelope.ratchet_header.n,
        });
        ack_ids.push(rly_env.id); // ack only after successful decrypt
    }

    // Ack received envelopes
    if !ack_ids.is_empty() {
        let token2 = token.clone();
        let rly_url = state.rly_base_url.clone();
        let ack_count = ack_ids.len();
        tokio::spawn(async move {
            let c = reqwest::Client::builder().build().unwrap();
            let resp = c.post(format!("{rly_url}/ack"))
                .bearer_auth(token2)
                .json(&AckRequest { envelope_ids: ack_ids })
                .send().await;

            match resp {
                Ok(r) => {
                    tracing::info!(
                        target: "dl_secure_channel",
                        event = "ack_sent",
                        status = %r.status(),
                        count = ack_count
                    );
                }
                Err(e) => {
                    tracing::error!(
                        target: "dl_secure_channel",
                        event = "ack_failed",
                        error = %e,
                        count = ack_count
                    );
                }
            }
        });
    }

    Ok(results)
}

/// Get stored messages for a session (loads across all sessions with the same peer).
#[tauri::command]
pub async fn cmd_get_messages(
    session_id: String,
    limit: i64,
    before_n: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<MessageDto>, String> {
    let store = state.get_store().await.ok_or("Not logged in")?;
    if state.vault.is_locked().await { return Err("Vault locked".into()); }

    let local_user_id: String = sqlx::query_scalar("SELECT user_id FROM accounts LIMIT 1")
        .fetch_one(&store.pool).await.map_err(|e| e.to_string())?;

    // Resolve peer_user_id from the given session so we can load messages from
    // ALL sessions with this peer (Alice-side + any Bob-side sessions).
    let peer_user_id: Option<String> = sqlx::query_scalar(
        "SELECT peer_user_id FROM sessions WHERE id = ? LIMIT 1"
    ).bind(&session_id).fetch_optional(&store.pool).await.map_err(|e| e.to_string())?;

    let peer_user_id = peer_user_id.unwrap_or_default();

    let rows: Vec<RawMessage> = if let Some(before_ts) = before_n {
        // before_n repurposed as a millisecond unix timestamp cursor
        sqlx::query_as::<_, RawMessage>(
            "SELECT m.id, m.session_id, m.sender_id, m.recipient_id, m.sent_at, m.delivery_state, m.message_type, m.body_enc, m.chain_link, m.message_n, m.is_outgoing \
             FROM messages m \
             JOIN sessions s ON s.id = m.session_id \
             WHERE s.local_user_id = ? AND s.peer_user_id = ? AND m.message_n < ? \
             ORDER BY m.sent_at DESC LIMIT ?"
        )
        .bind(&local_user_id).bind(&peer_user_id).bind(before_ts).bind(limit)
        .fetch_all(&store.pool).await.map_err(|e| e.to_string())?
    } else {
        sqlx::query_as::<_, RawMessage>(
            "SELECT m.id, m.session_id, m.sender_id, m.recipient_id, m.sent_at, m.delivery_state, m.message_type, m.body_enc, m.chain_link, m.message_n, m.is_outgoing \
             FROM messages m \
             JOIN sessions s ON s.id = m.session_id \
             WHERE s.local_user_id = ? AND s.peer_user_id = ? \
             ORDER BY m.sent_at DESC LIMIT ?"
        )
        .bind(&local_user_id).bind(&peer_user_id).bind(limit)
        .fetch_all(&store.pool).await.map_err(|e| e.to_string())?
    };

    let mut dtos = Vec::new();
    for row in rows {
        let body_bytes = store.decrypt_value(&row.body_enc).await.map_err(|e| e.to_string())?;
        let content: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap_or_default();
        dtos.push(MessageDto {
            id: row.id,
            session_id: row.session_id,
            sender_id: row.sender_id,
            recipient_id: row.recipient_id,
            sent_at: row.sent_at,
            delivery_state: row.delivery_state,
            content,
            is_outgoing: row.is_outgoing,
            chain_link: row.chain_link,
            ratchet_n: row.message_n as u64,
        });
    }
    // Return in ascending order
    dtos.reverse();
    Ok(dtos)
}

#[derive(sqlx::FromRow)]
struct RawMessage {
    id: String,
    session_id: String,
    sender_id: String,
    recipient_id: String,
    sent_at: String,
    delivery_state: String,
    message_type: String,
    body_enc: String,
    chain_link: String,
    message_n: i64,
    is_outgoing: bool,
}

/// Send an attachment through the Double Ratchet session.
/// Reads the file, base64-encodes it into `storage_ref` inline, and feeds it
/// through the same ratchet → pad → AEAD → relay pipeline as text messages.
#[tauri::command]
pub async fn cmd_send_attachment(
    session_id: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<MessageDto, String> {
    const MAX_ATTACHMENT_BYTES: usize = 10 * 1024 * 1024; // 10 MB limit

    let store = state.get_store().await.ok_or("Not logged in")?;
    let token = state.get_token().await.ok_or("Not authenticated")?;
    if state.vault.is_locked().await { return Err("Vault locked".into()); }

    // ── Read file ────────────────────────────────────────────────────────────
    let path = std::path::Path::new(&file_path);
    if !path.exists() { return Err("File not found".into()); }
    let file_bytes = std::fs::read(path).map_err(|e| format!("Failed to read file: {e}"))?;
    if file_bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(format!("File too large ({} bytes, max {})", file_bytes.len(), MAX_ATTACHMENT_BYTES));
    }

    let filename = path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("attachment")
        .to_string();

    let mime_type = match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        "zip" => "application/zip",
        "mp4" => "video/mp4",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "webm" => "video/webm",
        "doc" | "docx" => "application/msword",
        _ => "application/octet-stream",
    }.to_string();

    let size_bytes = file_bytes.len() as u64;
    let content_hash = hash::attachment_hash(&file_bytes);

    // Inline storage: base64-encode the raw file bytes into storage_ref
    let storage_ref = base64::Engine::encode(
        &base64::engine::general_purpose::URL_SAFE_NO_PAD,
        &file_bytes,
    );

    // attachment_key left empty for v1 inline storage (data is already
    // encrypted by the ratchet + AEAD pipeline wrapping the whole payload).
    let attachment_key = String::new();

    // ── Build MessageContent ─────────────────────────────────────────────────
    let content = MessageContent::Attachment {
        filename: filename.clone(),
        mime_type,
        size_bytes,
        content_hash,
        storage_ref,
        attachment_key,
    };

    // ── Ratchet / encrypt / send (same pipeline as cmd_send_message) ─────────
    let local_user_id: String = sqlx::query_scalar("SELECT user_id FROM accounts LIMIT 1")
        .fetch_one(&store.pool).await.map_err(|e| e.to_string())?;

    let device_id: String = sqlx::query_scalar(
        "SELECT device_id FROM devices WHERE user_id = ? AND is_current_device = 1 LIMIT 1"
    ).bind(&local_user_id).fetch_one(&store.pool).await.map_err(|e| e.to_string())?;

    let (peer_user_id, session_state_enc, chain_head_hex): (String, String, String) =
        sqlx::query_as("SELECT peer_user_id, session_state_enc, chain_head FROM sessions WHERE id = ? LIMIT 1")
        .bind(&session_id)
        .fetch_one(&store.pool).await.map_err(|e| e.to_string())?;

    let session_bytes = store.decrypt_value(&session_state_enc).await.map_err(|e| e.to_string())?;
    let mut session: RatchetSession = serde_json::from_slice(&session_bytes).map_err(|e| e.to_string())?;

    let (ratchet_header, mk) = session.encrypt_step().map_err(|e| e.to_string())?;

    let now = Utc::now();
    let content_bytes = serde_json::to_vec(&content).map_err(|e| e.to_string())?;
    let msg_id = hash::message_id(&local_user_id, &peer_user_id, &content_bytes, now.timestamp_nanos_opt().unwrap_or(0));

    let prev_chain: [u8; 32] = hex::decode(&chain_head_hex)
        .ok().and_then(|b| b.try_into().ok())
        .unwrap_or([0u8; 32]);
    let new_chain_link_bytes = hash::chain_link(&prev_chain, &msg_id, &content_bytes);
    let new_chain_link = hex::encode(new_chain_link_bytes);

    tracing::info!(
        target: "dl_secure_channel",
        event = "send_message_start",
        kind = "attachment",
        session_id = %session_id,
        peer_user_id = %peer_user_id,
        message_id = %msg_id,
        chain_link = %new_chain_link,
        attachment_bytes = size_bytes
    );

    let payload = PlaintextPayload {
        version: 2,
        message_id: msg_id.clone(),
        content: content.clone(),
        sent_at: now,
        sender_user_id: local_user_id.clone(),
        sender_device_id: device_id.clone(),
        chain_link: new_chain_link.clone(),
        prev_chain_link: chain_head_hex.clone(),
        padding_bucket: 0,
    };

    let payload_bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let padded = dl_proto::codec::pad_to_bucket(&payload_bytes, dl_proto::codec::PaddingMode::Buckets);
    let ciphertext = aead::encrypt(&mk, &padded, session_id.as_bytes()).map_err(|e| e.to_string())?;
    let ct_b64 = base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, &ciphertext);

    let x3dh_pending: Option<(String,)> = sqlx::query_as(
        "SELECT x3dh_header_pending FROM sessions WHERE id = ? AND x3dh_header_pending IS NOT NULL"
    ).bind(&session_id).fetch_optional(&store.pool).await.map_err(|e| e.to_string())?;
    let x3dh_header: Option<x3dh::X3DHHeader> = x3dh_pending
        .and_then(|(json,)| serde_json::from_str(&json).ok());

    let envelope = Envelope {
        envelope_id: uuid::Uuid::new_v4().to_string(),
        version: 1,
        sender_id: local_user_id.clone(),
        recipient_id: peer_user_id.clone(),
        sent_at: now,
        session_id: session_id.clone(),
        ratchet_header,
        ciphertext: ct_b64,
        x3dh_header,
        chain_link: new_chain_link.clone(),
    };

    let envelope_json = serde_json::to_string(&envelope).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder().build().map_err(|e| e.to_string())?;
    let send_payload = serde_json::json!({
        "recipient_id": &peer_user_id,
        "ciphertext": envelope_json,
        "chain_link": &new_chain_link,
    });
    let mut active_token = token;
    let send_resp = client
        .post(format!("{}/send", state.rly_base_url))
        .bearer_auth(&active_token)
        .json(&send_payload)
        .send().await.map_err(|e| e.to_string())?;
    let send_resp = if send_resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        tracing::warn!(
            target: "dl_secure_channel",
            event = "send_message_unauthorized",
            kind = "attachment",
            session_id = %session_id,
            peer_user_id = %peer_user_id,
            message_id = %msg_id
        );
        active_token = refresh_access_token(&state).await
            .map_err(|e| format!("Token refresh failed: {e}"))?;
        client
            .post(format!("{}/send", state.rly_base_url))
            .bearer_auth(&active_token)
            .json(&send_payload)
            .send().await.map_err(|e| e.to_string())?
    } else { send_resp };
    let send_status = send_resp.status();
    if !send_status.is_success() {
        let b = send_resp.text().await.unwrap_or_default();
        tracing::error!(
            target: "dl_secure_channel",
            event = "send_message_failed",
            kind = "attachment",
            session_id = %session_id,
            peer_user_id = %peer_user_id,
            message_id = %msg_id,
            status = %send_status,
            body_len = b.len()
        );
        return Err(format!("Relay send failed ({send_status}): {b}"));
    }

    tracing::info!(
        target: "dl_secure_channel",
        event = "send_message_ok",
        kind = "attachment",
        session_id = %session_id,
        peer_user_id = %peer_user_id,
        message_id = %msg_id,
        status = %send_status
    );

    // ── Persist ──────────────────────────────────────────────────────────────
    let new_session_json = serde_json::to_vec(&session).map_err(|e| e.to_string())?;
    let new_session_enc = store.encrypt_value(&new_session_json).await.map_err(|e| e.to_string())?;

    sqlx::query(
        "UPDATE sessions SET session_state_enc = ?, chain_head = ?, x3dh_header_pending = NULL, updated_at = ? WHERE id = ?"
    )
    .bind(&new_session_enc).bind(&new_chain_link).bind(now.to_rfc3339()).bind(&session_id)
    .execute(&store.pool).await.map_err(|e| e.to_string())?;

    let body_enc = store.encrypt_value(&serde_json::to_vec(&content).map_err(|e| e.to_string())?)
        .await.map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO messages (id, session_id, sender_id, recipient_id, sent_at, delivery_state, message_type, body_enc, chain_link, message_n, is_outgoing) VALUES (?, ?, ?, ?, ?, 'delivered', 'attachment', ?, ?, ?, 1)"
    )
    .bind(&msg_id).bind(&session_id).bind(&local_user_id).bind(&peer_user_id)
    .bind(now.to_rfc3339()).bind(&body_enc).bind(&new_chain_link).bind(session.send_n as i64)
    .execute(&store.pool).await.map_err(|e| e.to_string())?;

    Ok(MessageDto {
        id: msg_id,
        session_id,
        sender_id: local_user_id,
        recipient_id: peer_user_id,
        sent_at: now.to_rfc3339(),
        delivery_state: "delivered".into(),
        content: serde_json::to_value(content).unwrap_or_default(),
        is_outgoing: true,
        chain_link: new_chain_link,
        ratchet_n: session.send_n,
    })
}

#[cfg(test)]
mod tests {
    use super::find_primary_session_id;
    use sqlx::sqlite::SqlitePoolOptions;

    #[tokio::test]
    async fn primary_session_selects_oldest_for_peer_pair() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect sqlite");

        sqlx::query(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                local_user_id TEXT NOT NULL,
                peer_user_id TEXT NOT NULL,
                created_at TEXT NOT NULL
            )"
        )
        .execute(&pool)
        .await
        .expect("create sessions");

        sqlx::query(
            "INSERT INTO sessions (id, local_user_id, peer_user_id, created_at) VALUES
             ('s-new', 'u1', 'u2', '2026-02-20 10:00:00'),
             ('s-old', 'u1', 'u2', '2026-02-20 09:00:00'),
             ('s-other', 'u1', 'u3', '2026-02-20 08:00:00')"
        )
        .execute(&pool)
        .await
        .expect("insert sessions");

        let sid = find_primary_session_id(&pool, "u1", "u2")
            .await
            .expect("query")
            .expect("some sid");

        assert_eq!(sid, "s-old");
    }

    #[tokio::test]
    async fn primary_session_returns_none_when_absent() {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect sqlite");

        sqlx::query(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                local_user_id TEXT NOT NULL,
                peer_user_id TEXT NOT NULL,
                created_at TEXT NOT NULL
            )"
        )
        .execute(&pool)
        .await
        .expect("create sessions");

        let sid = find_primary_session_id(&pool, "u1", "u2")
            .await
            .expect("query");

        assert!(sid.is_none());
    }
}
