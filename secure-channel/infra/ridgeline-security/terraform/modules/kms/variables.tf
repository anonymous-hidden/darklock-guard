variable "environment" {
  description = "Ridgeline environment name."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "admin_role_arns" {
  description = "Roles allowed to administer KMS configuration without cryptographic data access."
  type        = list(string)
  default     = []
}

variable "break_glass_role_arns" {
  description = "MFA-protected roles allowed to disable or schedule deletion of keys."
  type        = list(string)
  default     = []
}

variable "runtime_role_arns_by_domain" {
  description = "Runtime roles granted data-key operations for each security domain."
  type        = map(list(string))

  validation {
    condition = alltrue([
      for domain in keys(var.runtime_role_arns_by_domain) :
      contains(["auth", "profile-settings", "integrations", "media"], domain)
    ])
    error_message = "runtime_role_arns_by_domain contains an unsupported domain."
  }
}

variable "migration_role_arn" {
  description = "Temporary privileged role used only by an approved data migration."
  type        = string
  default     = null
  nullable    = true
}

variable "migration_enabled" {
  description = "Temporarily include the migration role in application-domain key policies."
  type        = bool
  default     = false
}

variable "deletion_window_in_days" {
  description = "Waiting period for any separately approved KMS deletion operation."
  type        = number
  default     = 30

  validation {
    condition     = var.deletion_window_in_days >= 7 && var.deletion_window_in_days <= 30
    error_message = "deletion_window_in_days must be between 7 and 30."
  }
}

variable "tags" {
  description = "Common resource tags."
  type        = map(string)
  default     = {}
}
