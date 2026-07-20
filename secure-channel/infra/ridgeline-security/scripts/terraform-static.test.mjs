import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(path.join(root, relative), "utf8");

test("providers are pinned and production cannot apply without approval", async () => {
  const [staging, production, productionMain] = await Promise.all([
    read("terraform/environments/staging/versions.tf"),
    read("terraform/environments/production/versions.tf"),
    read("terraform/environments/production/main.tf"),
  ]);
  assert.match(staging, /version\s*=\s*"= 6\.53\.0"/);
  assert.match(production, /version\s*=\s*"= 6\.53\.0"/);
  assert.match(productionMain, /production_apply_guard/);
  assert.match(productionMain, /precondition/);
  assert.match(productionMain, /CHG-/);
  assert.match(productionMain, /migration_enabled\s*=\s*false/);
});

test("five security domains exist while RLY receives no KMS mapping", async () => {
  const [kms, backup, environment] = await Promise.all([
    read("terraform/modules/kms/main.tf"),
    read("terraform/modules/backup/main.tf"),
    read("terraform/modules/environment/main.tf"),
  ]);
  for (const domain of ["auth", "profile-settings", "integrations", "media"]) {
    assert.match(kms, new RegExp(domain.replace("-", "\\-")));
  }
  assert.match(backup, /alias\/ridgeline-\$\{var\.environment\}-backup/);
  const mappings = environment.match(/runtime_role_arns_by_domain\s*=\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";
  assert.doesNotMatch(mappings, /rly/i);
});

test("backup policy enforces private exact-key SSE-KMS and separate role capabilities", async () => {
  const backup = await read("terraform/modules/backup/main.tf");
  assert.match(backup, /DenyInsecureTransport/);
  assert.match(backup, /DenyMissingKmsEncryption/);
  assert.match(backup, /DenyWrongKmsKey/);
  assert.match(backup, /object_lock_enabled/);
  assert.match(backup, /backup-write-only/);
  assert.match(backup, /backup-restore-read-only/);
  assert.match(backup, /DenyAdministrativeCryptographicAccess/);
  assert.doesNotMatch(backup, /actions\s*=\s*\["kms:\*"\]/);
});

test("record KMS permissions require stable encryption context", async () => {
  const kms = await read("terraform/modules/kms/main.tf");
  for (const key of ["application", "environment", "domain", "schemaVersion", "service"]) {
    assert.match(kms, new RegExp(`kms:EncryptionContext:${key}`));
  }
  assert.match(kms, /ForAllValues:StringEquals/);
  assert.doesNotMatch(kms, /actions\s*=\s*\["kms:\*"\]/);
  assert.match(kms, /DenyAdministrativeCryptographicAccess/);
  assert.doesNotMatch(kms.match(/KeyAdministrationWithoutCryptographicAccess([\s\S]*?)resources/)?.[1] ?? "", /Decrypt|GenerateDataKey/);
});

test("workload trust is account, trust-anchor, issuer, and subject bound", async () => {
  const iam = await read("terraform/modules/iam/main.tf");
  assert.match(iam, /aws:SourceArn/);
  assert.match(iam, /aws:SourceAccount/);
  assert.match(iam, /aws:PrincipalTag\/x509Issuer\/CN/);
  assert.match(iam, /aws:PrincipalTag\/x509Subject\/CN/);
  assert.match(iam, /RidgelineMfaAuthenticated|operator_mfa_principal_tag/);
});

test("audit layer records backup data events and alarms on required security signals", async () => {
  const audit = await read("terraform/modules/audit/main.tf");
  for (const signal of [
    "key_lifecycle",
    "kms_access_denied",
    "roles_anywhere_denied",
    "backup_write_failure",
    "unusual_decrypt_volume",
    "restore_validation_failure",
  ]) {
    assert.match(audit, new RegExp(signal));
  }
  assert.match(audit, /AWS::S3::Object/);
  assert.match(audit, /enable_log_file_validation\s*=\s*true/);
  assert.match(audit, /kms_master_key_id\s*=\s*"alias\/aws\/sns"/);
});
