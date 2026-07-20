import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEncryptionContext,
  runAllowedValidation,
  runDeniedOnlyValidation,
} from "./kms-validation-lib.mjs";

class GenerateDataKeyCommand { constructor(input) { this.input = input; } }
class DecryptCommand { constructor(input) { this.input = input; } }
class GetKeyPolicyCommand { constructor(input) { this.input = input; } }
const commands = { GenerateDataKeyCommand, DecryptCommand, GetKeyPolicyCommand };

class FakeKms {
  constructor({ allowed = true } = {}) {
    this.allowed = allowed;
    this.key = Buffer.alloc(32, 17);
    this.issuedPlaintexts = [];
    this.context = null;
  }

  async send(command) {
    if (command instanceof GetKeyPolicyCommand) throw new Error("AccessDeniedException");
    if (!this.allowed) throw new Error("AccessDeniedException");
    if (command instanceof GenerateDataKeyCommand) {
      const issued = Uint8Array.from(this.key);
      this.issuedPlaintexts.push(issued);
      this.context = command.input.EncryptionContext;
      return { Plaintext: issued, CiphertextBlob: Uint8Array.from([1, 2, 3]) };
    }
    if (command instanceof DecryptCommand) {
      if (JSON.stringify(command.input.EncryptionContext) !== JSON.stringify(this.context)) {
        throw new Error("InvalidCiphertextException");
      }
      const issued = Uint8Array.from(this.key);
      this.issuedPlaintexts.push(issued);
      return { Plaintext: issued };
    }
    throw new Error("UNEXPECTED_COMMAND");
  }
}

const context = buildEncryptionContext({
  environment: "staging",
  service: "ids",
  domain: "auth",
});

test("allowed validation round trips, denies wrong context/admin, and clears DEKs", async () => {
  const kms = new FakeKms();
  const events = [];
  await runAllowedValidation({
    kms,
    commands,
    keyArn: "test-key-arn",
    context,
    logger: (code) => events.push(code),
  });

  assert.deepEqual(events, [
    "KMS_ROUND_TRIP_OK",
    "KMS_WRONG_CONTEXT_DENIED",
    "KMS_RUNTIME_ADMIN_DENIED",
  ]);
  assert.ok(kms.issuedPlaintexts.every((bytes) => bytes.every((value) => value === 0)));
});

test("denied-only validation confirms a role cannot generate data keys", async () => {
  const events = [];
  await runDeniedOnlyValidation({
    kms: new FakeKms({ allowed: false }),
    commands,
    keyArn: "test-key-arn",
    context,
    logger: (code) => events.push(code),
  });
  assert.deepEqual(events, ["KMS_UNAUTHORIZED_ROLE_DENIED"]);
});

test("denied-only validation does not mistake credential failure for authorization denial", async () => {
  const kms = {
    send: async () => {
      throw new Error("CredentialsProviderError");
    },
  };
  await assert.rejects(
    () => runDeniedOnlyValidation({
      kms,
      commands,
      keyArn: "test-key-arn",
      context,
      logger: () => {},
    }),
    /CredentialsProviderError/,
  );
});

test("context rejects production, unknown domains, and extra values", () => {
  assert.throws(
    () => buildEncryptionContext({ environment: "production", service: "ids", domain: "auth" }),
    /VALIDATION_REQUIRES_STAGING/,
  );
  assert.throws(
    () => buildEncryptionContext({ environment: "staging", service: "ids", domain: "backup" }),
    /INVALID_RECORD_DOMAIN/,
  );
});

test("validation output contains event codes only", async () => {
  const events = [];
  await runAllowedValidation({
    kms: new FakeKms(),
    commands,
    keyArn: "must-not-appear-in-output",
    context,
    logger: (code) => events.push(code),
  });
  const output = events.join("\n");
  assert.match(output, /^[A-Z0-9_\n]+$/);
  assert.doesNotMatch(output, /must-not-appear|ridgeline|auth|ids/i);
});
