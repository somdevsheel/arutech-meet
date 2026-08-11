variable "name" { type = string }
variable "subnet_ids" { type = list(string) }
variable "security_group_id" { type = string }
variable "node_type" {
  type    = string
  default = "cache.t4g.medium"
}
variable "num_cache_clusters" {
  type        = number
  default     = 2
  description = "1 primary + N-1 replicas. Redis here backs sessions cache, presence, distributed locks, rate limiting, and the Socket.IO cross-instance adapter (see docs/architecture.md) — never the source of truth, but losing it mid-meeting still degrades realtime features, hence a replica rather than a single node."
}

resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name}-redis"
  subnet_ids = var.subnet_ids
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id = "${var.name}-redis"
  description          = "Arutech Meet — sessions/presence/pubsub/rate-limiting (not primary data store)"

  engine         = "redis"
  engine_version = "7.1"
  node_type      = var.node_type
  port           = 6379

  num_cache_clusters         = var.num_cache_clusters
  automatic_failover_enabled = var.num_cache_clusters > 1
  multi_az_enabled           = var.num_cache_clusters > 1

  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [var.security_group_id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  tags = { Name = "${var.name}-redis" }
}

output "primary_endpoint" { value = aws_elasticache_replication_group.this.primary_endpoint_address }
output "redis_url" {
  value     = "rediss://${aws_elasticache_replication_group.this.primary_endpoint_address}:6379"
  sensitive = false
}
