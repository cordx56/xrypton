output "alb_dns_name" {
  description = "ALB DNS name"
  value       = aws_lb.main.dns_name
}

output "alb_url" {
  description = "ALB URL"
  value       = "https://${aws_lb.main.dns_name}"
}

output "ecr_api_repository_url" {
  description = "ECR repository URL for xrypton-api"
  value       = aws_ecr_repository.api.repository_url
}

output "ecr_web_repository_url" {
  description = "ECR repository URL for xrypton-web"
  value       = aws_ecr_repository.web.repository_url
}

output "aurora_endpoint" {
  description = "Aurora PostgreSQL endpoint"
  value       = aws_rds_cluster.main.endpoint
}

output "s3_bucket_name" {
  description = "S3 bucket name for file storage"
  value       = aws_s3_bucket.storage.id
}
