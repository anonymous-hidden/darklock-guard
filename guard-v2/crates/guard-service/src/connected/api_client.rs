use crate::connected::commands::ServerCommand;
use anyhow::{anyhow, Result};
use reqwest::StatusCode;
use serde_json::Value;

#[derive(Clone)]
pub struct ApiClient {
    client: reqwest::Client,
    base_url: String,
    token: String,
}

impl ApiClient {
    pub fn new(config: &crate::connected::ConnectedConfig) -> Self {
        let client = reqwest::Client::builder()
            .user_agent("guard-service-connected/0.1")
            .build()
            .expect("reqwest client");
        Self {
            client,
            base_url: config.api_base_url.clone(),
            token: config.api_token.clone(),
        }
    }

    pub async fn send_heartbeat(&self, device_id: &str) -> Result<()> {
        let url = format!("{}/api/devices/{}/heartbeat", self.base_url, device_id);
        let res = self
            .client
            .post(url)
            .bearer_auth(&self.token)
            .json(&serde_json::json!({"status": "ok"}))
            .send()
            .await?;
        if res.status().is_success() {
            return Ok(());
        }
        Err(anyhow!("heartbeat failed with status {}", res.status()))
    }

    pub async fn fetch_pending_commands(&self, device_id: &str) -> Result<Vec<ServerCommand>> {
        let url = format!(
            "{}/api/devices/{}/pending-commands",
            self.base_url, device_id
        );
        let res = self.client.get(url).bearer_auth(&self.token).send().await?;
        if res.status() == StatusCode::NOT_FOUND {
            return Ok(vec![]);
        }
        if !res.status().is_success() {
            return Err(anyhow!("commands fetch failed: {}", res.status()));
        }
        let body: Value = res.json().await?;
        let cmds = body
            .get("commands")
            .and_then(|c| c.as_array())
            .cloned()
            .unwrap_or_default();
        let mut out = Vec::new();
        for c in cmds {
            if let Ok(cmd) = ServerCommand::try_from(c) {
                out.push(cmd);
            }
        }
        Ok(out)
    }

    pub async fn submit_result(
        &self,
        device_id: &str,
        command_id: &str,
        status: &str,
        nonce: &str,
        signature: Option<String>,
        result: Option<Value>,
        error: Option<String>,
    ) -> Result<()> {
        let url = format!(
            "{}/api/devices/{}/commands/{}/result",
            self.base_url, device_id, command_id
        );
        let res = self
            .client
            .post(url)
            .bearer_auth(&self.token)
            .json(&serde_json::json!({
                "status": status,
                "nonce": nonce,
                "signature": signature.unwrap_or_default(),
                "result": result,
                "error": error
            }))
            .send()
            .await?;
        if res.status().is_success() {
            return Ok(());
        }
        Err(anyhow!("submit result failed: {}", res.status()))
    }
}
