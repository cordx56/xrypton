variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-northeast-1"
}

variable "project" {
  description = "Project name used for resource naming"
  type        = string
  default     = "crypton"
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for HTTPS listener"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets (used by Aurora)"
  type        = list(string)
  default     = ["10.0.11.0/24", "10.0.12.0/24"]
}

variable "availability_zones" {
  description = "Availability zones for subnets"
  type        = list(string)
  default     = ["ap-northeast-1a", "ap-northeast-1c"]
}

variable "db_master_username" {
  description = "Aurora PostgreSQL master username"
  type        = string
  default     = "crypton"
}

variable "db_master_password" {
  description = "Aurora PostgreSQL master password"
  type        = string
  sensitive   = true
}

variable "db_name" {
  description = "Database name"
  type        = string
  default     = "crypton"
}

variable "api_image" {
  description = "Docker image for crypton-api (ECR URI with tag)"
  type        = string
  default     = ""
}

variable "web_image" {
  description = "Docker image for crypton-web (ECR URI with tag)"
  type        = string
  default     = ""
}

variable "vapid_public_key" {
  description = "VAPID public key for Web Push"
  type        = string
  default     = ""
}

variable "database_url_secret_arn" {
  description = "Secrets Manager ARN for DATABASE_URL"
  type        = string
  default     = ""
}

variable "vapid_private_key_secret_arn" {
  description = "Secrets Manager ARN for VAPID_PRIVATE_KEY"
  type        = string
  default     = ""
}

variable "create_secrets" {
  description = "Create Secrets Manager secrets with Terraform"
  type        = bool
  default     = false
}

variable "vapid_private_key" {
  description = "VAPID private key value (used only when create_secrets = true)"
  type        = string
  sensitive   = true
  default     = ""
}
