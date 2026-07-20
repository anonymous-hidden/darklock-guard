data "aws_partition" "current" {}

locals {
  bucket_arn = "arn:${data.aws_partition.current.partition}:s3:::${var.bucket_name}"
  object_arn = "${local.bucket_arn}/opaque/*"
  s3_service = "s3.${var.aws_region}.${data.aws_partition.current.dns_suffix}"
  non_cryptographic_admin_principals = distinct(concat(
    var.admin_role_arns,
    var.break_glass_role_arns,
  ))
}

data "aws_iam_policy_document" "backup_key" {
  statement {
    sid    = "RootKeyPolicyRecovery"
    effect = "Allow"
    actions = [
      "kms:CancelKeyDeletion",
      "kms:DescribeKey",
      "kms:DisableKey",
      "kms:EnableKey",
      "kms:EnableKeyRotation",
      "kms:GetKeyPolicy",
      "kms:GetKeyRotationStatus",
      "kms:ListResourceTags",
      "kms:PutKeyPolicy",
      "kms:ScheduleKeyDeletion",
      "kms:TagResource",
      "kms:UntagResource",
      "kms:UpdateKeyDescription",
    ]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:${data.aws_partition.current.partition}:iam::${var.aws_account_id}:root"]
    }
  }

  dynamic "statement" {
    for_each = length(local.non_cryptographic_admin_principals) > 0 ? [1] : []
    content {
      sid    = "DenyAdministrativeCryptographicAccess"
      effect = "Deny"
      actions = [
        "kms:Decrypt",
        "kms:Encrypt",
        "kms:GenerateDataKey*",
        "kms:ReEncrypt*",
      ]
      resources = ["*"]

      principals {
        type        = "AWS"
        identifiers = local.non_cryptographic_admin_principals
      }
    }
  }

  dynamic "statement" {
    for_each = length(var.admin_role_arns) > 0 ? [1] : []
    content {
      sid    = "KeyAdministrationWithoutCryptographicAccess"
      effect = "Allow"
      actions = [
        "kms:CancelKeyDeletion",
        "kms:DescribeKey",
        "kms:EnableKey",
        "kms:EnableKeyRotation",
        "kms:GetKeyPolicy",
        "kms:GetKeyRotationStatus",
        "kms:ListResourceTags",
        "kms:PutKeyPolicy",
        "kms:TagResource",
        "kms:UntagResource",
        "kms:UpdateKeyDescription",
      ]
      resources = ["*"]

      principals {
        type        = "AWS"
        identifiers = var.admin_role_arns
      }
    }
  }

  dynamic "statement" {
    for_each = length(var.break_glass_role_arns) > 0 ? [1] : []
    content {
      sid    = "BreakGlassKeyLifecycle"
      effect = "Allow"
      actions = [
        "kms:CancelKeyDeletion",
        "kms:DescribeKey",
        "kms:DisableKey",
        "kms:EnableKey",
        "kms:ScheduleKeyDeletion",
      ]
      resources = ["*"]

      principals {
        type        = "AWS"
        identifiers = var.break_glass_role_arns
      }
    }
  }

  statement {
    sid       = "BackupWriterViaS3Only"
    effect    = "Allow"
    actions   = ["kms:GenerateDataKey"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = [var.writer_role_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = [local.s3_service]
    }

    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:s3:arn"
      values   = [local.object_arn]
    }
  }

  statement {
    sid       = "RestoreReaderViaS3Only"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = [var.restore_role_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = [local.s3_service]
    }

    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:s3:arn"
      values   = [local.object_arn]
    }
  }

  statement {
    sid       = "BackupRoleMetadata"
    effect    = "Allow"
    actions   = ["kms:DescribeKey"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = [var.writer_role_arn, var.restore_role_arn]
    }
  }
}

resource "aws_kms_key" "backup" {
  description              = "Ridgeline ${var.environment} immutable backup key"
  key_usage                = "ENCRYPT_DECRYPT"
  customer_master_key_spec = "SYMMETRIC_DEFAULT"
  enable_key_rotation      = true
  deletion_window_in_days  = 30
  policy                   = data.aws_iam_policy_document.backup_key.json

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(var.tags, {
    Environment    = var.environment
    SecurityDomain = "backup"
    DataClass      = "confidential"
  })
}

