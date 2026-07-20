# Ridgeline Phase 1 Security Containment

Ridgeline currently supports tested end-to-end encryption for direct-message
envelopes only. Group messaging is disabled by the client, IDS, and relay until
an authenticated group protocol and authoritative membership enforcement are
implemented. Message editing and deletion are also disabled at the transport
boundary during this containment phase.

New direct messages require the version 1 encrypted envelope. Plaintext,
malformed, and unknown-version direct messages are rejected. There is no active
legacy plaintext compatibility mode. The documented removal target for any
future compatibility bridge is Ridgeline 2.2.0, no later than 2026-09-01.

Encrypted sync, encrypted local message storage, and encrypted group
attachments are not implemented and must not be claimed by the product.

## Phase 2 Blockers

- TOTP secrets remain blocked on a centralized envelope-encryption service.
  Phase 1 does not add temporary application encryption keys.
- Group messaging remains blocked pending a reviewed group protocol, sender
  authorization, membership epochs, removal handling, and migration design.
- Message edit/delete transport remains blocked pending authenticated event
  semantics.
- Encrypted sync and encrypted local message storage require a separately
  reviewed key hierarchy and migration plan.
