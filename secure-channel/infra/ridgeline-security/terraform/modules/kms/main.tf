data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  domains = toset([
    "auth",
    "profile-settings",
    "integrations",
    "media",
  ])

  domain_runtime_service = {
    auth             = "ids"
    profile-settings = "ids"
    integrations     = "integrations"
    media            = "media"
  }

  runtime_principals = {
    for domain in local.domains : domain => distinct(lookup(var.runtime_role_arns_by_domain, domain, []))
  }

  non_cryptographic_admin_principals = distinct(concat(
    var.admin_role_arns,
    var.break_glass_role_arns,
  ))
}

data "aws_iam_policy_document" "key" {
  for_each = local.domains

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
      identifiers = ["arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:root"]
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

  dynamic "statement" {
    for_each = length(local.runtime_principals[each.key]) > 0 ? [1] : []
    content {
      sid    = "RuntimeEnvelopeOperations"
      effect = "Allow"
      actions = [
        "kms:Decrypt",
        "kms:GenerateDataKey",
      ]
      resources = ["*"]

      principals {
        type        = "AWS"
        identifiers = local.runtime_principals[each.key]
      }

      condition {
        test     = "StringEquals"
        variable = "kms:EncryptionContext:application"
        values   = ["ridgeline"]
      }

      condition {
        test     = "StringEquals"
        variable = "kms:EncryptionContext:environment"
        values   = [var.environment]
      }

      condition {
        test     = "StringEquals"
        variable = "kms:EncryptionContext:domain"
        values   = [each.key]
      }

      condition {
        test     = "StringEquals"
        variable = "kms:EncryptionContext:schemaVersion"
        values   = ["1"]
      }

      condition {
        test     = "StringEquals"
        variable = "kms:EncryptionContext:service"
        values   = [local.domain_runtime_service[each.key]]
      }

      condition {
        test     = "ForAllValues:StringEquals"
        variable = "kms:EncryptionContextKeys"
        values = [
          "application",
          "domain",
          "environment",
          "schemaVersion",
          "service",
        ]
      }
    }
  }

  dynamic "statement" {
    for_each = var.migration_enabled && var.migration_role_arn != null ? [1] : []
    content {
      sid    = "TemporaryMigrationEnvelopeOperations"
      effect = "Allow"
      actions = [
        "kms:Decrypt",
        "kms:GenerateDataKey",
      ]
      resources = ["*"]

      principals {
        type        = "AWS"
        identifiers = [var.migration_role_arn]
      }

      condition {
        test     = "StringEquals"
        variable = "kms:EncryptionContext:application"
        values   = ["ridgeline"]
      }

      condition {
        test     = "StringEquals"
        variable = "kms:EncryptionContext:environment"
        values   = [var.environment]
      }

      condition {
        test     = "StringEquals"
        variable = "kms:EncryptionContext:domain"
        values   = [each.key]
      }

      condition {
        test     = "StringEquals"
        variable = "kms:EncryptionContext:schemaVersion"
        values   = ["1"]
      }

      condition {
        test     = "StringEquals"
        variable = "kms:EncryptionContext:service"
        values   = ["migration"]
      }

      condition {
        test     = "ForAllValues:StringEquals"
        variable = "kms:EncryptionContextKeys"
        values = [
          "application",
          "domain",
          "environment",
          "schemaVersion",
          "service",
        ]
      }
    }
  }

  dynamic "statement" {
    for_each = length(local.runtime_principals[each.key]) > 0 || (var.migration_enabled && var.migration_role_arn != null) ? [1] : []
    content {
      sid       = "RuntimeKeyMetadata"
      effect    = "Allow"
      actions   = ["kms:DescribeKey"]
      resources = ["*"]

      principals {
        type = "AWS"
        identifiers = distinct(compact(concat(
          local.runtime_principals[each.key],
          var.migration_enabled && var.migration_role_arn != null ? [var.migration_role_arn] : [],
        )))
      }
    }
  }
}

resource "aws_kms_key" "domain" {
  for_each = local.domains

  description              = "Ridgeline ${var.environment} ${each.key} envelope-encryption key"
  key_usage                = "ENCRYPT_DECRYPT"
  customer_master_key_spec = "SYMMETRIC_DEFAULT"
  enable_key_rotation      = true
  deletion_window_in_days  = var.deletion_window_in_days
  policy                   = data.aws_iam_policy_document.key[each.key].json

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(var.tags, {
    Environment    = var.environment
    SecurityDomain = each.key
    DataClass      = "confidential"
  })
}

resource "aws_kms_alias" "domain" {
  for_each = local.domains

  name          = "alias/ridgeline-${var.environment}-${each.key}"
  target_key_id = aws_kms_key.domain[each.key].key_id
}
