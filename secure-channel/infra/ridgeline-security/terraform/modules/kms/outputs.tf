output "key_arns" {
  description = "KMS key ARNs by security domain."
  value       = { for domain, key in aws_kms_key.domain : domain => key.arn }
}

output "key_ids" {
  description = "KMS key IDs by security domain."
  value       = { for domain, key in aws_kms_key.domain : domain => key.key_id }
}

output "aliases" {
  description = "KMS aliases by security domain."
  value       = { for domain, alias in aws_kms_alias.domain : domain => alias.name }
}
