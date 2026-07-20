import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const RECORD_DOMAINS = new Set([
  "auth",
  "profile-settings",
  "integrations",
  "media",
]);

const CONTEXT_KEYS = [
  "application",
  "domain",
  "environment",
  "schemaVersion",
  "service",
];

export function buildEncryptionContext({ environment, service, domain }) {
  if (environment !== "staging") {
    throw new Error("VALIDATION_REQUIRES_STAGING");
  }
  if (!RECORD_DOMAINS.has(domain)) {
    throw new Error("INVALID_RECORD_DOMAIN");
  }
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(service)) {
    throw new Error("INVALID_SERVICE_NAME");
  }

  return {
    application: "ridgeline",
    domain,
    environment,
    schemaVersion: "1",
    service,
  };
}

function contextAad(context) {
  const exactContext = {};
  for (const key of CONTEXT_KEYS) {
    if (typeof context[key] !== "string" || context[key].length === 0) {
      throw new Error("INCOMPLETE_ENCRYPTION_CONTEXT");
    }
    exactContext[key] = context[key];
  }
  if (Object.keys(context).length !== CONTEXT_KEYS.length) {
    throw new Error("UNEXPECTED_ENCRYPTION_CONTEXT_KEY");
  }
  return Buffer.from(JSON.stringify(exactContext), "utf8");
}

function zeroBytes(bytes) {
  if (bytes && typeof bytes.fill === "function") {
    bytes.fill(0);
  }
}

export async function envelopeEncrypt({ kms, commands, keyArn, context, plaintext }) {
  const response = await kms.send(new commands.GenerateDataKeyCommand({
    KeyId: keyArn,
    KeySpec: "AES_256",
    EncryptionContext: context,
  }));

  if (!response.Plaintext || !response.CiphertextBlob) {
    throw new Error("KMS_GENERATE_DATA_KEY_INCOMPLETE");
  }

  const responsePlaintext = response.Plaintext;
  const dataKey = Buffer.from(responsePlaintext);
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dataKey, nonce);
    cipher.setAAD(contextAad(context));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      encryptedDataKey: Buffer.from(response.CiphertextBlob),
      nonce,
      tag: cipher.getAuthTag(),
      ciphertext,
    };
  } finally {
    zeroBytes(dataKey);
    zeroBytes(responsePlaintext);
  }
}

export async function envelopeDecrypt({ kms, commands, context, envelope }) {
  const response = await kms.send(new commands.DecryptCommand({
    CiphertextBlob: envelope.encryptedDataKey,
    EncryptionContext: context,
  }));

  if (!response.Plaintext) {
    throw new Error("KMS_DECRYPT_INCOMPLETE");
  }

  const responsePlaintext = response.Plaintext;
  const dataKey = Buffer.from(responsePlaintext);
  try {
    const decipher = createDecipheriv("aes-256-gcm", dataKey, envelope.nonce);
    decipher.setAAD(contextAad(context));
    decipher.setAuthTag(envelope.tag);
    return Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
  } finally {
    zeroBytes(dataKey);
    zeroBytes(responsePlaintext);
  }
}

function hasAcceptedErrorCode(error, acceptedCodes) {
  const candidates = [error?.name, error?.Code, error?.code, error?.message].filter(Boolean);
  return candidates.some((candidate) => acceptedCodes.includes(candidate));
}

export async function expectDenied(
  operation,
  code,
  logger,
  acceptedCodes = ["AccessDenied", "AccessDeniedException", "UnauthorizedOperation"],
) {
  try {
    await operation();
  } catch (error) {
    if (hasAcceptedErrorCode(error, acceptedCodes) || error?.$metadata?.httpStatusCode === 403) {
      logger(code);
      return;
    }
    throw error;
  }
  throw new Error(`${code}_UNEXPECTEDLY_ALLOWED`);
}

export async function runAllowedValidation({ kms, commands, keyArn, context, logger }) {
  const synthetic = randomBytes(96);
  const envelope = await envelopeEncrypt({
    kms,
    commands,
    keyArn,
    context,
    plaintext: synthetic,
  });
  const recovered = await envelopeDecrypt({ kms, commands, context, envelope });
  if (synthetic.length !== recovered.length || !timingSafeEqual(synthetic, recovered)) {
    throw new Error("KMS_ROUND_TRIP_MISMATCH");
  }
  logger("KMS_ROUND_TRIP_OK");

  await expectDenied(
    () => kms.send(new commands.DecryptCommand({
      CiphertextBlob: envelope.encryptedDataKey,
      EncryptionContext: { ...context, domain: "wrong-domain" },
    })),
    "KMS_WRONG_CONTEXT_DENIED",
    logger,
    ["AccessDenied", "AccessDeniedException", "InvalidCiphertextException"],
  );

  await expectDenied(
    () => kms.send(new commands.GetKeyPolicyCommand({
      KeyId: keyArn,
      PolicyName: "default",
    })),
    "KMS_RUNTIME_ADMIN_DENIED",
    logger,
  );

  synthetic.fill(0);
  recovered.fill(0);
}

export async function runDeniedOnlyValidation({ kms, commands, keyArn, context, logger }) {
  await expectDenied(
    () => kms.send(new commands.GenerateDataKeyCommand({
      KeyId: keyArn,
      KeySpec: "AES_256",
      EncryptionContext: context,
    })),
    "KMS_UNAUTHORIZED_ROLE_DENIED",
    logger,
  );
}
