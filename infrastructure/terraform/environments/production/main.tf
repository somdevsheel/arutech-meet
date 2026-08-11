terraform {
  required_version = ">= 1.7"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }

  # Local state is a placeholder — configure a real remote backend before any
  # shared/production usage. See ../../README.md §State.
  # backend "s3" {
  #   bucket         = "arutech-meet-terraform-state"
  #   key            = "production/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "arutech-meet-terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region
}

locals {
  name = "arutech-meet-${var.environment}"
}

module "network" {
  source = "../../modules/network"
  name   = local.name
  azs    = var.availability_zones
}

module "database" {
  source            = "../../modules/database"
  name              = local.name
  vpc_id            = module.network.vpc_id
  subnet_ids        = module.network.private_subnet_ids
  security_group_id = module.network.internal_security_group_id
  instance_class    = var.db_instance_class
  multi_az          = var.db_multi_az
}

module "cache" {
  source             = "../../modules/cache"
  name               = local.name
  subnet_ids         = module.network.private_subnet_ids
  security_group_id  = module.network.internal_security_group_id
  node_type          = var.redis_node_type
  num_cache_clusters = var.redis_num_cache_clusters
}

module "storage" {
  source = "../../modules/storage"
  name   = local.name
}

module "eks" {
  source             = "../../modules/eks"
  name               = local.name
  vpc_id             = module.network.vpc_id
  private_subnet_ids = module.network.private_subnet_ids
  public_subnet_ids  = module.network.public_subnet_ids
  node_desired_size  = var.eks_node_desired_size
  node_min_size      = var.eks_node_min_size
  node_max_size      = var.eks_node_max_size
}
