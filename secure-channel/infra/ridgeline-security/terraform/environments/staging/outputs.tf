output "security_infrastructure" {
  value = try({
    kms_key_arns                = module.security[0].kms_key_arns
    kms_aliases                 = module.security[0].kms_aliases
    workload_role_arns          = module.security[0].workload_role_arns
    privileged_role_arns        = module.security[0].privileged_role_arns
    roles_anywhere_profile_arns = module.security[0].roles_anywhere_profile_arns
    backup_bucket_name          = module.security[0].backup_bucket_name
    cloudtrail_arn              = module.security[0].cloudtrail_arn
    security_alert_topic_arn    = module.security[0].security_alert_topic_arn
  }, null)
}
