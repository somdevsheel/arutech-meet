# Terraform — Arutech Meet production infrastructure (AWS reference)

Provisions the managed infrastructure the Helm chart (`../kubernetes/helm/arutech-meet`) expects to
already exist: a VPC, an EKS cluster, RDS PostgreSQL, ElastiCache Redis, and an S3 bucket for
recordings/uploads. AWS was chosen as *a* concrete reference implementation, not because the
application is AWS-specific — nothing in `apps/api` assumes AWS (S3 access is via the generic AWS SDK
against any S3-compatible endpoint, see `docs/webrtc.md` and `apps/api/src/storage/storage.service.ts`).
Porting to GCP/Azure means swapping these modules for their GKE/AKS, Cloud SQL/Azure Database, and
Memorystore/Azure Cache equivalents — the shape (network → managed Postgres → managed Redis → object
storage → k8s cluster) stays the same.

## Structure

```
terraform/
├── modules/
│   ├── network/     VPC, public/private subnets across 3 AZs, NAT gateways, security groups
│   ├── database/     RDS PostgreSQL (Multi-AZ optional), in the private subnets only
│   ├── cache/        ElastiCache Redis replication group
│   ├── storage/      S3 bucket for recordings/uploads, versioned, lifecycle rule for the
│   │                  same retention window RecordingsCleanupService enforces at the app level
│   └── eks/           EKS cluster + a managed node group
└── environments/
    └── production/    Root module wiring the above together for one environment.
                        Copy this directory to add a second (staging, etc.) —
                        deliberately not parameterized into one mega-module, so
                        environments can diverge (instance sizes, node counts)
                        without conditional sprawl.
```

## Honesty note

`terraform fmt`, `terraform init`, and `terraform validate` were run for real against every module here
(`modules/network`, `modules/database`, `modules/cache`, `modules/storage`, `modules/eks`) and the root
`environments/production` module — all pass, confirming the HCL is syntactically correct, internally
consistent (module input/output wiring wasn't just eyeballed), and resolves against the real
`hashicorp/aws` provider's actual resource schemas (attribute names/types checked against the provider,
not just assumed from memory).

**What that does *not* prove**: `terraform plan`/`apply` were not run — this repo has no AWS credentials
or account to run them against, so "does this actually provision a working VPC/RDS/EKS cluster" has not
been verified end-to-end, only "is this valid, schema-correct Terraform". The Kubernetes/Helm layer this
feeds *was* fully rendered and structurally checked (`helm lint`, `helm template`, every output document
parsed and checked for required fields — see `../kubernetes/helm/arutech-meet`). Treat `plan`/`apply`
against a real account as the next verification step before trusting this in production, not as done.

## Usage (once you have AWS credentials and have reviewed the variables)

```bash
cd environments/production
terraform init
terraform plan -var-file=terraform.tfvars   # create this file — see variables.tf for what's required
terraform apply
```

Outputs (`terraform output`) include the values the Helm chart's `values.yaml` needs: the RDS endpoint,
ElastiCache endpoint, S3 bucket name, and the EKS cluster's `kubeconfig` command.

## State

No backend is configured in `environments/production/main.tf` beyond a placeholder — configure a real
remote backend (S3 + DynamoDB lock table, or Terraform Cloud) before any real usage. Local state for a
shared production environment is a foot-gun, not a starting point.
