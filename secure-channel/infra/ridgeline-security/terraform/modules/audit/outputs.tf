output "cloudtrail_arn" {
  value = aws_cloudtrail.security.arn
}

output "alert_topic_arn" {
  value = aws_sns_topic.security.arn
}

output "log_bucket_name" {
  value = aws_s3_bucket.cloudtrail.id
}
