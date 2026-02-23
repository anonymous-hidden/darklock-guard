//! Tauri application entry for Darklock Secure Channel.

mod commands;
mod security_check;
mod state;

use std::sync::Arc;
use tokio::sync::Mutex;

use dl_store::vault::Vault;

pub use state::AppState;

pub fn run() {
    // Initialise structured logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| {
                    // Default to our Tauri lib crate + store logs.
                    // Note: package name `dl-secure-channel` becomes `dl_secure_channel`,
                    // but this crate is explicitly named `dl_secure_channel_lib`.
                    "dl_secure_channel_lib=info,dl_secure_channel=info,dl_store=info".into()
                }),
        )
        .init();

    let vault = Vault::new();
    let app_state = AppState {
        vault: vault.clone(),
        store: Arc::new(Mutex::new(None)), // populated after login
        api_base_url: std::env::var("DL_IDS_URL")
            .unwrap_or_else(|_| "https://ids.darklock.net".to_string()),
        rly_base_url: std::env::var("DL_RLY_URL")
            .unwrap_or_else(|_| "https://rly.darklock.net".to_string()),
        access_token: Arc::new(Mutex::new(None)),
        refresh_token: Arc::new(Mutex::new(None)),
        system_role: Arc::new(Mutex::new(None)),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        // .plugin(tauri_plugin_updater::Builder::new().build()) // enable after setting up update server
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // Auth
            commands::auth::cmd_register,
            commands::auth::cmd_login,
            commands::auth::cmd_logout,
            commands::auth::cmd_refresh_token,
            commands::auth::cmd_enroll_device,
            // Security check
            commands::security::cmd_run_security_check,
            // Contacts
            commands::contacts::cmd_get_contacts,
            commands::contacts::cmd_sync_contacts,
            commands::contacts::cmd_verify_contact,
            commands::contacts::cmd_get_user_keys,
            commands::contacts::cmd_send_friend_request,
            commands::contacts::cmd_get_pending_requests,
            commands::contacts::cmd_respond_friend_request,
            commands::contacts::cmd_cancel_friend_request,
            // Messaging
            commands::messaging::cmd_start_session,
            commands::messaging::cmd_send_message,
            commands::messaging::cmd_poll_inbox,
            commands::messaging::cmd_get_messages,
            commands::messaging::cmd_send_attachment,
            // Groups (stubbed in v1)
            commands::groups::cmd_create_group,
            commands::groups::cmd_get_groups,
            // Servers & Roles (v2)
            commands::servers::cmd_create_server,
            commands::servers::cmd_get_servers,
            commands::servers::cmd_get_server,
            commands::servers::cmd_update_server,
            commands::servers::cmd_delete_server,
            commands::servers::cmd_get_server_members,
            commands::servers::cmd_add_server_member,
            commands::servers::cmd_remove_server_member,
            commands::servers::cmd_get_channels,
            commands::servers::cmd_create_channel,
            commands::servers::cmd_update_channel,
            commands::servers::cmd_delete_channel,
            commands::servers::cmd_reorder_channels,
            commands::servers::cmd_get_roles,
            commands::servers::cmd_create_role,
            commands::servers::cmd_update_role,
            commands::servers::cmd_delete_role,
            commands::servers::cmd_reorder_roles,
            commands::servers::cmd_assign_role,
            commands::servers::cmd_remove_role,
            commands::servers::cmd_get_channel_overrides,
            commands::servers::cmd_set_channel_override,
            commands::servers::cmd_delete_channel_override,
            commands::servers::cmd_get_audit_log,
            // Secure Channels (RBAC)
            commands::servers::cmd_set_channel_secure,
            commands::servers::cmd_remove_channel_secure,
            commands::servers::cmd_trigger_lockdown,
            commands::servers::cmd_release_lockdown,
            commands::servers::cmd_get_secure_audit,
            // Security Alerts
            commands::servers::cmd_create_security_alert,
            commands::servers::cmd_get_security_alerts,
            commands::servers::cmd_resolve_security_alert,
            commands::servers::cmd_get_security_audit,
            // Profile
            commands::profile::cmd_get_profile,
            commands::profile::cmd_rotate_device_key,
            commands::profile::cmd_update_profile,
            commands::profile::cmd_remove_device,
            commands::profile::cmd_export_identity_key,
            commands::profile::cmd_get_contact_profile,
            commands::profile::cmd_update_public_profile,
            // Auth — password change
            commands::auth::cmd_change_password,
            // Settings
            commands::settings::cmd_get_settings,
            commands::settings::cmd_set_setting,
            // Vault
            commands::vault::cmd_lock_vault,
            commands::vault::cmd_unlock_vault,
            commands::vault::cmd_clear_local_cache,
            commands::vault::cmd_reset_vault,
            commands::vault::cmd_export_backup,
            // Presence
            commands::presence::cmd_presence_heartbeat,
            commands::presence::cmd_get_presence,
            commands::presence::cmd_get_batch_presence,
            commands::presence::cmd_set_presence_status,
            // Invites
            commands::invites::cmd_create_invite,
            commands::invites::cmd_get_invites,
            commands::invites::cmd_revoke_invite,
            commands::invites::cmd_get_invite_info,
            commands::invites::cmd_join_via_invite,
            // AutoMod
            commands::automod::cmd_get_automod_rules,
            commands::automod::cmd_create_automod_rule,
            commands::automod::cmd_update_automod_rule,
            commands::automod::cmd_delete_automod_rule,
            commands::automod::cmd_get_automod_events,
            // Pins
            commands::pins::cmd_pin_dm_message,
            commands::pins::cmd_unpin_dm_message,
            commands::pins::cmd_get_dm_pins,
            commands::pins::cmd_pin_server_message,
            commands::pins::cmd_get_server_pins,
            commands::pins::cmd_unpin_server_message,
            // Channel messages
            commands::channel_messages::cmd_get_channel_messages,
            commands::channel_messages::cmd_send_channel_message,
            commands::channel_messages::cmd_edit_channel_message,
            commands::channel_messages::cmd_delete_channel_message,
            commands::channel_messages::cmd_mark_channel_read,
            commands::channel_messages::cmd_get_server_unread,
            commands::channel_messages::cmd_get_mention_notifications,
            commands::channel_messages::cmd_mark_mentions_read,
            // Voice rooms
            commands::voice::cmd_join_voice_channel,
            commands::voice::cmd_leave_voice_channel,
            commands::voice::cmd_get_voice_members,
            commands::voice::cmd_update_voice_state,
            commands::voice::cmd_get_server_voice_state,
            commands::voice::cmd_voice_heartbeat,
            commands::voice::cmd_stage_request_speak,
            commands::voice::cmd_stage_promote,
            commands::voice::cmd_stage_demote,
            commands::voice::cmd_get_realtime_token,
            commands::voice::cmd_get_ids_base_url,
            // User tags
            commands::tags::cmd_get_my_tags,
            commands::tags::cmd_update_selected_tags,
            commands::tags::cmd_get_user_tags,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Darklock Secure Channel");
}
