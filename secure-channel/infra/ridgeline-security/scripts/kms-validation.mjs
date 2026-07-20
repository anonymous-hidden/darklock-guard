import {
  DecryptCommand,
  GenerateDataKeyCommand,
  GetKeyPolicyCommand,
  KMSClient,
} from "@aws-sdk/client-kms";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import {
  buildEncryptionContext,
  runAllowedValidation,
  runDeniedOnlyValidation,
} from "./kms-validation-lib.mjs";

const commands = { DecryptCommand, GenerateDataKeyCommand, GetKeyPolicyCommand };
const allowedModes = new Set(["allowed", "denied-only"]);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

function logCode(code) {
  process.stdout.write(`${code}\n`);
}

async function main() {
  const environment = required("RIDGELINE_ENVIRONMENT");
  const service = required("RIDGELINE_SERVICE");
  const domain = required("RIDGELINE_DOMAIN");
  const keyArn = required("RIDGELINE_KMS_KEY_ARN");
  const mode = process.env.RIDGELINE_VALIDATION_MODE?.trim() || "allowed";
  if (!allowedModes.has(mode)) throw new Error("INVALID_VALIDATION_MODE");

  const context = buildEncryptionContext({ environment, service, domain });
  const region = required("AWS_REGION");
  const kms = new KMSClient({ region });
  const sts = new STSClient({ region });

  await sts.send(new GetCallerIdentityCommand({}));
  logCode("TEMPORARY_CALLER_IDENTITY_OK");

  if (mode === "denied-only") {
    await runDeniedOnlyValidation({ kms, commands, keyArn, context, logger: logCode });
  } else {
    await runAllowedValidation({ kms, commands, keyArn, context, logger: logCode });
  }
  logCode("KMS_VALIDATION_COMPLETE");
}

main().catch((error) => {
  const code = typeof error?.message === "string" && /^[A-Z0-9_]+$/.test(error.message)
    ? error.message
    : "KMS_VALIDATION_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
