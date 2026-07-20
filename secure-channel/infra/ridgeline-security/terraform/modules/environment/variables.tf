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

variable "trust_anchor_arn" {
  type = string
}

variable "certificate_issuer_cn" {
  type = string
}

variable "workload_subject_cns" {
  type = map(string)

  validation {
    condition = alltrue([
      for service in ["ids", "integrations", "media", "backup", "rly"] :
      contains(keys(var.workload_subject_cns), service)
    ])
    error_message = "workload_subject_cns must define ids, integrations, media, backup, and rly."
  }
}

variable "operator_role_arns" {
  type = list(string)
}

variable "kms_admin_role_arns" {
  type = list(string)
}

variable "kms_break_glass_role_arns" {
  type = list(string)
}

variable "permissions_boundary_arn" {
  type     = string
  default  = null
  nullable = true
}

variable "backup_bucket_name" {
  type = string
}

variable "audit_bucket_name" {
  type = string
}

variable "backup_retention_days" {
  type    = number
  default = 35
}

variable "backup_object_lock_enabled" {
  type    = bool
  default = true
}

variable "migration_enabled" {
  description = "Temporary switch for an explicitly approved data migration."
  type        = bool
  default     = false
}

variable "tags" {
  type    = map(string)
  default = {}
}
