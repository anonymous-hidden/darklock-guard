//! dl_proto — Wire types, envelopes, and serialisation for Darklock Secure Channel
//!
//! All on-wire types are serialised to JSON (or msgpack in v2) and
//! versioned to allow future format changes without breaking compatibility.
//!
//! # Modules
//! - `envelope` — Encrypted message envelope (what the relay sees)
//! - `message`  — Plaintext message types (inside the encrypted envelope)
//! - `group`    — Signed group state with epochs
//! - `codec`    — Padding, batching, and wire framing
//! - `api`      — API request/response types shared between clients and services

pub mod api;
pub mod codec;
pub mod envelope;
pub mod group;
pub mod message;

pub use codec::{PaddingMode, BatchingMode};
pub use envelope::Envelope;
pub use group::{GroupState, EpochChange};
pub use message::{MessageContent, MessageType, DeliveryState};
