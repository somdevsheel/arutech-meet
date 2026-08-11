# Feed these into the Helm chart's values (../../kubernetes/helm/arutech-meet):
#   secrets.databaseUrl        <- database_url
#   secrets.redisUrl           <- redis_url
#   secrets.s3AccessKey/Secret <- storage_access_key_id / storage_secret_access_key
#   livekit.redisAddress       <- redis_primary_endpoint

output "vpc_id" { value = module.network.vpc_id }

output "database_endpoint" { value = module.database.endpoint }
output "database_url" {
  value     = module.database.database_url
  sensitive = true
}

output "redis_primary_endpoint" { value = module.cache.primary_endpoint }
output "redis_url" { value = module.cache.redis_url }

output "storage_bucket_name" { value = module.storage.bucket_name }
output "storage_access_key_id" {
  value     = module.storage.access_key_id
  sensitive = true
}
output "storage_secret_access_key" {
  value     = module.storage.secret_access_key
  sensitive = true
}

output "eks_cluster_name" { value = module.eks.cluster_name }
output "eks_kubeconfig_command" { value = module.eks.kubeconfig_command }
