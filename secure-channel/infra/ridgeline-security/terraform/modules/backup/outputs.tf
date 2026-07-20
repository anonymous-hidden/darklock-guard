output "backup_key_arn" {
  value = aws_kms_key.backup.arn
}

output "backup_key_alias" {
  value = aws_kms_alias.backup.name
}

output "bucket_name" {
  value = aws_s3_bucket.backup.id
}

output "bucket_arn" {
  value = aws_s3_bucket.backup.arn
}