resource "aws_kms_alias" "backup" {
  name          = "alias/ridgeline-${var.environment}-backup"
  target_key_id = aws_kms_key.backup.key_id
}

resource "aws_s3_bucket" "backup" {
  bucket              = var.bucket_name
  object_lock_enabled = var.object_lock_enabled

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(var.tags, {
    Environment = var.environment
    Purpose     = "encrypted-backup"
  })
}

resource "aws_s3_bucket_public_access_block" "backup" {
  bucket = aws_s3_bucket.backup.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "backup" {
  bucket = aws_s3_bucket.backup.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "backup" {
  bucket = aws_s3_bucket.backup.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backup" {
  bucket = aws_s3_bucket.backup.id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.backup.arn
      sse_algorithm     = "aws:kms"
    }

    bucket_key_enabled = false
  }
}

resource "aws_s3_bucket_object_lock_configuration" "backup" {
  count = var.object_lock_enabled ? 1 : 0

  bucket = aws_s3_bucket.backup.id

  rule {
    default_retention {
      mode = "GOVERNANCE"
      days = var.retention_days
    }
  }

  depends_on = [aws_s3_bucket_versioning.backup]
}

resource "aws_s3_bucket_lifecycle_configuration" "backup" {
  bucket = aws_s3_bucket.backup.id

  rule {
    id     = "opaque-backup-retention"
    status = "Enabled"

    filter {
      prefix = "opaque/"
    }

    noncurrent_version_expiration {
      noncurrent_days = var.retention_days * 2
    }
  }

  depends_on = [aws_s3_bucket_versioning.backup]
}

data "aws_iam_policy_document" "bucket" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [local.bucket_arn, "${local.bucket_arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid       = "DenyMissingKmsEncryption"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = [local.object_arn]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption"
      values   = ["aws:kms"]
    }
  }

  statement {
    sid       = "DenyWrongKmsKey"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = [local.object_arn]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption-aws-kms-key-id"
      values   = [aws_kms_key.backup.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "backup" {
  bucket = aws_s3_bucket.backup.id
  policy = data.aws_iam_policy_document.bucket.json

  depends_on = [aws_s3_bucket_public_access_block.backup]
}

data "aws_iam_policy_document" "writer" {
  statement {
    sid       = "WriteOpaqueBackups"
    effect    = "Allow"
    actions   = ["s3:AbortMultipartUpload", "s3:ListMultipartUploadParts", "s3:PutObject"]
    resources = [local.object_arn]
  }

  statement {
    sid       = "ListMultipartUploadsOnly"
    effect    = "Allow"
    actions   = ["s3:ListBucketMultipartUploads"]
    resources = [local.bucket_arn]
  }

  statement {
    sid       = "GenerateBackupDataKeys"
    effect    = "Allow"
    actions   = ["kms:GenerateDataKey"]
    resources = [aws_kms_key.backup.arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = [local.s3_service]
    }
  }

  statement {
    sid       = "DescribeBackupKey"
    effect    = "Allow"
    actions   = ["kms:DescribeKey"]
    resources = [aws_kms_key.backup.arn]
  }
}

resource "aws_iam_role_policy" "writer" {
  name   = "ridgeline-${var.environment}-backup-write-only"
  role   = var.writer_role_name
  policy = data.aws_iam_policy_document.writer.json
}

data "aws_iam_policy_document" "restore" {
  statement {
    sid       = "ReadOpaqueBackups"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:GetObjectVersion"]
    resources = [local.object_arn]
  }

  statement {
    sid       = "ListOpaqueBackups"
    effect    = "Allow"
    actions   = ["s3:ListBucket", "s3:ListBucketVersions"]
    resources = [local.bucket_arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["opaque/*"]
    }
  }

  statement {
    sid       = "DecryptBackupObjects"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.backup.arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = [local.s3_service]
    }
  }

  statement {
    sid       = "DescribeBackupKey"
    effect    = "Allow"
    actions   = ["kms:DescribeKey"]
    resources = [aws_kms_key.backup.arn]
  }

  statement {
    sid       = "PublishRestoreValidationFailure"
    effect    = "Allow"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["Ridgeline/Backup"]
    }
  }
}

resource "aws_iam_role_policy" "restore" {
  name   = "ridgeline-${var.environment}-backup-restore-read-only"
  role   = var.restore_role_name
  policy = data.aws_iam_policy_document.restore.json
}
