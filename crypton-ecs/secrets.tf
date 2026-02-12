locals {
  use_managed_secrets = var.create_secrets

  database_url_secret_arn      = local.use_managed_secrets ? aws_secretsmanager_secret.database_url[0].arn : var.database_url_secret_arn
  vapid_private_key_secret_arn = local.use_managed_secrets && var.vapid_private_key != "" ? aws_secretsmanager_secret.vapid_private_key[0].arn : var.vapid_private_key_secret_arn
}

resource "aws_secretsmanager_secret" "database_url" {
  count = local.use_managed_secrets ? 1 : 0

  name_prefix = "${var.project}-database-url-"

  tags = {
    Name = "${var.project}-database-url"
  }
}

resource "aws_secretsmanager_secret_version" "database_url" {
  count = local.use_managed_secrets ? 1 : 0

  secret_id = aws_secretsmanager_secret.database_url[0].id
  secret_string = format(
    "postgres://%s:%s@%s:5432/%s",
    var.db_master_username,
    var.db_master_password,
    aws_rds_cluster.main.endpoint,
    var.db_name
  )
}

resource "aws_secretsmanager_secret" "vapid_private_key" {
  count = local.use_managed_secrets && var.vapid_private_key != "" ? 1 : 0

  name_prefix = "${var.project}-vapid-private-key-"

  tags = {
    Name = "${var.project}-vapid-private-key"
  }
}

resource "aws_secretsmanager_secret_version" "vapid_private_key" {
  count = local.use_managed_secrets && var.vapid_private_key != "" ? 1 : 0

  secret_id     = aws_secretsmanager_secret.vapid_private_key[0].id
  secret_string = var.vapid_private_key
}
