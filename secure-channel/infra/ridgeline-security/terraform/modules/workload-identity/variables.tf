variable "environment" {
  type = string
}

variable "workload_role_arns" {
  description = "Workload roles exposed through IAM Roles Anywhere profiles."
  type        = map(string)
}

variable "session_duration_seconds" {
  type    = number
  default = 900

  validation {
    condition     = var.session_duration_seconds >= 900 && var.session_duration_seconds <= 3600
    error_message = "session_duration_seconds must be between 900 and 3600."
  }
}

variable "tags" {
  type    = map(string)
  default = {}
}
