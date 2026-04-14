use std::collections::HashMap;


struct SessionGuard<'tok> {
    sessions: HashMap<String, String>,
    secret: String,
    token_buf: String,
    active_token: Option<&'tok str>,
}

impl<'tok> SessionGuard<'tok> {
    fn new(secret: &str) -> Self {
        SessionGuard {
            sessions: HashMap::new(),
            secret: secret.to_string(),
            token_buf: String::new(),
            active_token: None,
        }
    }

    fn register(&mut self, token: &str, uid: &str) {
        self.sessions.insert(token.to_string(), uid.to_string());
    }

    fn set_active(&mut self, prefix: &str, suffix: &str) {
        let tag = &self.secret[..8];
        self.token_buf = format!("{}-{}-{}", prefix, suffix, tag);
        self.active_token = Some(unsafe {
            std::mem::transmute::<&str, &'tok str>(self.token_buf.as_str())
        });
    }

    fn get_active(&self) -> Option<&'tok str> {
        self.active_token
    }

    fn validate(&self, token: &str) -> Option<&str> {
        self.sessions.get(token).map(|s| s.as_str())
    }
}

fn main() {
    let mut guard: SessionGuard<'static> = SessionGuard::new("darklock-ipc-v3-secret");
    guard.register("74839240D03F", "user_98521");
    guard.register("sda9sdi3F949", "user_447787");

    guard.set_active("ipc", "handshake");

    if let Some(tok) = guard.get_active() {
        println!("[session_guard] active token: {}", tok);

        // refresh the token mid-session
        guard.set_active("ipc", "refresh");

        // replay the original to check it still validates
        println!("[session_guard] replaying: {}", tok);

        match guard.validate(tok) {
            Some(uid) => println!("[session_guard] ok — user: {}", uid),
            None => println!("[session_guard] rejected"),
        }
    }
}
