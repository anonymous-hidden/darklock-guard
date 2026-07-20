module "iam" {
  source = "../iam"

  environment              = var.environment
  aws_account_id           = var.aws_account_id
  trust_anchor_arn         = var.trust_anchor_arn
  certificate_issuer_cn    = var.certificate_issuer_cn
  workload_subject_cns     = var.workload_subject_cns
  operator_role_arns       = var.operator_role_arns
  permissions_boundary_arn = var.permissions_boundary_arn
  tags                     = var.tags
}

module "kms" {
  source = "../kms"

  environment           = var.environment
  admin_role_arns       = var.kms_admin_role_arns
  break_glass_role_arns = var.kms_break_glass_role_arns
  runtime_role_arns_by_domain = {
    auth             = [module.iam.workload_role_arns.ids]
    profile-settings = [module.iam.workload_role_arns.ids]
    integrations     = [module.iam.workload_role_arns.integrations]
    media            = [module.iam.workload_role_arns.media]
  }
  migration_role_arn = module.iam.privileged_role_arns.migration
  migration_enabled  = var.migration_enabled
  tags               = var.tags
}

module "backup" {
  source = "../backup"

  environment           = var.environment
  aws_account_id        = var.aws_account_id
  aws_region            = var.aws_region
  bucket_name           = var.backup_bucket_name
  writer_role_arn       = module.iam.workload_role_arns.backup
  writer_role_name      = module.iam.workload_role_names.backup
  restore_role_arn      = module.iam.privileged_role_arns.restore
  restore_role_name     = module.iam.privileged_role_names.restore
  admin_role_arns       = var.kms_admin_role_arns
  break_glass_role_arns = var.kms_break_glass_role_arns
  object_lock_enabled   = var.backup_object_lock_enabled
  retention_days        = var.backup_retention_days
  tags                  = var.tags
}

module "workload_identity" {
  source = "../workload-identity"

  environment        = var.environment
  workload_role_arns = module.iam.workload_role_arns
  tags               = var.tags
}

module "audit" {
  source = "../audit"

  environment        = var.environment
  aws_account_id     = var.aws_account_id
  aws_region         = var.aws_region
  log_bucket_name    = var.audit_bucket_name
  backup_bucket_name = module.backup.bucket_name
  backup_bucket_arn  = module.backup.bucket_arn
  tags               = var.tags
}
