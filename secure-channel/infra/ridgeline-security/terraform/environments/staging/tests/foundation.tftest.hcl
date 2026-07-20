mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "111122223333"
    }
  }

  mock_data "aws_partition" {
    defaults = {
      partition  = "aws"
      dns_suffix = "amazonaws.com"
    }
  }

  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }
}

variables {
  deployment_enabled = true
  aws_account_id     = "111122223333"
  aws_region         = "us-east-2"

  trust_anchor_arn      = "arn:aws:rolesanywhere:us-east-2:111122223333:trust-anchor/00000000-0000-0000-0000-000000000000"
  certificate_issuer_cn = "Ridgeline Staging Workload CA"

  workload_subject_cns = {
    ids          = "ridgeline-staging-ids"
    integrations = "ridgeline-staging-integrations"
    media        = "ridgeline-staging-media"
    backup       = "ridgeline-staging-backup"
    rly          = "ridgeline-staging-rly"
  }

  operator_role_arns = [
    "arn:aws:iam::111122223333:role/RidgelineStagingSecurityOperator",
  ]
  kms_admin_role_arns = [
    "arn:aws:iam::111122223333:role/RidgelineStagingKmsAdministrator",
  ]
  kms_break_glass_role_arns = [
    "arn:aws:iam::111122223333:role/RidgelineStagingKmsBreakGlass",
  ]

  permissions_boundary_arn = "arn:aws:iam::111122223333:policy/RidgelineWorkloadBoundary"
  backup_bucket_name       = "ridgeline-staging-111122223333-backup"
  audit_bucket_name        = "ridgeline-staging-111122223333-audit"
  migration_enabled        = false
}

run "staging_foundation_plans_with_mock_provider" {
  command = plan

  assert {
    condition     = length(module.security) == 1
    error_message = "Enabled staging must instantiate one security foundation module."
  }
}
