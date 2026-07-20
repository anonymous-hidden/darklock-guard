locals {
  workload_names = toset([
    "ids",
    "integrations",
    "media",
    "backup",
    "rly",
  ])
  privileged_names = toset(["migration", "restore"])
}

data "aws_iam_policy_document" "workload_trust" {
  for_each = local.workload_names

  statement {
    sid     = "RolesAnywhereCertificateTrust"
    effect  = "Allow"
    actions = ["sts:AssumeRole", "sts:SetSourceIdentity", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["rolesanywhere.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [var.trust_anchor_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.aws_account_id]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:PrincipalTag/x509Issuer/CN"
      values   = [var.certificate_issuer_cn]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:PrincipalTag/x509Subject/CN"
      values   = [var.workload_subject_cns[each.key]]
    }
  }
}

data "aws_iam_policy_document" "operator_trust" {
  statement {
    sid     = "MfaProtectedOperatorAssumption"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = var.operator_role_arns
    }

    condition {
      test     = "StringEquals"
      variable = "aws:PrincipalTag/${var.operator_mfa_principal_tag}"
      values   = ["true"]
    }
  }
}

resource "aws_iam_role" "workload" {
  for_each = local.workload_names

  name                 = "ridgeline-${var.environment}-${each.key}"
  description          = "Short-lived Ridgeline ${var.environment} ${each.key} workload identity"
  assume_role_policy   = data.aws_iam_policy_document.workload_trust[each.key].json
  max_session_duration = 3600
  permissions_boundary = var.permissions_boundary_arn

  tags = merge(var.tags, {
    Environment = var.environment
    Service     = each.key
    AccessClass = "runtime"
  })
}

resource "aws_iam_role" "privileged" {
  for_each = local.privileged_names

  name                 = "ridgeline-${var.environment}-${each.key}"
  description          = "MFA-protected Ridgeline ${var.environment} ${each.key} operator role"
  assume_role_policy   = data.aws_iam_policy_document.operator_trust.json
  max_session_duration = 3600
  permissions_boundary = var.permissions_boundary_arn

  tags = merge(var.tags, {
    Environment = var.environment
    Service     = each.key
    AccessClass = "privileged"
  })
}
