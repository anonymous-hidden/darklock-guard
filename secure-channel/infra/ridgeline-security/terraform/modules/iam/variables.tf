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

variable "trust_anchor_arn" {
  description = "Existing IAM Roles Anywhere trust anchor backed by an approved CA."
  type        = string
}

variable "certificate_issuer_cn" {
  description = "Expected X.509 issuer common name for workload certificates."
  type        = string
}

variable "workload_subject_cns" {
  description = "Expected certificate subject common name for each workload."
  type        = map(string)
}

variable "operator_role_arns" {
  description = "Existing federated operator roles allowed to assume privileged roles."
  type        = list(string)
}

variable "operator_mfa_principal_tag" {
  description = "Identity-provider-controlled principal tag proving the operator session passed MFA."
  type        = string
  default     = "RidgelineMfaAuthenticated"

  validation {
    condition     = can(regex("^[A-Za-z0-9_.:/=+@-]{1,128}$", var.operator_mfa_principal_tag))
    error_message = "operator_mfa_principal_tag must be a valid IAM tag key."
  }
}

variable "permissions_boundary_arn" {
  description = "Optional organization-managed permissions boundary for all created roles."
  type        = string
  default     = null
  nullable    = true
}

variable "tags" {
  type    = map(string)
  default = {}
}
