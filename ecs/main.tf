terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.19"
    }
  }

  # S3 backend (uncomment and configure for remote state)
  # backend "s3" {
  #   bucket = "xrypton-tfstate"
  #   key    = "ecs/terraform.tfstate"
  #   region = "ap-northeast-1"
  # }
}

provider "aws" {
  region = var.aws_region
}
