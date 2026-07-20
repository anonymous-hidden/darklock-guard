mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "444455556666"
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
  deployment_enabled         = true
  production_change_approval = "CHG-123456"
  aws_account_id             = "444455556666"
  aws_region                 = "us-east-2"

  trust_anchor_arn      = "arn:aws:rolesanywhere:us-east-2:444455556666:trust-anchor/00000000-0000-0000-0000-000000000000"
  certificate_issuer_cn = "Ridgeline Production Workload CA"

  workload_subject_cns = {
    ids          = "ridgeline-production-ids"
    integrations = "ridgeline-production-integrations"
    media        = "ridgeline-production-media"
    backup       = "ridgeline-production-backup"
    rly          = "ridgeline-production-rly"
  }

  operator_role_arns = [
    "arn:aws:iam::444455556666:role/RidgelineProductionSecurityOperator",
  ]
  kms_admin_role_arns = [
    "arn:aws:iam::444455556666:role/RidgelineProductionKmsAdministrator",
  ]
  kms_break_glass_role_arns = [
    "arn:aws:iam::444455556666:role/RidgelineProductionKmsBreakGlass",
  ]

  permissions_boundary_arn = "arn:aws:iam::444455556666:policy/RidgelineWorkloadBoundary"
  backup_bucket_name       = "ridgeline-production-444455556666-backup"
  audit_bucket_name        = "ridgeline-production-444455556666-audit"
  migration_enabled        = false
}

run "production_foundation_plans_only_with_approval" {
  command = plan

  assert {
    condition     = length(module.security) == 1
    error_message = "Approved production definitions must instantiate one security foundation module."
  }
}

run "production_without_approval_is_rejected" {
  command = plan

  variables {
    production_change_approval = ""
  }

  expect_failures = [
    check.production_apply_guard,
    terraform_data.production_apply_guard,
  ]
}
