resource "aws_rolesanywhere_profile" "workload" {
  for_each = var.workload_role_arns

  name                        = "ridgeline-${var.environment}-${each.key}"
  enabled                     = true
  duration_seconds            = var.session_duration_seconds
  role_arns                   = [each.value]
  require_instance_properties = true

  tags = merge(var.tags, {
    Environment = var.environment
    Service     = each.key
  })
}
