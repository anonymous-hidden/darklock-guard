use guard_core::vault::SecurityProfile;
use std::collections::HashSet;

#[derive(Debug, Default)]
pub struct NonceBook {
    seen: HashSet<String>,
}

impl NonceBook {
    pub fn check_and_store(&mut self, nonce: &str) -> Result<(), String> {
        if self.seen.contains(nonce) {
            return Err("replay".to_string());
        }
        self.seen.insert(nonce.to_string());
        Ok(())
    }
}

#[derive(Debug)]
pub struct ConnectedState {
    pub security_profile: SecurityProfile,
    nonce_book: NonceBook,
}

impl ConnectedState {
    pub fn new(security_profile: SecurityProfile) -> Self {
        Self {
            security_profile,
            nonce_book: NonceBook::default(),
        }
    }

    pub fn take_nonce_book(&mut self) -> NonceBook {
        std::mem::take(&mut self.nonce_book)
    }
}
