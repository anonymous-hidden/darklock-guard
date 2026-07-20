data "aws_partition" "current" {}

locals {
  trail_name = "ridgeline-${var.environment}-security"
  trail_arn  = "arn:${data.aws_partition.current.partition}:cloudtrail:${var.aws_region}:${var.aws_account_id}:trail/${local.trail_name}"
  alarms = {
    key_lifecycle = {
      pattern   = "{ ($.eventSource = \"kms.amazonaws.com\") && (($.eventName = \"DisableKey\") || ($.eventName = \"ScheduleKeyDeletion\") || ($.eventName = \"PutKeyPolicy\")) }"
      threshold = 1
    }
    kms_access_denied = {
      pattern   = "{ ($.eventSource = \"kms.amazonaws.com\") && (($.errorCode = \"AccessDenied\") || ($.errorCode = \"AccessDeniedException\")) }"
      threshold = 1
    }
    iam_privilege_change = {
      pattern   = "{ ($.eventSource = \"iam.amazonaws.com\") && (($.eventName = \"AttachRolePolicy\") || ($.eventName = \"PutRolePolicy\") || ($.eventName = \"UpdateAssumeRolePolicy\") || ($.eventName = \"CreatePolicyVersion\")) }"
      threshold = 1
    }
    roles_anywhere_denied = {
      pattern   = "{ ($.eventSource = \"rolesanywhere.amazonaws.com\") && ($.errorCode = \"AccessDenied*\") }"
      threshold = 1
    }
    backup_write_failure = {
      pattern   = "{ ($.eventSource = \"s3.amazonaws.com\") && ($.eventName = \"PutObject\") && ($.requestParameters.bucketName = \"${var.backup_bucket_name}\") && ($.errorCode = \"*\") }"
      threshold = 1
    }
    unusual_decrypt_volume = {
      pattern   = "{ ($.eventSource = \"kms.amazonaws.com\") && ($.eventName = \"Decrypt\") }"
      threshold = var.alarm_threshold_decrypts_per_five_minutes
    }
  }
}

resource "aws_s3_bucket" "cloudtrail" {
  bucket = var.log_bucket_name

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(var.tags, {
    Environment = var.environment
    Purpose     = "security-audit"
  })
}

resource "aws_s3_bucket_public_access_block" "cloudtrail" {
  bucket = aws_s3_bucket.cloudtrail.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "cloudtrail" {
  bucket = aws_s3_bucket.cloudtrail.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "cloudtrail" {
  bucket = aws_s3_bucket.cloudtrail.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

data "aws_iam_policy_document" "cloudtrail_bucket" {
  statement {
    sid       = "CloudTrailAclCheck"
    effect    = "Allow"
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.cloudtrail.arn]

    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.trail_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.aws_account_id]
    }
  }

  statement {
    sid       = "CloudTrailLogDelivery"
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.cloudtrail.arn}/AWSLogs/${var.aws_account_id}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [local.trail_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.aws_account_id]
    }
  }

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.cloudtrail.arn, "${aws_s3_bucket.cloudtrail.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "cloudtrail" {
  bucket = aws_s3_bucket.cloudtrail.id
  policy = data.aws_iam_policy_document.cloudtrail_bucket.json
}

resource "aws_cloudwatch_log_group" "cloudtrail" {
  name              = "/ridgeline/${var.environment}/cloudtrail"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

data "aws_iam_policy_document" "cloudtrail_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cloudtrail" {
  name               = "ridgeline-${var.environment}-cloudtrail"
  assume_role_policy = data.aws_iam_policy_document.cloudtrail_assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "cloudtrail_logs" {
  statement {
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.cloudtrail.arn}:*"]
  }
}

resource "aws_iam_role_policy" "cloudtrail_logs" {
  name   = "write-cloudtrail-security-log"
  role   = aws_iam_role.cloudtrail.name
  policy = data.aws_iam_policy_document.cloudtrail_logs.json
}

resource "aws_cloudtrail" "security" {
  name                          = local.trail_name
  s3_bucket_name                = aws_s3_bucket.cloudtrail.id
  include_global_service_events = true
  is_multi_region_trail         = true
  enable_log_file_validation    = true
  enable_logging                = true
  cloud_watch_logs_group_arn    = "${aws_cloudwatch_log_group.cloudtrail.arn}:*"
  cloud_watch_logs_role_arn     = aws_iam_role.cloudtrail.arn

  event_selector {
    include_management_events = true
    read_write_type           = "All"

    data_resource {
      type   = "AWS::S3::Object"
      values = ["${var.backup_bucket_arn}/opaque/"]
    }
  }

  depends_on = [aws_s3_bucket_policy.cloudtrail]
  tags       = var.tags
}

resource "aws_sns_topic" "security" {
  name              = "ridgeline-${var.environment}-security-alerts"
  kms_master_key_id = "alias/aws/sns"
  tags              = var.tags
}

resource "aws_cloudwatch_log_metric_filter" "security" {
  for_each = local.alarms

  name           = "ridgeline-${var.environment}-${replace(each.key, "_", "-")}"
  pattern        = each.value.pattern
  log_group_name = aws_cloudwatch_log_group.cloudtrail.name

  metric_transformation {
    name      = "${var.environment}-${each.key}"
    namespace = "Ridgeline/Security"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "security" {
  for_each = local.alarms

  alarm_name          = "ridgeline-${var.environment}-${replace(each.key, "_", "-")}"
  alarm_description   = "Ridgeline security signal: ${replace(each.key, "_", " ")}"
  namespace           = "Ridgeline/Security"
  metric_name         = "${var.environment}-${each.key}"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = each.value.threshold
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.security.arn]
  tags                = var.tags
}

resource "aws_cloudwatch_metric_alarm" "restore_validation_failure" {
  alarm_name          = "ridgeline-${var.environment}-restore-validation-failure"
  alarm_description   = "A scheduled isolated backup restore test reported failure."
  namespace           = "Ridgeline/Backup"
  metric_name         = "RestoreValidationFailure"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.security.arn]
  tags                = var.tags
}
