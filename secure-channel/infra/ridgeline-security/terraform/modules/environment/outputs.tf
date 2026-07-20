output "kms_key_arns" {
  value = merge(module.kms.key_arns, { backup = module.backup.backup_key_arn })
}

output "kms_aliases" {
  value = merge(module.kms.aliases, { backup = module.backup.backup_key_alias })
}

output "workload_role_arns" {
  value = module.iam.workload_role_arns
}

output "privileged_role_arns" {
  value = module.iam.privileged_role_arns
}

output "roles_anywhere_profile_arns" {
  value = module.workload_identity.profile_arns
}

output "backup_bucket_name" {
  value = module.backup.bucket_name
}

output "cloudtrail_arn" {
  value = module.audit.cloudtrail_arn
}

output "security_alert_topic_arn" {
  value = module.audit.alert_topic_arn
}
