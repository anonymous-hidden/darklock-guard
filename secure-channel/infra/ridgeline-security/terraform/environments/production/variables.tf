variable "deployment_enabled" {
  description = "Production remains disabled until an approved change is supplied."
  type        = bool
  default     = false
}

variable "production_change_approval" {
  description = "Approved production change identifier required before enabling deployment."
  type        = string
  default     = ""
}

variable "aws_account_id" {
  type = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be a 12-digit AWS account ID."
  }
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

variable "migration_enabled" {
  type    = bool
  default = false
}
