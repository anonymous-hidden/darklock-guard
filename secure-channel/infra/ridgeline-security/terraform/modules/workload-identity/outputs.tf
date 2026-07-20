output "profile_arns" {
  value = { for name, profile in aws_rolesanywhere_profile.workload : name => profile.arn }
}
