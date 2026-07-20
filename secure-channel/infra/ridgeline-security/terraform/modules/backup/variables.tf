variable "environment" {
  type = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "aws_account_id" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "bucket_name" {
  type = string
}

variable "writer_role_arn" {
  type = string
}

variable "writer_role_name" {
  type = string
}

variable "restore_role_arn" {
  type = string
}

variable "restore_role_name" {
  type = string
}

variable "admin_role_arns" {
  type    = list(string)
  default = []
}

variable "break_glass_role_arns" {
  type    = list(string)
  default = []
}

variable "object_lock_enabled" {
  description = "Enable S3 Object Lock. This cannot be enabled retroactively on all existing buckets."
  type        = bool
  default     = true
}

variable "retention_days" {
  type    = number
  default = 35

  validation {
    condition     = var.retention_days >= 7
    error_message = "retention_days must be at least 7."
  }
}

variable "tags" {
  type    = map(string)
  default = {}
}
