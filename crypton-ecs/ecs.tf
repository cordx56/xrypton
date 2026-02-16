resource "aws_ecs_cluster" "main" {
  name = "${var.project}-cluster"

  tags = {
    Name = "${var.project}-cluster"
  }
}

# --- crypton-api ---

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.project}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name  = "api"
    image = var.api_image != "" ? var.api_image : "${aws_ecr_repository.api.repository_url}:latest"
    portMappings = [{
      containerPort = 8080
      protocol      = "tcp"
    }]
    environment = [
      { name = "LISTEN_ADDR", value = "0.0.0.0:8080" },
      { name = "S3_BUCKET", value = aws_s3_bucket.storage.id },
      { name = "S3_REGION", value = var.aws_region },
      { name = "VAPID_PUBLIC_KEY", value = var.vapid_public_key },
      { name = "SERVER_HOSTNAME", value = var.server_hostname },
      { name = "RUST_LOG", value = "crypton_api=info,tower_http=info" },
    ]
    secrets = concat(
      [{ name = "DATABASE_URL", valueFrom = local.database_url_secret_arn }],
      local.vapid_private_key_secret_arn != "" ? [{ name = "VAPID_PRIVATE_KEY", valueFrom = local.vapid_private_key_secret_arn }] : []
    )
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
    essential = true
  }])

  tags = {
    Name = "${var.project}-api-task"
  }

  depends_on = [
    aws_secretsmanager_secret_version.database_url,
    aws_secretsmanager_secret_version.vapid_private_key,
  ]
}

resource "aws_ecs_service" "api" {
  name            = "${var.project}-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 8080
  }

  depends_on = [aws_lb_listener.http]

  tags = {
    Name = "${var.project}-api-service"
  }
}

# --- crypton-web ---

resource "aws_ecs_task_definition" "web" {
  family                   = "${var.project}-web"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name  = "web"
    image = var.web_image != "" ? var.web_image : "${aws_ecr_repository.web.repository_url}:latest"
    portMappings = [{
      containerPort = 3000
      protocol      = "tcp"
    }]
    environment = [
      { name = "HOSTNAME", value = "0.0.0.0" },
      { name = "PORT", value = "3000" },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.web.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }
    essential = true
  }])

  tags = {
    Name = "${var.project}-web-task"
  }
}

resource "aws_ecs_service" "web" {
  name            = "${var.project}-web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }

  depends_on = [aws_lb_listener.http]

  tags = {
    Name = "${var.project}-web-service"
  }
}
