output "workload_role_arns" {
  value = { for name, role in aws_iam_role.workload : name => role.arn }
}

output "workload_role_names" {
  value = { for name, role in aws_iam_role.workload : name => role.name }
}

output "privileged_role_arns" {
  value = { for name, role in aws_iam_role.privileged : name => role.arn }
}

output "privileged_role_names" {
  value = { for name, role in aws_iam_role.privileged : name => role.name }
}
