variable "environment" {
  type = string
}

variable "aws_account_id" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "log_bucket_name" {
  type = string
}

variable "backup_bucket_name" {
  type = string
}

variable "backup_bucket_arn" {
  type = string
}

variable "alarm_threshold_decrypts_per_five_minutes" {
  type    = number
  default = 100
}

variable "log_retention_days" {
  type    = number
  default = 365
}

variable "tags" {
  type    = map(string)
  default = {}
}
