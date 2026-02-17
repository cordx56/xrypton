resource "aws_s3_bucket" "storage" {
  bucket_prefix = "${var.project}-storage-"
  force_destroy = true

  tags = {
    Name = "${var.project}-storage"
  }
}

resource "aws_s3_bucket_public_access_block" "storage" {
  bucket = aws_s3_bucket.storage.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
