locals {
  tags = {
    Owner     = "security-platform"
    DataClass = "confidential"
  }
}

module "security" {
  count  = var.deployment_enabled ? 1 : 0
  source = "../../modules/environment"

  environment                = "staging"
  aws_account_id             = var.aws_account_id
  aws_region                 = var.aws_region
  trust_anchor_arn           = var.trust_anchor_arn
  certificate_issuer_cn      = var.certificate_issuer_cn
  workload_subject_cns       = var.workload_subject_cns
  operator_role_arns         = var.operator_role_arns
  kms_admin_role_arns        = var.kms_admin_role_arns
  kms_break_glass_role_arns  = var.kms_break_glass_role_arns
  permissions_boundary_arn   = var.permissions_boundary_arn
  backup_bucket_name         = var.backup_bucket_name
  audit_bucket_name          = var.audit_bucket_name
  backup_retention_days      = 35
  backup_object_lock_enabled = true
  migration_enabled          = var.migration_enabled
  tags                       = local.tags
}
