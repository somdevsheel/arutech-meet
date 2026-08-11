variable "name" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs — RDS must never be placed in a public subnet."
}
variable "security_group_id" { type = string }
variable "instance_class" {
  type    = string
  default = "db.t4g.medium"
}
variable "allocated_storage_gb" {
  type    = number
  default = 100
}
variable "multi_az" {
  type        = bool
  default     = true
  description = "Standby replica in a second AZ for automatic failover — recommended for anything beyond a dev environment."
}
variable "db_name" {
  type    = string
  default = "arutech_meet"
}
variable "master_username" {
  type    = string
  default = "arutech"
}

resource "random_password" "master" {
  length  = 32
  special = false # RDS master password chars are restrictive; keep it alphanumeric to avoid escaping issues
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-db"
  subnet_ids = var.subnet_ids
  tags       = { Name = "${var.name}-db-subnet-group" }
}

resource "aws_db_instance" "this" {
  identifier     = "${var.name}-postgres"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.instance_class

  allocated_storage     = var.allocated_storage_gb
  max_allocated_storage = var.allocated_storage_gb * 3 # storage autoscaling ceiling
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.master_username
  password = random_password.master.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [var.security_group_id]
  publicly_accessible    = false

  multi_az                  = var.multi_az
  backup_retention_period   = 7
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name}-postgres-final"

  # Matches docs/database.md's soft-deletion convention at the app layer —
  # this is the infra-layer equivalent: don't let an accidental `terraform
  # destroy` silently take the whole database with it.
  lifecycle {
    prevent_destroy = true
  }

  tags = { Name = "${var.name}-postgres" }
}

output "endpoint" { value = aws_db_instance.this.endpoint }
output "database_url" {
  # Matches DATABASE_URL's expected shape in packages/config/src/env.ts —
  # feed this straight into the Helm chart's secrets.databaseUrl.
  value     = "postgresql://${var.master_username}:${random_password.master.result}@${aws_db_instance.this.endpoint}/${var.db_name}?schema=public&sslmode=require"
  sensitive = true
}
