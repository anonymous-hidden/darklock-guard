import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { fromIni } from "@aws-sdk/credential-providers";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`MISSING_${name}`);
  return value;
}

function logCode(code) {
  process.stdout.write(`${code}\n`);
}

async function expectDenied(operation, code) {
  try {
    await operation();
  } catch (error) {
    const acceptedCodes = ["AccessDenied", "AccessDeniedException", "UnauthorizedOperation"];
    const errorCodes = [error?.name, error?.Code, error?.code, error?.message].filter(Boolean);
    if (errorCodes.some((errorCode) => acceptedCodes.includes(errorCode))
      || error?.$metadata?.httpStatusCode === 403) {
      logCode(code);
      return;
    }
    throw error;
  }
  throw new Error(`${code}_UNEXPECTEDLY_ALLOWED`);
}

async function publishFailureMetric() {
  const region = process.env.AWS_REGION?.trim();
  const restoreProfile = process.env.RIDGELINE_BACKUP_RESTORE_PROFILE?.trim();
  if (!region || !restoreProfile) return;

  const cloudwatch = new CloudWatchClient({
    region,
    credentials: fromIni({ profile: restoreProfile }),
  });
  await cloudwatch.send(new PutMetricDataCommand({
    Namespace: "Ridgeline/Backup",
    MetricData: [{
      MetricName: "RestoreValidationFailure",
      Value: 1,
      Unit: "Count",
    }],
  }));
}

async function main() {
  if (required("RIDGELINE_ENVIRONMENT") !== "staging") {
    throw new Error("VALIDATION_REQUIRES_STAGING");
  }

  const region = required("AWS_REGION");
  const bucket = required("RIDGELINE_BACKUP_BUCKET");
  const keyArn = required("RIDGELINE_BACKUP_KMS_KEY_ARN");
  const writerProfile = required("RIDGELINE_BACKUP_WRITER_PROFILE");
  const restoreProfile = required("RIDGELINE_BACKUP_RESTORE_PROFILE");
  const objectKey = `opaque/restore-validation/${randomUUID()}.bin`;
  const synthetic = randomBytes(4096);

  const writer = new S3Client({ region, credentials: fromIni({ profile: writerProfile }) });
  const restore = new S3Client({ region, credentials: fromIni({ profile: restoreProfile }) });

  await writer.send(new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    Body: synthetic,
    ServerSideEncryption: "aws:kms",
    SSEKMSKeyId: keyArn,
    ContentType: "application/octet-stream",
  }));
  logCode("BACKUP_WRITE_OK");

  await expectDenied(
    () => writer.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey })),
    "BACKUP_WRITER_READ_DENIED",
  );

  const metadata = await restore.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
  if (metadata.ServerSideEncryption !== "aws:kms" || metadata.SSEKMSKeyId !== keyArn) {
    throw new Error("BACKUP_SSE_KMS_ASSERTION_FAILED");
  }
  logCode("BACKUP_EXACT_KMS_KEY_OK");

  const restored = await restore.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
  const bytes = Buffer.from(await restored.Body.transformToByteArray());
  if (bytes.length !== synthetic.length || !timingSafeEqual(bytes, synthetic)) {
    throw new Error("BACKUP_RESTORE_MISMATCH");
  }
  logCode("BACKUP_RESTORE_OK");

  await expectDenied(
    () => restore.send(new PutObjectCommand({
      Bucket: bucket,
      Key: `opaque/restore-validation/${randomUUID()}.bin`,
      Body: randomBytes(32),
      ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: keyArn,
    })),
    "BACKUP_RESTORE_WRITE_DENIED",
  );

  synthetic.fill(0);
  bytes.fill(0);
  logCode("BACKUP_VALIDATION_COMPLETE");
}

main().catch(async (error) => {
  try {
    await publishFailureMetric();
  } catch {
    process.stderr.write("BACKUP_FAILURE_METRIC_FAILED\n");
  }
  const code = typeof error?.message === "string" && /^[A-Z0-9_]+$/.test(error.message)
    ? error.message
    : "BACKUP_VALIDATION_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
